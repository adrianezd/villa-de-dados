'use strict';

/* =========================================================================
   Villa de dados — tira y construye (juego de mesa de un jugador)
   Un tablero de 6×6. Cada turno se tiran tres dados: uno dice QUÉ
   construyes (su cara es un edificio) y otro DÓNDE: en la fila o en la
   columna de ese número. El tercero se descarta. Cuando el pueblo se
   llena, cada edificio puntúa según lo que tenga alrededor.
   Reto del día (los mismos dados para todo el mundo) o partida libre.
   ========================================================================= */

const N = 6;
const STORE = 'villa-dados-v1';

const B = {
  1: { name: 'Casa', emoji: '🏠', rule: '1 punto por cada tipo distinto de edificio que la toque.' },
  2: { name: 'Campo', emoji: '🌾', rule: 'Cada grupo de campos unidos: 1, 3, 6, 10, 15 o 21 puntos según su tamaño.' },
  3: { name: 'Fuente', emoji: '⛲', rule: '2 puntos por cada casa que la toque.' },
  4: { name: 'Taller', emoji: '🔨', rule: '3 puntos si toca alguna casa, menos 1 por cada taller que la toque.' },
  5: { name: 'Mercado', emoji: '🛒', rule: '1 punto por cada casa en su fila y en su columna.' },
  6: { name: 'Iglesia', emoji: '⛪', rule: '1 punto por cada edificio en las 8 casillas de alrededor.' },
  7: { name: 'Ruina', emoji: '🪨', rule: '−2 puntos. Sale cuando no se puede construir nada.' }
};
const TRI = [0, 1, 3, 6, 10, 15, 21];

/* ------------------------------- Azar con semilla ------------------------------- */

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

/* ---------------------------------- Estado ---------------------------------- */

let store = load();
let G = null; // { mode, day, grid[36], dice[3], turn, rand, pick: { b, l }, history }
const el = {};

function load() {
  try { return Object.assign({ best: 0, played: 0, daily: {}, sound: true }, JSON.parse(localStorage.getItem(STORE) || '{}')); }
  catch (e) { return { best: 0, played: 0, daily: {}, sound: true }; }
}
function save() { try { localStorage.setItem(STORE, JSON.stringify(store)); } catch (e) { /* sin guardar */ } }

function newGame(mode) {
  const day = today();
  const seed = mode === 'daily' ? hash(`villa-${day}`) : Math.floor(Math.random() * 2 ** 32);
  G = { mode, day, grid: new Array(N * N).fill(0), turn: 0, rand: rng(seed), pick: null, last: -1, done: false };
  if (mode === 'daily' && store.daily[day] && store.daily[day].grid) {
    // el reto del día ya jugado: se enseña tal cual quedó
    G.grid = store.daily[day].grid.slice();
    G.done = true;
    G.dice = [];
    render();
    showEnd(true);
    return;
  }
  roll();
  render();
}

function roll() {
  G.dice = [0, 0, 0].map(() => 1 + Math.floor(G.rand() * 6));
  G.turn += 1;
  G.pick = null;
  if (!options().length) G.pick = { ruin: true };
}

const free = (k) => G.grid[k] === 0;
const lineCells = (n) => { const r = n - 1; const out = []; for (let c = 0; c < N; c++) out.push(r * N + c); for (let rr = 0; rr < N; rr++) if (rr !== r) out.push(rr * N + r); return out; };

// combinaciones posibles: dado del edificio (b) y dado del lugar (l)
function options() {
  const out = [];
  for (let b = 0; b < 3; b++) for (let l = 0; l < 3; l++) {
    if (b === l) continue;
    if (lineCells(G.dice[l]).some(free)) out.push([b, l]);
  }
  return out;
}

function place(k) {
  if (!free(k) || G.done) return;
  let type;
  if (G.pick && G.pick.ruin) type = 7;
  else {
    if (!G.pick || G.pick.b == null || G.pick.l == null) return;
    if (!lineCells(G.dice[G.pick.l]).includes(k)) return;
    type = G.dice[G.pick.b];
  }
  G.grid[k] = type;
  G.last = k;
  sound('place');
  if (G.grid.every((v) => v)) { finish(); return; }
  roll();
  render();
}

function choose(i) {
  if (G.done || (G.pick && G.pick.ruin)) return;
  const p = G.pick || {};
  if (p.b === i) { G.pick = null; render(); return; }
  if (p.l === i) { G.pick = { b: p.b }; render(); return; }
  if (p.b == null) {
    if (!options().some(([b]) => b === i)) { toast('Con ese edificio no cabe nada: elige otro dado'); return; }
    G.pick = { b: i };
  }
  else if (p.l == null) {
    if (!lineCells(G.dice[i]).some(free)) { toast(`La fila y la columna ${G.dice[i]} están llenas`); return; }
    G.pick = { b: p.b, l: i };
  }
  sound('tap');
  render();
}

/* --------------------------------- Puntos --------------------------------- */

const nb4 = (k) => { const r = Math.floor(k / N); const c = k % N; return [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(([a, b]) => a >= 0 && a < N && b >= 0 && b < N).map(([a, b]) => a * N + b); };
const nb8 = (k) => { const r = Math.floor(k / N); const c = k % N; const out = []; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { if (!a && !b) continue; const rr = r + a; const cc = c + b; if (rr >= 0 && rr < N && cc >= 0 && cc < N) out.push(rr * N + cc); } return out; };

function scoreCell(grid, k) {
  const t = grid[k];
  const around = nb4(k).map((j) => grid[j]);
  switch (t) {
    case 1: return new Set(around.filter((v) => v && v !== 7)).size;
    case 3: return 2 * around.filter((v) => v === 1).length;
    case 4: return around.includes(1) ? 3 - around.filter((v) => v === 4).length : 0;
    case 5: { const r = Math.floor(k / N); const c = k % N; let n = 0; for (let i = 0; i < N; i++) { if (grid[r * N + i] === 1) n++; if (grid[i * N + c] === 1) n++; } return n; }
    case 6: return nb8(k).filter((j) => grid[j] && grid[j] !== 7).length;
    case 7: return -2;
    default: return 0;
  }
}

function fieldGroups(grid) {
  const seen = new Set();
  const groups = [];
  grid.forEach((v, k) => {
    if (v !== 2 || seen.has(k)) return;
    const g = [];
    const stack = [k];
    seen.add(k);
    while (stack.length) { const x = stack.pop(); g.push(x); nb4(x).forEach((j) => { if (grid[j] === 2 && !seen.has(j)) { seen.add(j); stack.push(j); } }); }
    groups.push(g);
  });
  return groups;
}

function score(grid) {
  const by = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
  grid.forEach((v, k) => { if (v && v !== 2) by[v] += scoreCell(grid, k); });
  fieldGroups(grid).forEach((g) => { by[2] += TRI[Math.min(6, g.length)]; });
  const total = Object.values(by).reduce((a, b) => a + b, 0);
  return { by, total };
}

// puntos que daría cada casilla ya construida (para enseñarlos en el tablero)
function cellPoints(grid) {
  const pts = grid.map((v, k) => (v && v !== 2 ? scoreCell(grid, k) : null));
  fieldGroups(grid).forEach((g) => { const each = TRI[Math.min(6, g.length)] / g.length; g.forEach((k) => { pts[k] = Math.round(each * 10) / 10; }); });
  return pts;
}

/* --------------------------------- Final --------------------------------- */

const RANKS = [[110, '🏰', 'Ciudad de leyenda'], [90, '🏛️', 'Villa próspera'], [70, '🏘️', 'Pueblo animado'], [50, '🏡', 'Aldea tranquila'], [-99, '🛖', 'Caserío']];

function finish() {
  G.done = true;
  const s = score(G.grid).total;
  store.played += 1;
  const record = s > store.best;
  if (record) store.best = s;
  if (G.mode === 'daily') store.daily[G.day] = { score: s, grid: G.grid.slice() };
  // solo se guardan los últimos 30 retos
  Object.keys(store.daily).sort().slice(0, -30).forEach((d) => delete store.daily[d]);
  save();
  sound('win');
  render();
  showEnd(false, record);
}

function showEnd(replay, record) {
  const { by, total } = score(G.grid);
  const [, emoji, title] = RANKS.find(([min]) => total >= min);
  el.endEmoji.textContent = emoji;
  el.endTitle.textContent = `${total} puntos`;
  el.endRank.textContent = `${title}${record ? ' · ¡nuevo récord!' : ''}${replay ? ' · reto de hoy ya jugado' : ''}`;
  el.endTable.innerHTML = [1, 2, 3, 4, 5, 6, 7].filter((t) => by[t] || G.grid.includes(t)).map((t) =>
    `<li><span>${B[t].emoji} ${B[t].name} ×${G.grid.filter((v) => v === t).length}</span><strong>${by[t]}</strong></li>`).join('');
  el.share.hidden = G.mode !== 'daily';
  el.end.hidden = false;
}

function shareText() {
  const rows = [];
  for (let r = 0; r < N; r++) rows.push(G.grid.slice(r * N, r * N + N).map((v) => B[v] ? B[v].emoji : '⬜').join(''));
  return `Villa de dados ${G.day}: ${score(G.grid).total} puntos\n${rows.join('\n')}\nhttps://adrianezd.github.io/villa-de-dados/`;
}

/* --------------------------------- Pintar --------------------------------- */

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
function dieHtml(v, i) {
  const p = G.pick || {};
  const role = p.b === i ? 'is-build' : p.l === i ? 'is-place' : '';
  const dim = !role && p.b != null && p.l != null;
  return `<button type="button" class="die ${role}${dim ? ' is-off' : ''}" data-die="${i}" aria-label="Dado ${v}">` +
    `<span class="pips">${Array.from({ length: 9 }, (_, k) => `<i class="${PIPS[v].includes(k) ? 'on' : ''}"></i>`).join('')}</span>` +
    `<span class="die-b">${B[v].emoji}</span>` +
    `${role ? `<em>${role === 'is-build' ? 'Edificio' : 'Lugar'}</em>` : ''}</button>`;
}

function render() {
  const p = G.pick || {};
  const live = !G.done && p.ruin ? G.grid.map((v, k) => (v ? -1 : k)).filter((k) => k >= 0)
    : !G.done && p.l != null ? lineCells(G.dice[p.l]).filter(free) : [];
  const preview = p.b != null && !p.ruin ? G.dice[p.b] : p.ruin ? 7 : 0;
  const pts = cellPoints(G.grid);
  el.grid.innerHTML = G.grid.map((v, k) => {
    const r = Math.floor(k / N) + 1;
    const c = (k % N) + 1;
    const can = live.includes(k);
    const hi = p.l != null && !p.ruin && (r === G.dice[p.l] || c === G.dice[p.l]);
    return `<button type="button" class="cell t${v}${can ? ' can' : ''}${hi ? ' hi' : ''}${k === G.last ? ' last' : ''}" data-cell="${k}" ${can ? '' : 'tabindex="-1"'} aria-label="Fila ${r}, columna ${c}${v ? `: ${B[v].name}` : ''}">` +
      (v ? `<span class="b">${B[v].emoji}</span>${pts[k] != null && store.showPts ? `<small>${pts[k]}</small>` : ''}` : can && preview ? `<span class="b ghost">${B[preview].emoji}</span>` : '') + '</button>';
  }).join('');
  el.rowNums.innerHTML = Array.from({ length: N }, (_, i) => `<span class="${p.l != null && !p.ruin && G.dice[p.l] === i + 1 ? 'hi' : ''}">${i + 1}</span>`).join('');
  el.colNums.innerHTML = el.rowNums.innerHTML;
  el.dice.innerHTML = G.done ? '' : p.ruin ? '<p class="ruin-msg">🪨 Con estos dados no cabe nada: pon una ruina en cualquier casilla libre.</p>' : G.dice.map(dieHtml).join('');
  el.step.textContent = G.done ? 'Pueblo terminado' : p.ruin ? 'Toca una casilla libre' : p.b == null ? '1. Elige el dado del edificio' : p.l == null ? '2. Elige el dado del lugar: fila o columna' : '3. Toca dónde construyes';
  const filled = G.grid.filter(Boolean).length;
  el.turn.textContent = `${filled}/${N * N}`;
  el.score.textContent = String(score(G.grid).total);
  el.best.textContent = store.best ? String(store.best) : '—';
  el.mode.textContent = G.mode === 'daily' ? `Reto del ${G.day.split('-').reverse().join('/')}` : 'Partida libre';
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('is-on', b.dataset.mode === G.mode));
  el.pts.checked = Boolean(store.showPts);
}

let toastTimer = 0;
function toast(t) {
  el.toast.textContent = t;
  el.toast.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('on'), 2000);
}

let actx = null;
function sound(kind) {
  if (!store.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime;
    const notes = kind === 'win' ? [523, 659, 784, 1047] : [kind === 'place' ? 392 : 660];
    notes.forEach((f, i) => {
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.15, t + i * 0.09 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.18);
      o.connect(g).connect(actx.destination);
      o.start(t + i * 0.09);
      o.stop(t + i * 0.09 + 0.2);
    });
  } catch (e) { /* sin sonido */ }
}

/* --------------------------------- Eventos --------------------------------- */

function init() {
  ['grid', 'dice', 'step', 'turn', 'score', 'best', 'mode', 'end', 'end-emoji', 'end-title', 'end-rank', 'end-table', 'share', 'again', 'close', 'toast', 'row-nums', 'col-nums', 'sound', 'pts', 'legend'].forEach((k) => {
    el[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(k);
  });
  el.legend.innerHTML = [1, 2, 3, 4, 5, 6].map((t) => `<li><span class="lg-die">${t}</span><span class="lg-b">${B[t].emoji}</span><div><strong>${B[t].name}</strong><p>${B[t].rule}</p></div></li>`).join('') +
    `<li><span class="lg-die">✕</span><span class="lg-b">${B[7].emoji}</span><div><strong>${B[7].name}</strong><p>${B[7].rule}</p></div></li>`;
  el.dice.addEventListener('click', (e) => { const d = e.target.closest('[data-die]'); if (d) choose(Number(d.dataset.die)); });
  el.grid.addEventListener('click', (e) => { const c = e.target.closest('[data-cell]'); if (c) place(Number(c.dataset.cell)); });
  document.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => { el.end.hidden = true; newGame(b.dataset.mode); }; });
  el.again.onclick = () => { el.end.hidden = true; newGame('free'); };
  el.close.onclick = () => { el.end.hidden = true; };
  el.share.onclick = () => {
    const t = shareText();
    if (navigator.share) navigator.share({ text: t }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => toast('Copiado 📋'), () => toast('No se pudo copiar'));
  };
  el.sound.checked = store.sound;
  el.sound.onchange = () => { store.sound = el.sound.checked; save(); };
  el.pts.onchange = () => { store.showPts = el.pts.checked; save(); render(); };
  const dailyDone = store.daily[today()];
  newGame(dailyDone ? 'free' : 'daily');
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
}

document.addEventListener('DOMContentLoaded', init);
