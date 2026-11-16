/* Cliente pantalla: Server-Sent Events con EventSource (nativo). */
const statusEl = document.getElementById('status');
const countEl = document.getElementById('participant-count');
const rankingEl = document.getElementById('ranking');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

const source = new EventSource('/events');

source.addEventListener('open', () => {
  statusEl.textContent = 'En vivo ●';
  statusEl.classList.remove('offline');
});

source.addEventListener('error', () => {
  statusEl.textContent = 'Reconectando…';
  statusEl.classList.add('offline');
});

source.addEventListener('state', (event) => {
  const data = JSON.parse(event.data);
  render(data);
});

function render(data) {
  countEl.textContent = String(data.participantCount);
  rankingEl.replaceChildren();

  if (!data.products.length) {
    const p = document.createElement('div');
    p.className = 'empty';
    p.textContent = 'Esperando propuestas…';
    rankingEl.append(p);
    return;
  }

  data.products.forEach((product, index) => {
    const row = document.createElement('div');
    row.className = 'screen-row';
    row.innerHTML = `
      <div class="rank">${index + 1}</div>
      <img src="${escapeHtml(product.image)}" alt="" />
      <div>
        <div style="font-size:1.1rem;font-weight:600">${escapeHtml(product.title)}</div>
        <div style="opacity:.7">$${Number(product.price).toFixed(2)} · ${escapeHtml(product.proposedBy.name)}</div>
      </div>
      <div class="votes-big">${product.votes} ${product.votes === 1 ? 'voto' : 'votos'}</div>
    `;
    rankingEl.append(row);
  });
}
