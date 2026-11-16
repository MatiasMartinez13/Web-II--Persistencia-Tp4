/* Cliente participante: WebSocket nativo del navegador, sin librerías. */
const NAME_KEY = 'tp4:participantName';

const el = (id) => document.getElementById(id);
const joinPanel = el('join-panel');
const app = el('app');
const statusEl = el('status');

let ws = null;
let me = null;
let currentState = { participants: [], products: [] };
let reconnectTimer = null;
let closingOnPurpose = false;

function setStatus(text, offline = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('offline', offline);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function logLine(text, fail = false) {
  const li = document.createElement('li');
  li.textContent = text;
  if (fail) li.classList.add('fail');
  el('log').prepend(li);
  while (el('log').children.length > 30) el('log').lastElementChild.remove();
}

function connect(name) {
  closingOnPurpose = false;
  clearTimeout(reconnectTimer);
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}/ws`);
  ws = socket;

  socket.addEventListener('open', () => {
    setStatus('Conectado');
    socket.send(JSON.stringify({ type: 'join', name }));
  });

  socket.addEventListener('message', (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    handleMessage(msg, name);
  });

  socket.addEventListener('close', () => {
    if (ws === socket) ws = null;
    if (closingOnPurpose) return;
    setStatus('Desconectado, reconectando…', true);
    reconnectTimer = setTimeout(() => connect(name), 1500);
  });

  socket.addEventListener('error', () => setStatus('Error de conexión', true));
}

function handleMessage(msg, name) {
  switch (msg.type) {
    case 'state':
      me = msg.you;
      currentState = msg;
      el('my-name').textContent = me.name;
      render();
      break;

    case 'proposeResult': {
      if (msg.added.length) logLine(`Agregados: ${msg.added.join(', ')}`);
      for (const failure of msg.failures) {
        logLine(`Fallo id ${failure.productId} (${failure.reason}): ${failure.message}`, true);
      }
      if (!msg.added.length && !msg.failures.length) logLine('No hubo cambios.');
      break;
    }

    case 'error':
      logLine(`Error ${msg.code}: ${msg.message}`, true);
      if (msg.code === 'INVALID_NAME' || msg.code === 'ALREADY_JOINED' || msg.code === 'NOT_JOINED') {
        closingOnPurpose = true;
        clearTimeout(reconnectTimer);
        if (ws) ws.close();
        ws = null;
        app.hidden = true;
        joinPanel.hidden = false;
      }
      break;
  }
}

function render() {
  el('participant-count').textContent = String(currentState.participants.length);

  const list = el('participants');
  list.replaceChildren();
  for (const p of currentState.participants) {
    const li = document.createElement('li');
    li.textContent = p.name + (me && p.id === me.id ? ' (vos)' : '');
    list.append(li);
  }

  const products = el('products');
  products.replaceChildren();
  if (!currentState.products.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Todavía no hay productos. Proponé algunos por su id.';
    products.append(p);
    return;
  }

  currentState.products.forEach((product, index) => {
    const card = document.createElement('article');
    card.className = 'product';

    const img = document.createElement('img');
    img.src = product.image;
    img.alt = '';
    img.loading = 'lazy';

    const info = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = `${index + 1}. ${product.title}`;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `$${Number(product.price).toFixed(2)} · propuesto por ${product.proposedBy.name}`;
    const voters = document.createElement('div');
    voters.className = 'voters';
    voters.textContent = product.voters.length
      ? `Votó: ${product.voters.map((v) => v.name).join(', ')}`
      : 'Sin votos';
    const actions = document.createElement('div');
    actions.className = 'actions';

    const voted = me && product.voters.some((v) => v.id === me.id);
    const voteBtn = document.createElement('button');
    voteBtn.textContent = voted ? 'Quitar voto' : 'Votar';
    voteBtn.addEventListener('click', () => send({ type: voted ? 'unvote' : 'vote', productId: product.id }));
    actions.append(voteBtn);

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Quitar';
    removeBtn.title = 'Solo quien lo propuso, o cualquiera si no tiene votos';
    removeBtn.addEventListener('click', () => send({ type: 'remove', productId: product.id }));
    actions.append(removeBtn);

    info.append(title, meta, voters, actions);

    const votes = document.createElement('div');
    votes.className = 'votes';
    votes.textContent = String(product.votes);

    card.append(img, info, votes);
    products.append(card);
  });
}

function send(message) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  else logLine('No hay conexión con el servidor.', true);
}

el('join-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = el('name-input').value.trim();
  if (!name || name.length > 20) {
    logLine('El nombre debe tener entre 1 y 20 caracteres.', true);
    return;
  }
  sessionStorage.setItem(NAME_KEY, name);
  joinPanel.hidden = true;
  app.hidden = false;
  logLine(`Ingresando como ${name}…`);
  connect(name);
});

el('propose-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const raw = el('ids-input').value;
  const productIds = raw.split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  if (!productIds.length || productIds.length > 10 || productIds.some((n) => !Number.isInteger(n) || n < 1)) {
    logLine('Ingresá entre 1 y 10 ids enteros separados por coma.', true);
    return;
  }
  logLine(`Proponiendo ids: ${productIds.join(', ')}…`);
  el('ids-input').value = '';
  send({ type: 'propose', productIds });
});

// Hook de depuración: permite probar mensajes inválidos desde la consola del
// navegador, por ejemplo tp4.sendRaw('{ roto') o tp4.send({ type: 'xxx' }).
window.tp4 = {
  send,
  sendRaw(raw) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(raw);
    else logLine('No hay conexión con el servidor.', true);
  },
};

const savedName = sessionStorage.getItem(NAME_KEY);
if (savedName) el('name-input').value = savedName;
