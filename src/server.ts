/**
 * Servidor único (un puerto) que:
 *  - sirve las páginas estáticas,
 *  - atiende a los participantes por WebSocket (API estándar del navegador),
 *  - atiende a la pantalla por Server-Sent Events (EventSource).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';

import { fetchProduct } from './catalog.js';
import { config } from './config.js';
import { SharedList } from './store.js';
import { parseClientMessage } from './validation.js';
import { LIMITS } from './types.js';
import type {
  ClientMessage,
  ErrorCode,
  ProposalFailure,
  ScreenStateEvent,
  ServerMessage,
} from './types.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const publicDir = existsSync(resolve(moduleDir, '..', 'public'))
  ? resolve(moduleDir, '..', 'public')
  : resolve(moduleDir, 'public');

const list = new SharedList();
const sockets = new Map<WebSocket, string>();
const joinTimers = new Map<WebSocket, NodeJS.Timeout>();
const alive = new WeakMap<WebSocket, boolean>();
const sseClients = new Set<ServerResponse>();

const log = (...args: unknown[]) => console.log(`[${new Date().toISOString()}]`, ...args);

/* ------------------------------------------------------------------ */
/* HTTP: archivos estáticos + SSE                                       */
/* ------------------------------------------------------------------ */

const STATIC_FILES: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/screen': { file: 'screen.html', type: 'text/html; charset=utf-8' },
  '/screen.html': { file: 'screen.html', type: 'text/html; charset=utf-8' },
  '/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
  '/participant.js': { file: 'participant.js', type: 'text/javascript; charset=utf-8' },
  '/screen.js': { file: 'screen.js', type: 'text/javascript; charset=utf-8' },
};

function screenStateEvent(): ScreenStateEvent {
  const participants = list.getParticipants();
  return {
    type: 'state',
    participantCount: participants.length,
    participants,
    products: list.view(),
    serverTime: new Date().toISOString(),
  };
}

function writeScreen(res: ServerResponse): void {
  if (!res.destroyed) {
    res.write(`event: state\ndata: ${JSON.stringify(screenStateEvent())}\n\n`);
  }
}

function broadcastScreen(): void {
  const payload = `event: state\ndata: ${JSON.stringify(screenStateEvent())}\n\n`;
  for (const res of sseClients) {
    if (!res.destroyed) res.write(payload);
  }
}

function handleSse(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'GET') {
    res.writeHead(405, { allow: 'GET' }).end();
    return;
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(': connected\n\n');
  writeScreen(res);
  sseClients.add(res);

  const heartbeat = setInterval(() => {
    if (!res.destroyed) res.write(': keep-alive\n\n');
  }, 15_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
}

const server = createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname;

  if (pathname === '/events') {
    handleSse(req, res);
    return;
  }

  const target = STATIC_FILES[pathname];
  if (!target) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 - No encontrado');
    return;
  }

  readFile(resolve(publicDir, target.file))
    .then((content) => res.writeHead(200, { 'content-type': target.type }).end(content))
    .catch(() => res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('Error interno'));
});

/* ------------------------------------------------------------------ */
/* WebSocket: participantes                                             */
/* ------------------------------------------------------------------ */

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: LIMITS.maxPayloadBytes });

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function sendError(ws: WebSocket, code: ErrorCode | string, message: string): void {
  send(ws, { type: 'error', code: code as ErrorCode, message });
}

function broadcastState(): void {
  const participants = list.getParticipants();
  const products = list.view();
  for (const [ws, participantId] of sockets) {
    const you = list.getParticipant(participantId);
    if (!you) continue;
    send(ws, { type: 'state', you, participants, products });
  }
  broadcastScreen();
}

async function handleMessage(ws: WebSocket, message: ClientMessage): Promise<void> {
  const participantId = sockets.get(ws);

  if (message.type === 'join') {
    if (participantId) {
      sendError(ws, 'ALREADY_JOINED', 'Ya ingresaste a la lista con este nombre.');
      return;
    }
    const timer = joinTimers.get(ws);
    if (timer) clearTimeout(timer);
    joinTimers.delete(ws);

    const participant = list.join(message.name);
    sockets.set(ws, participant.id);
    log(`Entró ${participant.name} (${participant.id.slice(0, 8)})`);
    broadcastState();
    return;
  }

  if (!participantId) {
    sendError(ws, 'NOT_JOINED', 'Primero enviá un mensaje "join" con tu nombre.');
    return;
  }
  const participant = list.getParticipant(participantId);
  if (!participant) {
    sendError(ws, 'NOT_JOINED', 'Tu sesión ya no es válida.');
    return;
  }

  switch (message.type) {
    case 'propose': {
      // 1) Descartar ids ya presentes y repetidos dentro del mismo mensaje.
      const seen = new Set<number>();
      const toFetch: number[] = [];
      const failures: ProposalFailure[] = [];

      for (const id of message.productIds) {
        if (seen.has(id) || list.hasProduct(id)) {
          failures.push({
            productId: id,
            reason: 'duplicate',
            message: `El producto ${id} ya estaba en la lista.`,
          });
          continue;
        }
        seen.add(id);
        toFetch.push(id);
      }

      // 2) Consultar TODOS los ids en simultáneo (no uno después de otro).
      const results = await Promise.all(
        toFetch.map(async (id) => ({ id, result: await fetchProduct(id) })),
      );

      // 3) Aplicar los cambios en un bloque sincrónico: es atómico y evita
      //    duplicados si otra propuesta terminó al mismo tiempo.
      const added: number[] = [];
      for (const { id, result } of results) {
        if (!result.ok) {
          failures.push({ productId: id, reason: result.reason, message: result.message });
          continue;
        }
        if (!list.addProduct(result.product, participant)) {
          failures.push({
            productId: id,
            reason: 'duplicate',
            message: `El producto ${id} ya estaba en la lista.`,
          });
          continue;
        }
        added.push(id);
      }

      // 4) El resultado (incluidos los errores) es solo para quien propuso.
      send(ws, { type: 'proposeResult', added, failures });
      if (added.length > 0) {
        log(`${participant.name} agregó [${added.join(', ')}]`);
        broadcastState();
      }
      return;
    }

    case 'vote': {
      const result = list.vote(message.productId, participantId);
      if (result === 'ok') broadcastState();
      else if (result === 'not_found')
        sendError(ws, 'PRODUCT_NOT_FOUND', `El producto ${message.productId} no está en la lista.`);
      else sendError(ws, 'ALREADY_VOTED', 'Ya votaste este producto.');
      return;
    }

    case 'unvote': {
      const result = list.unvote(message.productId, participantId);
      if (result === 'ok') broadcastState();
      else if (result === 'not_found')
        sendError(ws, 'PRODUCT_NOT_FOUND', `El producto ${message.productId} no está en la lista.`);
      else sendError(ws, 'NOT_VOTED', 'No habías votado este producto.');
      return;
    }

    case 'remove': {
      const result = list.remove(message.productId, participantId);
      if (result === 'ok') broadcastState();
      else if (result === 'not_found')
        sendError(ws, 'PRODUCT_NOT_FOUND', `El producto ${message.productId} no está en la lista.`);
      else
        sendError(
          ws,
          'FORBIDDEN',
          'No podés quitar un producto con votos que no propusiste.',
        );
      return;
    }
  }
}

wss.on('connection', (ws) => {
  alive.set(ws, true);
  log('Nueva conexión WebSocket');

  const timer = setTimeout(() => {
    if (!sockets.has(ws)) {
      sendError(ws, 'NOT_JOINED', 'Tiempo agotado: enviá "join" con tu nombre.');
      ws.close();
    }
  }, LIMITS.joinTimeoutMs);
  joinTimers.set(ws, timer);

  ws.on('pong', () => alive.set(ws, true));

  ws.on('message', (raw, isBinary) => {
    if (isBinary) {
      sendError(ws, 'INVALID_JSON', 'Se esperaba un mensaje de texto JSON.');
      return;
    }
    const parsed = parseClientMessage(raw.toString());
    if (!parsed.ok) {
      sendError(ws, parsed.code, parsed.message);
      return;
    }
    void handleMessage(ws, parsed.value).catch((error: unknown) => {
      log('Error al procesar mensaje:', error);
      sendError(ws, 'INTERNAL', 'Ocurrió un error interno al procesar el mensaje.');
    });
  });

  ws.on('close', () => {
    const timer = joinTimers.get(ws);
    if (timer) clearTimeout(timer);
    joinTimers.delete(ws);

    const participantId = sockets.get(ws);
    if (participantId) {
      const participant = list.getParticipant(participantId);
      list.leave(participantId);
      sockets.delete(ws);
      if (participant) log(`Salió ${participant.name}`);
      broadcastState();
    }
  });

  ws.on('error', (error) => log('Error de WebSocket:', error.message));
});

// Detección de conexiones muertas con ping/pong (opcional del TP).
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (alive.get(ws) === false) {
      ws.terminate();
      continue;
    }
    alive.set(ws, false);
    ws.ping();
  }
}, 30_000);

server.listen(config.port, () => {
  log(`Servidor listo en http://localhost:${config.port}`);
  log(`Catálogo: ${config.catalogUrl} | timeout ${config.catalogTimeoutMs} ms | delay ${config.catalogDelayMs} ms`);
  log(`Participantes: ws://localhost:${config.port}/ws | Pantalla: http://localhost:${config.port}/screen`);
});

function shutdown(): void {
  clearInterval(heartbeat);
  for (const ws of wss.clients) ws.close(1001, 'Servidor apagado');
  for (const res of sseClients) res.end();
  wss.close();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
