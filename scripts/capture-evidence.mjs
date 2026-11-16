/**
 * Genera la evidencia del TP4 con Chrome headless:
 *  - capturas de 3 participantes + pantalla sincronizados,
 *  - GIF corto de la sincronización,
 *  - capturas de fallos parciales, catálogo lento y mensaje inválido.
 *
 * Uso: npm run build && npm run evidence
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import GIFEncoder from 'gif-encoder-2';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = resolve(root, 'evidencia');
mkdirSync(evidenceDir, { recursive: true });

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = CHROME_CANDIDATES.find(existsSync);
if (!chromePath) throw new Error('No se encontró Chrome/Edge. Definí CHROME_PATH.');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer(port, extraEnv = {}) {
  const child = spawn(process.execPath, ['dist/server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(`[server ${port}] ${d}`));
  return child;
}

async function waitForServer(port) {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/screen`);
      if (res.ok) return;
    } catch { /* todavía no arranca */ }
    await sleep(100);
  }
  throw new Error(`El servidor en ${port} no arrancó.`);
}

const CELL_W = 1000;
const CELL_H = 700;
const LABELS = ['Participante 1 - Ana', 'Participante 2 - Bob', 'Participante 3 - Carla', 'PANTALLA COMPARTIDA (SSE)'];

function labelSvg(text, x, y) {
  return Buffer.from(`<svg width="${CELL_W}" height="44">
    <rect width="100%" height="100%" fill="#111827"/>
    <text x="14" y="29" font-family="Arial" font-size="20" font-weight="bold" fill="#ffffff">${text}</text>
  </svg>`);
}

async function screenshotWithLabel(page, label) {
  const shot = await page.screenshot({ type: 'png' });
  const labelled = await sharp(shot)
    .composite([{ input: labelSvg(label, 0, 0), top: 0, left: 0 }])
    .png()
    .toBuffer();
  return labelled;
}

async function makeCollage(pages, name) {
  const shots = await Promise.all(pages.map((page, i) => screenshotWithLabel(page, LABELS[i])));
  const collage = await sharp({
    create: { width: CELL_W * 2, height: CELL_H * 2, channels: 4, background: '#ffffff' },
  })
    .composite(shots.map((input, i) => ({ input, left: (i % 2) * CELL_W, top: Math.floor(i / 2) * CELL_H })))
    .png()
    .toBuffer();
  writeFileSync(resolve(evidenceDir, name), collage);
  return collage;
}

async function buildGif(frames, name) {
  const width = 1200;
  const height = Math.round((CELL_H * 2 * width) / (CELL_W * 2));
  const raws = [];
  for (const frame of frames) {
    const { data } = await sharp(frame).resize(width, height).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    raws.push(data);
  }
  const gif = new GIFEncoder(width, height, 'neuquant', true, raws.length);
  gif.setDelay(1600);
  gif.setRepeat(0);
  gif.start();
  for (const data of raws) gif.addFrame(data);
  gif.finish();
  writeFileSync(resolve(evidenceDir, name), gif.out.getData());
}

async function join(page, name) {
  await page.goto('http://localhost:3000/');
  await page.fill('#name-input', name);
  await page.click('#join-form button');
  await page.waitForFunction(
    (n) => [...document.querySelectorAll('#participants li')].some((li) => li.textContent.includes(n)),
    name,
  );
}

async function propose(page, ids) {
  await page.fill('#ids-input', ids);
  await page.click('#propose-form button');
}

async function waitProducts(page, count) {
  await page.waitForFunction((c) => document.querySelectorAll('#products .product').length >= c, count, { timeout: 30000 });
}

async function main() {
  const server = startServer(3000);
  const slowServer = startServer(3001, { CATALOG_DELAY_MS: '3000' });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'] });

  try {
    await Promise.all([waitForServer(3000), waitForServer(3001)]);
    const context = await browser.newContext({ viewport: { width: CELL_W, height: CELL_H - 44 } });
    const ana = await context.newPage();
    const bob = await context.newPage();
    const carla = await context.newPage();
    const screen = await context.newPage();

    console.log('Generando: ingreso de 3 participantes...');
    await Promise.all([join(ana, 'Ana'), join(bob, 'Bob'), join(carla, 'Carla')]);
    await screen.goto('http://localhost:3000/screen');
    await screen.waitForFunction(() => document.getElementById('participant-count')?.textContent === '3');
    await sleep(300);
    const frames = [await makeCollage([ana, bob, carla, screen], '01-tres-participantes-ingreso.png')];

    console.log('Generando: propuesta sincronizada...');
    await propose(ana, '1, 2, 3');
    await Promise.all([waitProducts(ana, 3), waitProducts(bob, 3), waitProducts(carla, 3)]);
    await screen.waitForFunction(() => document.querySelectorAll('.screen-row').length === 3);
    await sleep(300);
    frames.push(await makeCollage([ana, bob, carla, screen], '01-tres-participantes-propuesta.png'));

    console.log('Generando: votos sincronizados...');
    await bob.locator('.product').nth(0).getByRole('button', { name: 'Votar' }).click();
    await carla.locator('.product').nth(0).getByRole('button', { name: 'Votar' }).click();
    await ana.locator('.product').nth(0).getByRole('button', { name: 'Votar' }).click();
    await ana.waitForFunction(() => document.querySelector('.product .votes')?.textContent === '3');
    await screen.waitForFunction(() => document.querySelector('.votes-big')?.textContent.includes('3'));
    await sleep(300);
    frames.push(await makeCollage([ana, bob, carla, screen], '01-tres-participantes-votos.png'));

    await buildGif(frames, '01-tres-participantes-y-pantalla.gif');
    await screen.screenshot({ path: resolve(evidenceDir, '06-pantalla-ranking.png') });

    console.log('Generando: fallos parciales...');
    await propose(ana, '10, 11, 999999');
    await ana.waitForFunction(() => document.querySelectorAll('#log li').length >= 1 && document.body.innerText.includes('999999'));
    await waitProducts(ana, 5);
    await sleep(200);
    await ana.screenshot({ path: resolve(evidenceDir, '02-propuesta-fallos-parciales.png') });
    await bob.screenshot({ path: resolve(evidenceDir, '02b-fallos-parciales-otro-participante.png') });

    console.log('Generando: catálogo lento...');
    const slowContext = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    const lenta = await slowContext.newPage();
    await lenta.goto('http://localhost:3001/');
    await lenta.fill('#name-input', 'Lenta');
    await lenta.click('#join-form button');
    await lenta.waitForFunction(() => document.querySelector('#app')?.hasAttribute('hidden') === false);
    await propose(lenta, '21, 22');
    await lenta.waitForFunction(() => document.body.innerText.includes('Proponiendo ids: 21, 22'));
    await lenta.waitForFunction(() => document.getElementById('pending')?.hasAttribute('hidden') === false);
    await lenta.screenshot({ path: resolve(evidenceDir, '03-catalogo-lento-esperando.png') });
    await lenta.waitForFunction(() => document.querySelectorAll('#products .product').length === 2, null, { timeout: 30000 });
    await sleep(200);
    await lenta.screenshot({ path: resolve(evidenceDir, '03b-catalogo-lento-resultado.png') });

    console.log('Generando: mensaje inválido...');
    await ana.evaluate(() => {
      window.tp4.sendRaw('{ roto');
      window.tp4.send({ type: 'xxx' });
      window.tp4.send({ type: 'propose', productIds: [] });
    });
    await ana.waitForFunction(() => document.querySelectorAll('#log li.fail').length >= 3);
    await ana.screenshot({ path: resolve(evidenceDir, '04-mensaje-invalido.png') });

    console.log('Listo. Archivos en', evidenceDir);
  } finally {
    await browser.close();
    server.kill();
    slowServer.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
