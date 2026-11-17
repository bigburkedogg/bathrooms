// Bathroom Planner — shell, routing, and the table/text views. Drawings live in draw.js, 3D in view3d.js.
import { build, validate, surfaces, CONF_LABEL, CONF_ORDER, TYPES, fmtIn, fmtFtIn, money, sqft, add, sub, mul, dot } from './model.js';
import { planSVG, elevationSVG, unfoldedSVG } from './draw.js';
import * as tiles from './tiles.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f1 = v => (v == null ? '—' : v.toFixed(1));

const IC = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  plan: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
  walls: '<rect x="4" y="4" width="16" height="16" rx="1"/>',
  unfolded: '<rect x="2" y="5" width="5" height="14"/><rect x="9.5" y="5" width="5" height="14"/><rect x="17" y="5" width="5" height="14"/>',
  '3d': '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 22V12M21 7l-9 5-9-5"/>',
  quantities: '<path d="M9 6h12M9 12h12M9 18h12"/><path d="M4 5v2M3.5 12h1.5l-1.5 2h1.5M3.5 17h1.5v2H3.5"/>',
  materials: '<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="10" r="1.3"/><circle cx="12" cy="7.5" r="1.3"/><circle cx="15.5" cy="10" r="1.3"/><path d="M12 21a3 3 0 0 1 0-6h1"/>',
  open: '<path d="M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17"/><path d="M11 6h10M11 12h10M11 18h10"/>',
  measure: '<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
  source: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M10 13l-2 2 2 2M14 13l2 2-2 2"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  dims: '<path d="M3 8h18M3 5v6M21 5v6"/><path d="M6 16h12"/>',
  labels: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
  courses: '<path d="M4 4v16M10 4v16M16 4v16M20 4v16"/>',
  trim: '<path d="M4 20h16M7 20L12 5l5 15"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};
const icon = (k, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${IC[k] || ''}</svg>`;

const VIEWS = [
  ['overview', 'Overview'], ['plan', 'Floor Plan'], ['walls', 'Wall Elevations'], ['unfolded', 'Unfolded Run'], ['3d', '3D Preview'],
  ['quantities', 'Quantities'], ['materials', 'Materials'], ['open', 'Open Items'], ['measure', 'Measurements'], ['source', 'Source Data'],
];

const S = {
  rooms: [], id: null, raw: null, M: null, errs: [], view: 'overview', wall: null,
  opts: Object.assign({ dims: true, labels: true, courses: true, trim: true }, JSON.parse(localStorage.getItem('bp-opts') || '{}')),
  undo: [], redo: [], saveTimer: null, saveState: 'idle', savedAt: null, three: null, goalIdx: 0,
  lib: null, tex: null, texKey: '', cam3d: null, thumbs: {},
};
const dopts = extra => ({ ...S.opts, tex: S.tex, sel: S.sel, ...extra });

// Real tile textures for the drawings. Rebuilt only when the room's tile materials change.
async function ensureTex() {
  const mats = Object.fromEntries(Object.entries(S.raw?.materials || {}).filter(([, m]) => m.kind === 'tile'));
  const key = JSON.stringify(mats);
  if (key === S.texKey) return false;
  S.texKey = key;
  try { S.tex = await tiles.svgTextures(mats); } catch (e) { S.tex = null; console.warn('textures', e); }
  return key === S.texKey;
}

// ---------- api ----------
async function api(method, url, body) {
  if (SHARE) return shareApi(method, url, body);
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error((await r.text()) || r.statusText);
  return r.json();
}

// ---------- the shared (published) copy: static files, visitors' changes kept in their own browser ----------
const SHARE = !!window.BP_SHARE;
const LS = 'bp-share:';
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(LS + k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => localStorage.setItem(LS + k, JSON.stringify(v));
async function shareApi(method, url, body) {
  const get = async p => { const r = await fetch(p, { cache: 'no-cache' }); if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); };
  const roomId = url.startsWith('/api/rooms/') ? decodeURIComponent(url.slice('/api/rooms/'.length)) : null;
  if (method === 'GET' && url === '/api/rooms') return (await get('api/rooms.json')).concat(lsGet('new-rooms', []));
  if (method === 'GET' && roomId) { const mine = lsGet('room:' + roomId, null); return mine || get(`api/rooms/${encodeURIComponent(roomId)}.json`); }
  if (method === 'PUT' && roomId) { lsSet('room:' + roomId, body); return { ok: true }; }
  if (method === 'POST' && url === '/api/rooms') {
    lsSet('room:' + body.id, body);
    lsSet('new-rooms', lsGet('new-rooms', []).concat([{ id: body.id, name: body.name, property: body.property, order: 99 }]));
    return { ok: true, id: body.id };
  }
  if (method === 'GET' && url === '/api/library') return { ...(await get('api/library.json')), ...lsGet('library', {}) };
  if (method === 'POST' && url === '/api/library') { const lib = lsGet('library', {}), { id, ...rest } = body; lib[id] = rest; lsSet('library', lib); return { ok: true, id }; }
  if (method === 'POST' && url === '/api/upload') return { ok: true, path: body.data }; // the photo stays in this browser as a data URL
  throw new Error('Not available in the shared copy.');
}
const hasLocalEdits = () => SHARE && S.id && localStorage.getItem(LS + 'room:' + S.id) != null;
// The library is the record for what a tile is (size, look, colour, price, photo). A room keeps its own
// copy so it still works if a tile leaves the library, but takes the library's facts on load. What
// belongs to the room stays: how it's laid, and this project's vendor sheet, status and budget line.
const ROOM_KEYS = ['orientation', 'pattern', 'selection', 'where', 'status', 'allowance'];
function syncFromLibrary(raw) {
  if (!S.lib || !raw?.materials) return false;
  let changed = false;
  for (const [id, m] of Object.entries(raw.materials)) {
    const L = S.lib[id];
    if (!L || m.kind !== 'tile') continue;
    const merged = { ...m, ...L };
    for (const k of ROOM_KEYS) { if (m[k] !== undefined) merged[k] = m[k]; }
    for (const k of Object.keys(m)) if (!(k in L)) merged[k] = m[k];
    if (JSON.stringify(merged) !== JSON.stringify(m)) { raw.materials[id] = merged; changed = true; }
  }
  return changed;
}
function rebuild() {
  S.errs = validate(S.raw);
  try { S.M = S.errs.length ? null : build(S.raw); } catch (e) { S.M = null; S.errs.push('Build failed: ' + e.message); }
}
function scheduleSave() {
  clearTimeout(S.saveTimer);
  S.saveState = 'pending'; paintSaveState();
  S.saveTimer = setTimeout(async () => {
    S.saveState = 'saving'; paintSaveState();
    try {
      await api('PUT', '/api/rooms/' + encodeURIComponent(S.id), S.raw);
      S.saveState = 'saved'; S.savedAt = new Date();
      const r = S.rooms.find(x => x.id === S.id); if (r) { r.name = S.raw.name; r.property = S.raw.property; r.subtitle = S.raw.subtitle; }
    } catch (e) { S.saveState = 'error'; S.saveErr = e.message; }
    paintSaveState();
  }, 350);
}
function commit(next, { rerender = true } = {}) {
  S.undo.push(JSON.stringify(S.raw)); if (S.undo.length > 200) S.undo.shift();
  S.redo = [];
  S.raw = next; rebuild(); scheduleSave();
  if (rerender) render(); else { paintSide(); paintTop(); }
  ensureTex().then(changed => { if (changed && rerender) render(); });
}
function undo() { if (!S.undo.length) return; S.redo.push(JSON.stringify(S.raw)); S.raw = JSON.parse(S.undo.pop()); rebuild(); scheduleSave(); render(); ensureTex().then(c => c && render()); }
function redo() { if (!S.redo.length) return; S.undo.push(JSON.stringify(S.raw)); S.raw = JSON.parse(S.redo.pop()); rebuild(); scheduleSave(); render(); ensureTex().then(c => c && render()); }
const clone = o => JSON.parse(JSON.stringify(o));

// ---------- routing ----------
function go(view, wall) { location.hash = `#/${S.id}/${view}${wall ? '/' + wall : ''}`; }
async function route() {
  const [, id, view, wall] = location.hash.split('/');
  if (!S.rooms.length) S.rooms = await api('GET', '/api/rooms');
  if (!S.lib) S.lib = await api('GET', '/api/library').catch(() => ({}));
  if (id === 'new') { S.view = 'new'; render(); return; }
  if (id === 'import' && !SHARE) { await importFromBookmark(location.hash.slice('#/import/'.length)); return; }
  const target = S.rooms.find(r => r.id === id) ? id : S.rooms[0]?.id;
  if (!target) { S.view = 'new'; render(); return; }
  if (target !== S.id) {
    S.raw = await api('GET', '/api/rooms/' + encodeURIComponent(target));
    S.id = target; S.undo = []; S.redo = []; S.goalIdx = 0; S.sel = null; S.cam3d = null;
    if (syncFromLibrary(S.raw)) scheduleSave();
    rebuild();
  }
  await ensureTex();
  S.view = VIEWS.some(v => v[0] === view) ? view : 'overview';
  S.wall = decodeURIComponent(wall || '');
  if (id !== target || !view) { history.replaceState(null, '', `#/${S.id}/${S.view}${S.wall ? '/' + S.wall : ''}`); }
  render();
}

// ---------- chrome ----------
function paintSide() {
  const M = S.M, groups = {};
  for (const r of S.rooms) (groups[r.property || 'Other'] ||= []).push(r);
  const opts = Object.entries(groups).map(([p, rs]) => `<optgroup label="${esc(p)}">${rs.map(r => `<option value="${esc(r.id)}" ${r.id === S.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</optgroup>`).join('');
  const badge = v => {
    if (!M) return '';
    if (v === 'open') return M.open.length ? `<span class="badge">${M.open.length}</span>` : '';
    if (v === 'overview') { const n = M.issues.length; return n ? `<span class="badge warn">${n}</span>` : ''; }
    if (v === 'measure') return `<span class="badge soft">${M.doneDims}/${M.dims.length}</span>`;
    return '';
  };
  $('#side').innerHTML = `
    <div class="side-top">
      <div class="eyebrow">ROOM</div>
      <select id="room-pick">${opts}</select>
      <div class="asof">${S.raw ? 'AS OF ' + esc(S.raw.as_of || '—') : ''}</div>
    </div>
    <nav>${VIEWS.map(([v, l]) => `<a href="#/${esc(S.id)}/${v}" class="nav ${S.view === v ? 'on' : ''}" data-v="${v}">${icon(v)}<span>${l}</span>${badge(v)}</a>`).join('')}
      <a href="#/new" class="nav add ${S.view === 'new' ? 'on' : ''}">${icon('plus')}<span>New bathroom</span></a></nav>
    <div class="side-foot">${M ? `
      <div><span>Overall conf:</span><b class="conf-${M.conf}">${CONF_LABEL[M.conf].toUpperCase()}</b></div>
      <div><span>Walls close:</span><b class="${M.closed ? 'ok' : 'bad'}">${M.closed ? 'YES' : 'OFF ' + fmtIn(M.closure)}</b></div>
      <div><span>Measured:</span><b>${M.doneDims} OF ${M.dims.length}</b></div>` : ''}
    </div>`;
  $('#room-pick').onchange = e => { location.hash = `#/${e.target.value}/${S.view === 'new' ? 'overview' : S.view}`; };
}
function paintTop() {
  const t = (k, label) => `<button class="tog ${S.opts[k] ? 'on' : ''}" data-tog="${k}" title="${label}">${icon(k)}<span>${label}</span></button>`;
  $('#top').innerHTML = `
    <div class="ur"><button id="undo" ${S.undo.length ? '' : 'disabled'} title="Undo (⌘Z)">${icon('undo')}</button><button id="redo" ${S.redo.length ? '' : 'disabled'} title="Redo (⇧⌘Z)">${icon('redo')}</button><span id="save-state"></span>
      ${SHARE ? (hasLocalEdits() ? '<button id="share-reset" class="pub">Reset to the published plan</button>' : '') : '<button id="publish" class="pub" title="Update the shared link with this plan">Publish</button><span id="pub-state" class="save"></span>'}</div>
    <div class="togs">${t('dims', 'Dimensions')}${t('labels', 'Labels')}${t('courses', 'Courses')}${t('trim', 'Trim')}</div>`;
  $('#undo').onclick = undo; $('#redo').onclick = redo;
  const pubBtn = $('#publish');
  if (pubBtn) pubBtn.onclick = async () => {
    const st = $('#pub-state'); pubBtn.disabled = true; st.textContent = 'Publishing…';
    try {
      clearTimeout(S.saveTimer); await api('PUT', '/api/rooms/' + encodeURIComponent(S.id), S.raw);
      const r = await api('POST', '/api/publish', {});
      st.innerHTML = `${r.changed ? 'Published' : 'Already up to date'} · <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url.replace(/^https?:\/\//, ''))}</a>`;
    } catch (e) { st.textContent = 'Not published — ' + e.message.slice(0, 120); }
    pubBtn.disabled = false;
  };
  const resetBtn = $('#share-reset');
  if (resetBtn) resetBtn.onclick = async () => {
    localStorage.removeItem(LS + 'room:' + S.id);
    S.raw = await api('GET', '/api/rooms/' + encodeURIComponent(S.id)); S.undo = []; S.redo = []; S.sel = null; rebuild(); await ensureTex(); render();
  };
  $$('[data-tog]').forEach(b => b.onclick = () => {
    const k = b.dataset.tog; S.opts[k] = !S.opts[k]; localStorage.setItem('bp-opts', JSON.stringify(S.opts));
    if (S.view === '3d' && S.three) { S.three.update(S.opts); paintTop(); } else render();
  });
  paintSaveState();
}
function paintSaveState() {
  const el = $('#save-state'); if (!el) return;
  const st = S.saveState;
  el.className = 'save ' + st;
  el.textContent = st === 'pending' || st === 'saving' ? 'Saving…' : st === 'saved' ? (SHARE ? 'Saved in this browser' : 'Saved ' + S.savedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) : st === 'error' ? 'Not saved — ' + (S.saveErr || 'server unreachable') : '';
  if (SHARE && st === 'saved' && !$('#share-reset')) paintTop();
}

function render() {
  if (S.three) { if (S.three.getCam) S.cam3d = S.three.getCam(); S.three.dispose(); S.three = null; }
  paintSide(); paintTop();
  const main = $('#main');
  main.className = 'view-' + S.view;
  if (S.view === 'new') { main.innerHTML = viewNew(); bindNew(); return; }
  if (!S.M) { main.innerHTML = viewSource(true); bindSource(); return; }
  const fn = { overview: viewOverview, plan: viewPlan, walls: viewWalls, unfolded: viewUnfolded, '3d': view3D, quantities: viewQuantities, materials: viewMaterials, open: viewOpen, measure: viewMeasure, source: viewSource }[S.view];
  main.innerHTML = fn();
  ({ '3d': bind3D, measure: bindMeasure, source: bindSource, overview: bindOverview, walls: bindWalls, plan: bindPlan, materials: bindMaterials }[S.view] || (() => {}))();
}

// ---------- overview ----------
const confChip = c => `<span class="chip conf-${c}">${esc(CONF_LABEL[c] || c)}</span>`;
function viewOverview() {
  const M = S.M, R = S.raw, w = M.walls;
  const size = w.length === 4 && w.every(x => x.turn === 'R') ? `${fmtIn(w[0].len)} × ${fmtIn(w[1].len)} × ${fmtIn(M.H)}` : `${w.length} walls · ${fmtIn(M.H)} ceiling`;
  const now = (R.photos || []).filter(p => p.role === 'now');
  const goal = (R.photos || []).filter(p => p.role === 'goal');
  const g = goal[S.goalIdx % Math.max(goal.length, 1)];
  const priced = M.tile.filter(t => t.cost != null);
  const kpi = (href, ic, label, val, unit, sub) => `<a class="kpi" href="${href}"><div class="kpi-ic">${icon(ic)}</div><div class="kpi-l">${label}</div><div class="kpi-v">${val}<small>${unit}</small></div>${sub ? `<div class="kpi-s">${sub}</div>` : ''}</a>`;
  const q = `#/${S.id}/quantities`;
  return `<div class="page">
    <header class="ph"><div><h1>${esc(R.name)}</h1><div class="sub">${esc([R.subtitle, R.property].filter(Boolean).join(' · '))}</div></div>${confChip(M.conf)}</header>
    <p class="lede">${esc(R.summary || '')}</p>
    <p class="dimsline">${size} · ${f1(sqft(M.floorGross))} sq ft floor</p>
    <div class="kpis">
      ${kpi(q, 'walls', 'Wall tile', f1(M.wallTileSf), 'sq ft', M.tile.filter(t => t.areas.some(a => !a.floor)).map(t => esc(t.name)).join(', '))}
      ${kpi(q, 'plan', 'Floor tile', f1(M.floorTileSf), 'sq ft', M.tile.filter(t => t.areas.some(a => a.floor)).map(t => esc(t.name)).join(', '))}
      ${kpi(q, 'materials', 'Paint', f1(M.paint.totalSf), 'sq ft', `${M.paint.gallons.toFixed(2)} gal at ${M.paint.coats} coats`)}
      ${kpi(q, 'trim', 'Edge trim', f1(M.trim.lf), 'lf', `${M.trim.edges.length} exposed tile edge${M.trim.edges.length === 1 ? '' : 's'}`)}
      ${priced.length ? kpi(q, 'quantities', 'Tile cost', money(M.tileCost), '', priced.map(t => `${esc(t.name.split(' ')[0])} ${money(t.cost)}`).join(' + ') + (M.tileCostComplete ? '' : ' · unpriced tile not included')) : ''}
    </div>
    <section class="card ba">
      <div class="card-h"><h2>Before &amp; After</h2><span class="muted">Current state vs. target look</span></div>
      <div class="ba-grid">
        <figure class="ph-now">${now.length ? `<img src="${esc(now[0].src)}" alt=""><figcaption>${esc(now[0].caption || '')}</figcaption>` : '<div class="ph-empty">No photo of the room yet</div>'}<span class="tag">NOW</span></figure>
        <figure class="ph-goal">${g ? `<img src="${esc(g.src)}" alt=""><figcaption>${esc(g.caption || '')}</figcaption>` : '<div class="ph-empty">Nothing chosen yet</div>'}<span class="tag">GOAL</span>
          ${goal.length > 1 ? `<div class="thumbs">${goal.map((p, i) => `<button data-goal="${i}" class="${i === S.goalIdx % goal.length ? 'on' : ''}"><img src="${esc(p.src)}" alt=""></button>`).join('')}</div>` : ''}</figure>
      </div>
    </section>
    <div class="two">
      <section class="card"><div class="card-h"><h2>Scope</h2></div><ul class="scope">${(R.scope || []).map(s => `<li class="${s.status === 'done' ? 'done' : ''}"><span class="mk">${s.status === 'done' ? '✓' : '·'}</span><span>${esc(s.text)}${s.date ? ` <em>${esc(s.date.slice(5).replace('-', '/'))}</em>` : ''}${s.note ? ` <span class="muted">— ${esc(s.note)}</span>` : ''}</span></li>`).join('') || '<li class="muted">—</li>'}</ul></section>
      <section class="card"><div class="card-h"><h2>Open Items <span class="badge">${M.open.length}</span></h2><a href="#/${S.id}/open">View all</a></div>
        <ul class="oi">${M.open.slice(0, 6).map(oiRow).join('')}</ul></section>
    </div>
    <section class="card"><div class="card-h"><h2>Validation <span class="badge ${M.issues.length ? 'warn' : 'soft'}">${M.issues.length}</span></h2></div>
      <ul class="val">${M.issues.map(i => `<li class="${i.level}"><span class="code">${esc(i.code)}</span>${esc(i.text)}</li>`).join('') || `<li class="okline">Walls close and nothing overlaps.</li>`}
      <li class="meas"><span class="code">MEASURED</span>${M.doneDims} of ${M.dims.length} dimensions taped or from records${M.estDims ? ` · ${M.estDims} estimated` : ''} · ${M.dims.length - M.doneDims - M.estDims} assumed</li></ul></section>
  </div>`;
}
function bindOverview() { $$('[data-goal]').forEach(b => b.onclick = () => { S.goalIdx = +b.dataset.goal; render(); }); }
const oiRow = it => `<li><span class="sev ${esc(it.severity)}">${esc(it.severity)}</span><div><div>${esc(it.text)}</div>${it.blocks?.length ? `<div class="blocks">${it.blocks.map(b => `<span>${esc(b)}</span>`).join('')}</div>` : ''}</div></li>`;

// ---------- drawings ----------
const drawHead = (title, sub, extra = '') => `<div class="dh"><div class="dh-t"><h2>${title}</h2>${sub ? `<span class="muted">${sub}</span>` : ''}</div>${extra}</div>`;
function viewPlan() {
  return `${drawHead('Floor Plan', `${fmtIn(S.M.bbox.w)} × ${fmtIn(S.M.bbox.h)}`)}
    <div class="edit-wrap"><div class="sheet" id="plan-sheet">${planSVG(S.M, dopts())}</div>${inspector('plan')}</div>${legend()}`;
}
function legend() {
  return `<div class="legend"><span><i class="lg c-meas"></i>Measured</span><span><i class="lg c-doc"></i>From records</span><span><i class="lg c-est"></i>Estimated</span><span><i class="lg c-asm"></i>Assumed</span></div>`;
}
const curWall = () => S.M.wallById[S.wall] || S.M.walls[0];
function viewWalls() {
  const M = S.M, W = curWall();
  const side = d => ({ '1,0': 'north', '0,1': 'east', '-1,0': 'south', '0,-1': 'west' }[d.join(',')] || '');
  return `<div class="dh walls-h"><a class="wnav" href="#/${S.id}/walls/${encodeURIComponent(W.prev.id)}">‹ Wall ${esc(W.prev.id)}</a>
      <div class="dh-t"><h2>Wall ${esc(W.id)} Elevation</h2><span class="muted">${side(W.dir)} · viewed from inside · ${fmtIn(W.len)} wide · ${CONF_LABEL[W.conf].toLowerCase()}</span></div>
      <a class="wnav" href="#/${S.id}/walls/${encodeURIComponent(W.next.id)}">Wall ${esc(W.next.id)} ›</a></div>
    <div class="wall-tabs">${M.walls.map(x => `<a href="#/${S.id}/walls/${encodeURIComponent(x.id)}" class="${x === W ? 'on' : ''}">${esc(x.id)}</a>`).join('')}</div>
    <div class="edit-wrap"><div class="sheet" id="wall-sheet">${elevationSVG(M, W, dopts())}</div>${inspector('walls', W)}</div>
    <div class="wall-facts">${wallFacts(W)}</div>`;
}

// ---------- editing: drag on the plan and the elevations, inspector panel ----------
const ADD_PLAN = ['toilet', 'vanity', 'tub', 'shower', 'door', 'window', 'niche'];
const ADD_WALL = ['mirror', 'light', 'valve', 'showerhead', 'spout', 'niche', 'shelf', 'towel_bar', 'outlet', 'switch', 'window', 'door'];
const half = v => Math.round(v * 2) / 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const objIdx = id => (S.raw.objects || []).findIndex(o => o.id === id);
const wallLenIn = (raw, id) => +((raw.walls || []).find(w => w.id === id)?.length_in || 0);

function inspector(where, W) {
  const i = objIdx(S.sel), o = S.raw.objects?.[i];
  if (!o) {
    const list = where === 'plan' ? ADD_PLAN : ADD_WALL;
    const room = where === 'plan' ? `<h4>Room</h4><table class="mini">${S.raw.walls.map((w, k) => `<tr><td>Wall ${esc(w.id)}</td><td>${lenInput(`walls.${k}.length_in`, w.length_in)}</td></tr>`).join('')}<tr><td>Ceiling</td><td>${lenInput('ceiling_in', S.raw.ceiling_in)}</td></tr></table>` : '';
    return `<aside class="insp"><h3>${where === 'plan' ? 'Add to the plan' : 'Add to wall ' + esc(W.id)}</h3>
      <div class="addgrid">${list.map(t => `<button data-add="${t}">${icon('plus')}${esc(TYPES[t].label)}</button>`).join('')}</div>
      <p class="hint">${where === 'plan' ? 'Click an item to select it, then drag it. Drag it toward another wall to put it on that wall.' : 'Click an item to select it, then drag it.'}</p>${room}</aside>`;
  }
  const ob = S.M.byId[o.id] || {}, T = TYPES[o.type] || {}, k = T.kind;
  const num1 = (label, key, val, on = true) => (on ? `<label class="fl"><span>${label}</span><span class="fi"><input class="len" data-ins="${key}" value="${esc(numStr(val))}" inputmode="decimal" autocomplete="off"><em>${val != null ? fmtIn(val) : ''}</em></span></label>` : '');
  const sel = (label, key, val, opts) => `<label class="fl"><span>${label}</span><select data-ins-sel="${key}">${opts.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
  let f = `<label class="fl"><span>Name</span><input class="txt" data-ins-txt="label" value="${esc(o.label || T.label || o.type)}"></label>`;
  if (k !== 'ceiling') f += sel('Wall', 'wall', o.wall, S.raw.walls.map(w => [w.id, 'Wall ' + w.id]));
  f += num1('From left corner', 'x_in', ob.x ?? o.x_in);
  f += num1('Width', 'w_in', ob.w ?? o.w_in);
  if (k === 'fixture') f += num1('Depth into room', 'depth_in', ob.depth ?? o.depth_in);
  if (k !== 'fixture' && o.type !== 'door') f += num1('Up from floor', 'y_in', ob.y ?? o.y_in);
  if (k !== 'fixture' || ['toilet', 'vanity', 'tub'].includes(o.type)) f += num1(o.type === 'tub' ? 'Rim height' : 'Height', 'h_in', ob.h ?? o.h_in);
  if (o.type === 'niche' || o.type === 'shelf') f += num1('Depth', 'depth_in', ob.depth ?? o.depth_in);
  if (o.type === 'niche') {
    f += `<div class="presets">${[[12, 12], [12, 24], [24, 12], [14, 28], [24, 14]].map(([w, h]) => `<button data-ins-act="size:${w}x${h}" class="${(ob.w === w && ob.h === h) ? 'on' : ''}">${w}×${h}</button>`).join('')}</div>`;
    const opts = [['', 'Same as the wall']].concat(tileOptions());
    f += `<label class="fl"><span>Back tile</span><select data-ins-sel="back_material">${opts.map(([id, name]) => `<option value="${esc(id)}" ${id === (o.back_material || '') ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label>`;
  }
  if (o.type === 'door') { f += sel('Hinge side', 'hinge', o.hinge || 'left', [['left', 'Left'], ['right', 'Right']]); f += sel('Swings', 'swing', o.swing || 'in', [['in', 'Into the room'], ['out', 'Out of the room']]); }
  if (o.type === 'shower') {
    const e = o.entry || {};
    f += num1('Wall tile height', 'tile_to_in', o.tile_to_in ?? S.M.H);
    f += sel('Entry', 'entry.type', e.type || 'panel', [['panel', 'Glass panel'], ['glass', 'Full glass'], ['curtain', 'Curtain'], ['open', 'Open']]);
    if ((e.type || 'panel') === 'panel') { f += num1('Panel width', 'entry.panel_w_in', e.panel_w_in ?? 34); f += sel('Panel at', 'entry.side', e.side || 'start', [['start', 'Left end'], ['end', 'Right end']]); }
    const cb = o.curb && !o.curb.none ? o.curb : null;
    f += sel('Curb', 'curb.on', cb ? 'yes' : 'no', [['yes', 'Yes'], ['no', 'No (curbless)']]);
    if (cb) { f += num1('Curb height', 'curb.h_in', cb.h_in ?? 4); f += num1('Curb width', 'curb.w_in', cb.w_in ?? 5); }
  }
  if (o.type === 'tub' && o.surround) f += num1('Surround height', 'surround.to_in', o.surround.to_in ?? S.M.H);
  f += sel('Status', 'conf', o.conf || 'assumed', CONF_ORDER.map(c => [c, CONF_LABEL[c]]));
  const kids = (S.raw.objects || []).filter(q => q.with === o.id).map(q => q.label || TYPES[q.type]?.label || q.type);
  return `<aside class="insp sel"><div class="insp-h"><h3>${esc(o.label || T.label || o.type)}</h3><button class="x" data-ins-act="done" title="Deselect (Esc)">×</button></div>
    <div class="readout" id="readout">${ob.W ? `Wall ${esc(ob.W.id)} · ${fmtIn(ob.x)} from the left corner` : ''}</div>
    ${f}${kids.length ? `<p class="hint">Moves with it: ${esc(kids.join(', '))}</p>` : ''}
    <div class="insp-btns"><button data-ins-act="dup">Duplicate</button><button data-ins-act="del" class="danger">Delete</button></div>
    <p class="hint">Arrow keys nudge ½″ (Shift: 6″) · Delete removes · Esc deselects</p></aside>`;
}

function setDeep(o, path, val) { const ks = path.split('.'); let t = o; for (let i = 0; i < ks.length - 1; i++) t = (t[ks[i]] ||= {}); t[ks[ks.length - 1]] = val; }
function moveObject(draft, id, wall, x, y) {
  const o = draft.objects.find(q => q.id === id); if (!o) return;
  const oldWall = o.wall, oldX = o.x_in ?? 0;
  if (oldWall === wall && oldX === x && (y == null || y === o.y_in)) return;
  o.wall = wall; o.x_in = x; if (y != null) o.y_in = y;
  o.conf = 'estimated'; // moved by hand: no longer a taped position
  for (const c of draft.objects.filter(q => q.with === id && q.wall === oldWall)) {
    const cw = c.w_in ?? TYPES[c.type]?.w ?? 0;
    c.wall = wall; c.x_in = clamp(half(x + ((c.x_in ?? 0) - oldX)), 0, Math.max(0, wallLenIn(draft, wall) - cw));
    c.conf = 'estimated';
  }
}
function freeWallFor(w) {
  for (const W of S.M.walls) {
    const taken = W.objects.filter(q => q.kind === 'fixture' || q.kind === 'opening').map(q => [q.x, q.x + q.w]).concat(W.contacts.map(c => [c.x0, c.x1])).sort((a, b) => a[0] - b[0]);
    let cur = 0;
    for (const [a, b] of taken) { if (a - cur >= w) return { W, x: half(cur + (a - cur - w) / 2) }; cur = Math.max(cur, b); }
    if (W.len - cur >= w) return { W, x: half(cur + (W.len - cur - w) / 2) };
  }
  return { W: S.M.walls[0], x: half(Math.max(0, (S.M.walls[0].len - w) / 2)) };
}
function ensureTileMaterial(next, id, name) {
  next.materials ||= {};
  if (!next.materials[id]) next.materials[id] = { kind: 'tile', name, look: 'plain', color: '#e6e3dc', waste_pct: 10, status: 'Not chosen' };
  return id;
}
function addObject(type, wallId) {
  const T = TYPES[type], next = clone(S.raw); next.objects ||= [];
  const ids = new Set(next.objects.map(o => o.id)); let id = type, n = 2; while (ids.has(id)) id = `${type}-${n++}`;
  const w = type === 'shower' ? 48 : T.w ?? 12;
  let spot = wallId ? { W: S.M.wallById[wallId], x: half(Math.max(0, (S.M.wallById[wallId].len - w) / 2)) } : freeWallFor(w);
  if (type === 'niche' && !wallId) { // soap niche: centred on the shower's (or tub's) back wall
    const sh = S.M.fixtures.find(f => f.type === 'shower') || S.M.fixtures.find(f => f.type === 'tub');
    if (sh) spot = { W: sh.W, x: half(clamp(sh.x + sh.w / 2 - w / 2, 0, Math.max(0, sh.W.len - w))) };
  }
  const o = { id, type, wall: spot.W.id, x_in: spot.x, w_in: w, conf: 'estimated' };
  if (T.kind === 'fixture') { o.depth_in = type === 'shower' ? 36 : T.depth; if (T.h) o.h_in = T.h; }
  else { if (type !== 'door') o.y_in = T.y ?? 0; o.h_in = T.h; if (T.depth) o.depth_in = T.depth; }
  if (type === 'door') o.hinge = 'left';
  if (type === 'shower') Object.assign(o, { walls_material: ensureTileMaterial(next, 'shower-wall-tile', 'Shower wall tile'), tile_to_in: S.M.H, floor_material: next.floor?.material || ensureTileMaterial(next, 'shower-floor-tile', 'Shower floor tile'), entry: { type: 'panel', panel_w_in: 34, side: 'start' } });
  if (type === 'tub') o.surround = { material: ensureTileMaterial(next, 'surround-tile', 'Tub surround tile'), to_in: S.M.H };
  next.objects.push(o); S.sel = id; commit(next);
}
function inspectorChange(path, raw, kind) {
  const i = objIdx(S.sel); if (i < 0) return;
  const next = clone(S.raw), o = next.objects[i];
  if (kind === 'len') {
    const v = parseLen(raw); if (v == null || Number.isNaN(v) || v < 0) return false;
    const val = Math.round(v * 1000) / 1000;
    if (path === 'x_in') { moveObject(next, o.id, o.wall, val); o.conf = S.raw.objects[i].conf === 'assumed' ? 'estimated' : S.raw.objects[i].conf; }
    else setDeep(o, path, val);
    if (o.conf === 'assumed' || !o.conf) o.conf = 'estimated';
  } else if (kind === 'sel') {
    if (path === 'curb.on') {
      if (raw === 'yes') { o.curb = { ...(o.curb || {}), h_in: o.curb?.h_in ?? 4, w_in: o.curb?.w_in ?? 5 }; delete o.curb.none; }
      else o.curb = { ...(o.curb || {}), none: true };
    } else if (path === 'wall') { const W = wallLenIn(next, raw), w = o.w_in ?? TYPES[o.type]?.w ?? 0; moveObject(next, o.id, raw, clamp(o.x_in ?? 0, 0, Math.max(0, W - w))); }
    else if (path === 'back_material') {
      if (!raw) delete o.back_material;
      else { next.materials ||= {}; if (!next.materials[raw] && S.lib?.[raw]) next.materials[raw] = clone(S.lib[raw]); o.back_material = raw; }
    }
    else setDeep(o, path, raw);
  } else if (kind === 'txt') o.label = raw.trim() || undefined;
  commit(next);
  return true;
}
function bindInspector() {
  $$('[data-add]').forEach(b => b.onclick = () => addObject(b.dataset.add, S.view === 'walls' ? curWall().id : null));
  $$('[data-ins]').forEach(inp => {
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
    inp.addEventListener('change', () => { if (inspectorChange(inp.dataset.ins, inp.value, 'len') === false) inp.classList.add('bad'); });
  });
  $$('[data-ins-sel]').forEach(s => s.onchange = () => inspectorChange(s.dataset.insSel, s.value, 'sel'));
  $$('[data-ins-txt]').forEach(t => t.onchange = () => inspectorChange('label', t.value, 'txt'));
  $$('[data-ins-act]').forEach(b => b.onclick = () => {
    const act = b.dataset.insAct;
    if (act === 'done') { S.sel = null; if (S.view === '3d' && S.three) { S.three.setSel(null); paint3DPanel(); } else render(); return; }
    if (act.startsWith('size:')) { // soap niche presets
      const [w, h] = act.slice(5).split('x').map(Number), i0 = objIdx(S.sel); if (i0 < 0) return;
      const next = clone(S.raw); Object.assign(next.objects[i0], { w_in: w, h_in: h }); commit(next); return;
    }
    const i = objIdx(S.sel); if (i < 0) return;
    const next = clone(S.raw);
    if (act === 'del') { next.objects.splice(i, 1); for (const q of next.objects) if (q.with === S.sel) delete q.with; S.sel = null; }
    if (act === 'dup') {
      const c = clone(next.objects[i]); const ids = new Set(next.objects.map(o => o.id)); let id = c.id + '-copy', n = 2; while (ids.has(id)) id = `${c.id}-copy-${n++}`;
      c.id = id; delete c.with; const W = wallLenIn(next, c.wall), w = c.w_in ?? TYPES[c.type]?.w ?? 0;
      c.x_in = clamp(half((c.x_in ?? 0) + w + 2), 0, Math.max(0, W - w)); next.objects.push(c); S.sel = id;
    }
    commit(next);
  });
  bindLenInputs($('.insp'));
}
function svgPoint(svg, ev) { const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY; const p = pt.matrixTransform(svg.getScreenCTM().inverse()); return [p.x, p.y]; }
function nearestWall(p) {
  let best = null;
  for (const W of S.M.walls) {
    const t = dot(sub(p, W.start), W.dir), tc = clamp(t, 0, W.len), q = add(W.start, mul(W.dir, tc)), d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (!best || d < best.d) best = { W, t, d };
  }
  return best;
}
function readout(txt) { const el = $('#readout'); if (el) el.textContent = txt; }
function bindPlan() {
  bindInspector();
  const sheet = $('#plan-sheet'); let drag = null;
  sheet.addEventListener('pointerdown', ev => {
    const el = ev.target.closest('[data-oid]');
    if (!el) { if (S.sel) { S.sel = null; render(); } return; }
    const ob = S.M.byId[el.dataset.oid]; if (!ob || !ob.W) return;
    ev.preventDefault();
    S.sel = ob.id;
    const svg = sheet.querySelector('svg'), p = svgPoint(svg, ev);
    drag = { id: ob.id, wall: ob.W.id, wall0: ob.W.id, grabU: dot(sub(p, ob.W.start), ob.W.dir) - ob.x, w: ob.w, start: p, moved: false, draft: null };
    sheet.setPointerCapture(ev.pointerId);
    sheet.innerHTML = planSVG(S.M, dopts({ sel: ob.id }));
  });
  sheet.addEventListener('pointermove', ev => {
    if (!drag) return;
    const svg = sheet.querySelector('svg'), p = svgPoint(svg, ev);
    if (!drag.moved && Math.hypot(p[0] - drag.start[0], p[1] - drag.start[1]) < 1.5) return;
    drag.moved = true;
    const best = nearestWall(p);
    let W = S.M.wallById[drag.wall];
    const tc = dot(sub(p, W.start), W.dir), qc = add(W.start, mul(W.dir, clamp(tc, 0, W.len))), dCur = Math.hypot(p[0] - qc[0], p[1] - qc[1]);
    if (best.W.id !== W.id && dCur - best.d > 6) W = best.W;
    drag.wall = W.id;
    const t = dot(sub(p, W.start), W.dir);
    let x = W.id === drag.wall0 ? t - drag.grabU : t - drag.w / 2;
    x = clamp(half(x), 0, Math.max(0, W.len - drag.w));
    if (x < 1.5) x = 0; if (W.len - drag.w - x < 1.5) x = Math.max(0, W.len - drag.w);
    const draft = clone(S.raw); moveObject(draft, drag.id, W.id, x); drag.draft = draft;
    const M2 = build(draft);
    sheet.innerHTML = planSVG(M2, dopts({ sel: drag.id }));
    readout(`Wall ${W.id} · ${fmtIn(x)} from the left corner · ${fmtIn(Math.max(0, W.len - drag.w - x))} to the right corner`);
  });
  const end = () => { if (!drag) return; const d = drag; drag = null; if (d.moved && d.draft) commit(d.draft); else render(); };
  sheet.addEventListener('pointerup', end); sheet.addEventListener('pointercancel', end);
}
function bindWalls() {
  bindInspector();
  const sheet = $('#wall-sheet'); let drag = null;
  sheet.addEventListener('pointerdown', ev => {
    const el = ev.target.closest('[data-oid]');
    if (!el) { if (S.sel) { S.sel = null; render(); } return; }
    const ob = S.M.byId[el.dataset.oid]; if (!ob || !ob.W) return;
    ev.preventDefault();
    S.sel = ob.id;
    const W = curWall(), svg = sheet.querySelector('svg'), [X, Y] = svgPoint(svg, ev), u = X, v = W.height - Y;
    drag = { id: ob.id, W, grabU: u - ob.x, grabV: v - ob.y, w: ob.w, h: ob.h, slideOnly: ob.kind === 'fixture' || ob.type === 'door', start: [u, v], moved: false, draft: null };
    sheet.setPointerCapture(ev.pointerId);
    sheet.innerHTML = elevationSVG(S.M, W, dopts({ sel: ob.id }));
  });
  sheet.addEventListener('pointermove', ev => {
    if (!drag) return;
    const W = drag.W, svg = sheet.querySelector('svg'), [X, Y] = svgPoint(svg, ev), u = X, v = W.height - Y;
    if (!drag.moved && Math.hypot(u - drag.start[0], v - drag.start[1]) < 1.5) return;
    drag.moved = true;
    let x = clamp(half(u - drag.grabU), 0, Math.max(0, W.len - drag.w));
    if (x < 1.5) x = 0; if (W.len - drag.w - x < 1.5) x = Math.max(0, W.len - drag.w);
    const y = drag.slideOnly ? null : clamp(half(v - drag.grabV), 0, Math.max(0, W.height - drag.h));
    const draft = clone(S.raw); moveObject(draft, drag.id, W.id, x, y); drag.draft = draft;
    const M2 = build(draft);
    sheet.innerHTML = elevationSVG(M2, M2.wallById[W.id], dopts({ sel: drag.id }));
    readout(`${fmtIn(x)} from the left corner${y != null ? ` · ${fmtIn(y)} up from the floor` : ''}`);
  });
  const end = () => { if (!drag) return; const d = drag; drag = null; if (d.moved && d.draft) commit(d.draft); else render(); };
  sheet.addEventListener('pointerup', end); sheet.addEventListener('pointercancel', end);
}
function nudge(e) {
  const i = objIdx(S.sel); if (i < 0) return false;
  const ob = S.M.byId[S.sel]; if (!ob || !ob.W) return false;
  const step = e.shiftKey ? 6 : 0.5, vec = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[e.key];
  if (!vec) return false;
  const next = clone(S.raw), W = ob.W;
  if (S.view === 'walls') {
    if (vec[0]) moveObject(next, ob.id, W.id, clamp(half(ob.x + vec[0] * step), 0, Math.max(0, W.len - ob.w)));
    else if (ob.kind !== 'fixture' && ob.type !== 'door') moveObject(next, ob.id, W.id, ob.x, clamp(half(ob.y - vec[1] * step), 0, Math.max(0, W.height - ob.h)));
    else return true;
  } else {
    const along = dot(vec, W.dir); if (!along) return true;
    moveObject(next, ob.id, W.id, clamp(half(ob.x + along * step), 0, Math.max(0, W.len - ob.w)));
  }
  commit(next); return true;
}
function wallFacts(W) {
  const z = W.zones.map(q => `${esc(((S.raw.materials || {})[q.material] || {}).name || q.material)} ${f1(sqft(q.net))} sq ft`).join(' · ');
  return `<span>Gross ${f1(sqft(W.gross))} sq ft</span><span>Openings ${f1(sqft(W.openArea))} sq ft</span><span>Tile ${f1(sqft(W.tileNet))} sq ft${z ? ' (' + z + ')' : ''}</span><span>Paint ${f1(sqft(W.paint))} sq ft</span>`;
}
function viewUnfolded() {
  const M = S.M, run = M.walls.reduce((s, w) => s + w.len, 0);
  return `${drawHead('Unfolded Run', `all ${M.walls.length} walls opened flat, ${M.walls.map(w => w.id).join(' → ')} · ${fmtIn(run)} of wall (${fmtFtIn(run)})`)}<div class="sheet wide">${unfoldedSVG(M, dopts())}</div>`;
}
function view3D() {
  return `<div class="dh"><div class="dh-t"><h2>3D Room View</h2></div><div class="cam"><button data-cam="home">Corner</button><button data-cam="top">Top</button><button data-cam="eye">Doorway</button><span class="muted">drag to orbit · click an item, then drag it · hover for areas</span></div></div>
    <div class="edit-wrap"><div id="three" class="three"><div id="tip" class="tip"></div></div><aside class="insp surf" id="panel3d">${panel3D()}</aside></div>`;
}
const panel3D = () => (S.sel && objIdx(S.sel) >= 0 ? inspector('plan') : tilePanel());
function paint3DPanel() {
  const el = $('#panel3d'); if (!el) return;
  el.innerHTML = panel3D();
  if (S.sel && objIdx(S.sel) >= 0) bindInspector(); else bindTilePanel();
}
async function bind3D() {
  const host = $('#three');
  if (S.sel && objIdx(S.sel) >= 0) bindInspector(); else bindTilePanel();
  const [{ mount3D }] = await Promise.all([import('./view3d.js'), tiles.ready(S.raw.materials)]);
  if (S.view !== '3d' || !document.body.contains(host)) return;
  let d3 = null;
  S.three = mount3D(host, S.M, dopts(), $('#tip'), S.cam3d, {
    onSelect(oid) { S.sel = oid; paint3DPanel(); },
    onDragStart(oid, p) {
      const ob = S.M.byId[oid]; if (!ob?.W) return;
      d3 = { id: oid, wall: ob.W.id, wall0: ob.W.id, grabU: dot(sub(p, ob.W.start), ob.W.dir) - ob.x, w: ob.w, draft: null };
    },
    onDragFloor(oid, p) {
      if (!d3 || d3.id !== oid) return;
      const best = nearestWall(p);
      let W = S.M.wallById[d3.wall];
      const tc = dot(sub(p, W.start), W.dir), qc = add(W.start, mul(W.dir, clamp(tc, 0, W.len))), dCur = Math.hypot(p[0] - qc[0], p[1] - qc[1]);
      if (best.W.id !== W.id && dCur - best.d > 6) W = best.W;
      d3.wall = W.id;
      const t = dot(sub(p, W.start), W.dir);
      let x = clamp(half(W.id === d3.wall0 ? t - d3.grabU : t - d3.w / 2), 0, Math.max(0, W.len - d3.w));
      if (x < 1.5) x = 0; if (W.len - d3.w - x < 1.5) x = Math.max(0, W.len - d3.w);
      const draft = clone(S.raw); moveObject(draft, oid, W.id, x); d3.draft = draft;
      S.three.setModel(build(draft));
      readout(`Wall ${W.id} · ${fmtIn(x)} from the left corner`);
    },
    onDragWall(oid, wallId, x, y) {
      d3 = d3 && d3.id === oid ? d3 : { id: oid };
      const draft = clone(S.raw); moveObject(draft, oid, wallId, x, y); d3.draft = draft;
      S.three.setModel(build(draft));
      readout(`Wall ${wallId} · ${fmtIn(x)} from the left corner${y != null ? ` · ${fmtIn(y)} up` : ''}`);
    },
    onDragEnd() { if (d3?.draft) { const next = d3.draft; d3 = null; commit(next, { rerender: false }); paint3DPanel(); } },
  });
  $$('[data-cam]').forEach(b => b.onclick = () => S.three && S.three.view && S.three.view(b.dataset.cam));
}

// ---------- the Tile workspace: pick a surface, click a tile to put it there, add new candidates ----------
function tilePanel() {
  const surf = surfaces(S.raw);
  if (!surf.length) return '<h3>Tile</h3><p class="hint">No tiled surfaces yet. Add a shower, tub or soap niche.</p>';
  if (!surf.some(s => s.key === S.activeSurf)) S.activeSurf = surf[0].key;
  const act = surf.find(s => s.key === S.activeSurf);
  const lib = S.lib || {}, mats = S.raw.materials || {};
  const choices = Object.entries(lib).concat(Object.entries(mats).filter(([id, m]) => m.kind === 'tile' && !lib[id]));
  // this surface's own area, and its cost at the tile's price with waste
  const line = sf => {
    if (sf.inherit) return 'counted with the wall tile';
    let sqin = 0, t = null;
    for (const tl of S.M.tile) for (const a of tl.areas) if (a.skey === sf.skey) { sqin += a.sqin; t = tl; }
    if (!t) return '';
    const area = sqft(sqin), cost = t.price != null ? area * (1 + t.waste / 100) * t.price : null;
    return `${f1(area)} sq ft${cost != null ? ` · ${money(cost)} with ${t.waste}% waste` : ''}`;
  };
  const m = mats[act.material] || {};
  const sel = (k, v, list) => `<select data-mopt="${esc(act.material)}|${k}">${list.map(([a, b]) => `<option value="${a}" ${a === v ? 'selected' : ''}>${b}</option>`).join('')}</select>`;
  return `<h3>Tile</h3>
    <div class="surflist">${surf.map(s => `<button class="surfbtn ${s.key === S.activeSurf ? 'on' : ''}" data-act="${esc(s.key)}"><span class="sl">${esc(s.label)}</span><span class="sm">${esc(s.inherit ? 'Same as the wall' : (mats[s.material] || lib[s.material] || {}).name || 'Not set')}</span><span class="sq">${line(s)}</span></button>`).join('')}</div>
    ${isRectTile(m) ? `<div class="sopts">${sel('orientation', m.orientation || 'horizontal', [['vertical', 'Vertical'], ['horizontal', 'Horizontal']])}${sel('pattern', m.pattern || 'stack', [['stack', 'Stacked'], ['offset', 'Offset ½'], ['third', 'Offset ⅓']])}</div>` : ''}
    ${m.kind === 'tile' && !act.inherit && !['photo', 'sheet'].includes(m.look) ? `<label class="colorfix"><input type="color" data-mcolor="${esc(act.material)}" value="${esc(/^#[0-9a-f]{6}$/i.test(m.color || '') ? m.color : '#e6e2da')}"> Colour${m.photo ? ` <img src="${esc(m.photo)}" alt="" title="Product photo"><button class="phbtn ${m.face_from_photo === false ? '' : 'on'}" data-photosurf="${esc(act.material)}" title="Paint each tile with real patches of this photo">${m.face_from_photo === false ? 'Use the photo' : 'From the photo'}</button>` : ''}${m.link ? ` <a href="${esc(m.link)}" target="_blank" rel="noopener">product page ↗</a>` : ''}</label>` : ''}
    ${m.kind === 'tile' && m.price_per_sqft == null && !act.inherit && !/not chosen/i.test(m.status || '') ? `<label class="pricefix">Price per sq ft <span>$<input data-price="${esc(act.material)}" inputmode="decimal" placeholder="—"></span>${m.link ? ` <a href="${esc(m.link)}" target="_blank" rel="noopener">see the page ↗</a>` : ''}</label>` : ''}
    <h4>Put on ${esc(act.label.toLowerCase())}</h4>
    ${SHARE ? '' : `<form id="linkform" class="linkform"><input name="url" type="url" placeholder="Paste a product link, press Enter" autocomplete="off" spellcheck="false"><button type="submit">Add</button></form>
    ${S.linkMsg ? `<div class="linkmsg ${S.linkMsg.bad ? 'bad' : ''}">${S.linkMsg.html}</div>` : ''}
    ${S.readerHelpHtml && !readerReady() ? S.readerHelpHtml : ''}
    <div class="bmkrow">${readerReady() ? '<span class="rdr on">Chrome reader on</span>' : '<a href="#" class="rdr" data-readerhelp>Set up the Chrome reader</a>'}<a class="bmk" href="${esc(bookmarklet())}" title="Drag me to the bookmarks bar; click it on any tile page">${icon('plus')} Add to planner</a></div>`}
    <button class="addtile" id="addtile-btn">${icon('plus')}Add a tile by hand</button>
    <form id="addtile-form" class="libf compact" hidden>${tileFormFields()}<div class="row"><button class="primary" type="submit">Add and use it</button><span class="srcmsg" id="addtile-msg"></span></div></form>
    <div class="swatches">${act.niche ? `<button class="sw ${!S.raw.objects?.[+act.path.split('.')[1]]?.back_material ? 'on' : ''}" data-pick=""><span class="swi same"></span><span>Same as the wall</span></button>` : ''}${choices.map(([id, t]) => `<button class="sw ${id === act.material ? 'on' : ''}" data-pick="${esc(id)}" title="${esc(t.name)}"><img data-thumb="${esc(id)}" alt=""><span>${esc(t.name)}</span></button>`).join('')}</div>
    <p class="hint"><a href="#/${S.id}/materials">All materials, prices and the library →</a></p>`;
}
// ---------- add a tile from a product link (or from the bookmark button on any product page) ----------
function bookmarklet() {
  const target = `${location.origin}${location.pathname}#/import/`;
  return "javascript:(()=>{const q=s=>document.querySelector(s);const d={u:location.href,ti:document.title,og:(q('meta[property=\"og:image\"]')||{}).content||'',lds:[...document.querySelectorAll('script[type=\"application/ld+json\"]')].map(s=>s.textContent).join('\\n').slice(0,30000),t:document.body.innerText.replace(/\\s+/g,' ').slice(0,9000)};window.open('" + target + "'+encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(d))))),'bathroom-planner')})()";
}
const rememberSurface = () => localStorage.setItem('bp-last', JSON.stringify({ room: S.id, surf: S.activeSurf }));
async function finishImport(r, surfKey) {
  const t = r.tile, lib = S.lib || {};
  const same = Object.entries(lib).find(([, v]) => v.link && v.link === t.link);
  let id = same ? same[0] : t.id, n = 2;
  if (!same) while (lib[id]) id = `${t.id}-${n++}`;
  const { id: _drop, ...rest } = t;
  await api('POST', '/api/library', { id, ...rest });
  S.lib = await api('GET', '/api/library');
  const bits = [t.tile_w_in ? `${t.tile_w_in} × ${t.tile_h_in}″` : t.sheet_w_in ? `${t.sheet_w_in} × ${t.sheet_h_in}″ sheet` : '', t.price_per_sqft != null ? `$${t.price_per_sqft.toFixed(2)}/sq ft` : '', t.unit_sqft && t.unit !== 'piece' ? `${t.unit_sqft} sq ft per ${t.unit}` : ''].filter(Boolean);
  const miss = (r.missing?.length ? ` <span class="muted">Not on the page: ${esc(r.missing.join(', '))}${r.missing.includes('price') ? ' (type it in below)' : ''}.</span>` : '') +
    (r.readerHint ? ` <a href="#" data-readerhelp>Get the price and photo from ${esc(new URL(t.link || 'https://x').hostname.replace('www.', ''))} too →</a>` : '');
  S.linkMsg = { html: `Added <b>${esc(t.name)}</b>${bits.length ? ' · ' + esc(bits.join(' · ')) : ''}.${miss}${r.note ? ` <span class="muted">${esc(r.note)}</span>` : ''}` };
  if (S.raw && surfKey) applyTile(surfKey, id); else render();
}
// Sites that refuse programs; the Chrome reader extension (chrome-reader/) reads them in Brian's own Chrome.
const BLOCKING = /(^|\.)(homedepot\.com|lowes\.com|wayfair\.com|allmodern\.com|perigold\.com|birchlane\.com|jossandmain\.com|walmart\.com|build\.com|ferguson\.com|tileclub\.com)$/i;
const readerReady = () => document.documentElement.dataset.bpReader === '1';
function readInChrome(url) {
  return new Promise((resolve, reject) => {
    const on = e => {
      if (e.source !== window || !e.data || e.data.bpReadResult !== url) return;
      clearTimeout(timer); window.removeEventListener('message', on);
      const r = e.data.resp; r && r.ok ? resolve(r.data) : reject(new Error((r && r.error) || "Chrome couldn't read the page."));
    };
    const timer = setTimeout(() => { window.removeEventListener('message', on); reject(new Error('Chrome took too long to load the page.')); }, 50000);
    window.addEventListener('message', on);
    window.postMessage({ bpRead: url }, location.origin);
  });
}
async function addFromLink(url) {
  S.linkMsg = { html: 'Reading the page…' }; paint3DPanel();
  let host = ''; try { host = new URL(url).hostname; } catch { /* not a link */ }
  try {
    if (BLOCKING.test(host) && readerReady()) {
      S.linkMsg = { html: 'Reading the page in your Chrome…' }; paint3DPanel();
      return await finishImport(await api('POST', '/api/tile-from-page', await readInChrome(url)), S.activeSurf);
    }
    const r = await api('POST', '/api/tile-from-url', { url });
    if (r.note && readerReady()) { // the site refused the server: let Chrome read it
      S.linkMsg = { html: 'Reading the page in your Chrome…' }; paint3DPanel();
      try { return await finishImport(await api('POST', '/api/tile-from-page', await readInChrome(url)), S.activeSurf); } catch { /* keep what the link gave */ }
    }
    if (r.note && !readerReady()) r.readerHint = true;
    await finishImport(r, S.activeSurf);
  } catch (e) { S.linkMsg = { html: esc(e.message.replace(/^\{"error": "|"\}$/g, '')), bad: true }; paint3DPanel(); }
}
async function readerHelp() {
  const info = await api('GET', '/api/info').catch(() => ({}));
  return `<div class="readerhelp"><b>Chrome reader — set up once</b>
    <ol><li>In Chrome, type <code>chrome://extensions</code> in the address bar.</li>
    <li>Turn on <b>Developer mode</b> (top right).</li>
    <li>Click <b>Load unpacked</b>, press <b>⌘⇧G</b>, paste the folder path, press Enter, then <b>Select</b>.</li></ol>
    <div class="row"><code class="path">${esc(info.readerPath || 'bathroom-planner/chrome-reader')}</code><button data-copypath="${esc(info.readerPath || '')}">Copy path</button></div>
    <div class="muted">Then reload this page. Home Depot, Lowe's and Wayfair links come in with price and photo.</div></div>`;
}
async function importFromBookmark(raw) {
  let payload;
  try { payload = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(raw))))); } catch { payload = null; }
  const last = JSON.parse(localStorage.getItem('bp-last') || '{}');
  const room = S.rooms.find(r => r.id === last.room) ? last.room : S.rooms[0]?.id;
  if (room !== S.id) { S.raw = await api('GET', '/api/rooms/' + encodeURIComponent(room)); S.id = room; S.undo = []; S.redo = []; S.sel = null; rebuild(); await ensureTex(); }
  S.view = '3d'; S.sel = null; S.activeSurf = last.surf || S.activeSurf;
  history.replaceState(null, '', `#/${S.id}/3d`);
  if (!payload) { S.linkMsg = { html: "That page couldn't be read.", bad: true }; render(); return; }
  S.linkMsg = { html: 'Reading the page…' }; render();
  try { await finishImport(await api('POST', '/api/tile-from-page', payload), S.activeSurf); }
  catch (e) { S.linkMsg = { html: esc(e.message), bad: true }; render(); }
}

function bindTilePanel() {
  $$('[data-act]').forEach(b => b.onclick = () => { S.activeSurf = b.dataset.act; rememberSurface(); paint3DPanel(); });
  const lf = $('#linkform');
  if (lf) lf.onsubmit = e => { e.preventDefault(); const u = lf.url.value.trim(); if (u) addFromLink(u); };
  const bm = $('.bmk'); if (bm) bm.onclick = e => { e.preventDefault(); };
  $$('[data-readerhelp]').forEach(a => a.onclick = async e => { e.preventDefault(); S.readerHelpHtml = S.readerHelpHtml ? null : await readerHelp(); paint3DPanel(); });
  $$('[data-copypath]').forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copypath); b.textContent = 'Copied'; } catch { b.textContent = 'Select it above'; } });
  $$('[data-mcolor]').forEach(inp => inp.onchange = async () => {
    const mid = inp.dataset.mcolor, next = clone(S.raw);
    next.materials[mid].color = inp.value; next.materials[mid].face_from_photo = false; // a picked colour beats the photo
    if (S.lib?.[mid]) { await api('POST', '/api/library', { id: mid, ...S.lib[mid], color: inp.value, face_from_photo: false }); S.lib = await api('GET', '/api/library'); }
    commit(next);
  });
  $$('[data-photosurf]').forEach(b => b.onclick = async e => {
    e.preventDefault();
    const mid = b.dataset.photosurf, next = clone(S.raw), on = next.materials[mid].face_from_photo === false;
    next.materials[mid].face_from_photo = on;
    if (S.lib?.[mid]) { await api('POST', '/api/library', { id: mid, ...S.lib[mid], face_from_photo: on }); S.lib = await api('GET', '/api/library'); }
    commit(next);
  });
  $$('[data-price]').forEach(inp => {
    inp.onkeydown = e => { if (e.key === 'Enter') inp.blur(); };
    inp.onchange = async () => {
      const v = parseFloat(String(inp.value).replace(/[$,]/g, '')); if (!(v > 0)) return;
      const mid = inp.dataset.price, next = clone(S.raw);
      next.materials[mid].price_per_sqft = Math.round(v * 100) / 100;
      if (S.lib?.[mid]) { await api('POST', '/api/library', { id: mid, ...S.lib[mid], price_per_sqft: next.materials[mid].price_per_sqft }); S.lib = await api('GET', '/api/library'); }
      S.linkMsg = null; commit(next);
    };
  });
  $$('[data-pick]').forEach(b => b.onclick = () => applyTile(S.activeSurf, b.dataset.pick));
  $$('[data-mopt]').forEach(s => s.onchange = () => {
    const [mid, key] = s.dataset.mopt.split('|'), next = clone(S.raw);
    if (!next.materials?.[mid]) return;
    next.materials[mid][key] = s.value; commit(next);
  });
  fillThumbs();
  const btn = $('#addtile-btn'), form = $('#addtile-form');
  if (btn) btn.onclick = () => {
    form.hidden = !form.hidden;
    btn.classList.toggle('open', !form.hidden);
    if (!form.hidden) { form.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); form.querySelector('input[name=name]')?.focus({ preventScroll: true }); }
  };
  if (form) form.onsubmit = async e => {
    e.preventDefault();
    const id = await addTileFromForm(form, $('#addtile-msg'));
    if (id) applyTile(S.activeSurf, id);
  };
}
function applyTile(surfKey, id) {
  const sf = surfaces(S.raw).find(s => s.key === surfKey); if (!sf) return;
  const next = clone(S.raw);
  next.materials ||= {};
  if (id && !next.materials[id] && S.lib?.[id]) next.materials[id] = clone(S.lib[id]);
  if (id) setDeep(next, sf.path, id);
  else { const ks = sf.path.split('.'); let t = next; for (let i = 0; i < ks.length - 1; i++) t = t[ks[i]]; delete t[ks[ks.length - 1]]; }
  commit(next);
}
function fillThumbs() {
  for (const img of $$('img[data-thumb]')) {
    const id = img.dataset.thumb, t = S.raw.materials?.[id] || S.lib?.[id];
    if (!t || t.kind !== 'tile') continue;
    if (S.thumbs[id]) { img.src = S.thumbs[id]; continue; }
    tiles.ready({ [id]: t }).then(() => tiles.urlFor(id, t)).then(u => { if (u) { S.thumbs[id] = u; img.src = u; } }).catch(() => {});
  }
}
function tileFormFields() {
  return `<label>Name<input name="name" required placeholder="Fireclay 2×8, Calcite"></label>
    <label>Maker<input name="maker" placeholder="optional"></label>
    <label>Photo of the tile<input name="photo" type="file" accept="image/*"></label>
    <label class="chk"><input name="sheet" type="checkbox"> It's a mosaic sheet</label>
    <label>Looks like (without a photo)<select name="look"><option value="matte">Matte porcelain</option><option value="gloss">Glossy ceramic</option><option value="zellige">Zellige (handmade)</option><option value="cotto">Terracotta</option><option value="hex">Hex mosaic sheet</option><option value="kitkat">Kit-Kat sheet</option></select></label>
    <label>Colour<input name="color" type="color" value="#e9e5dd"></label>
    <label>Size in inches (tile or sheet)<span class="two-in"><input name="w" inputmode="decimal" placeholder="3"> × <input name="h" inputmode="decimal" placeholder="12"></span></label>
    <label>Price per sq ft<input name="price" inputmode="decimal" placeholder="optional"></label>`;
}
// Shrinks a photo to ≤1600 px and returns a JPEG data URL.
function photoData(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onerror = () => rej(new Error("Couldn't read the photo."));
    r.onload = () => {
      const img = new Image();
      img.onerror = () => rej(new Error("That file isn't an image the browser can open."));
      img.onload = () => {
        const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.88));
      };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}
async function addTileFromForm(form, msg) {
  const fd = new FormData(form);
  const name = String(fd.get('name') || '').trim(), file = fd.get('photo'), isSheet = !!fd.get('sheet');
  let look = String(fd.get('look'));
  const w = parseLen(fd.get('w')), h = parseLen(fd.get('h')), price = parseFloat(fd.get('price'));
  const say = (t, bad = true) => { if (msg) { msg.className = 'srcmsg ' + (bad ? 'bad' : 'ok'); msg.textContent = t; } };
  if (!name) { say('Give it a name.'); return null; }
  const sheetLook = isSheet || look === 'hex' || look === 'kitkat';
  if (!(w > 0 && h > 0) && !(sheetLook && !file)) { say('Size needs both numbers (the tile, or the sheet).'); return null; }
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'tile';
  const tile = { id, kind: 'tile', name, maker: String(fd.get('maker') || '').trim() || undefined, color: String(fd.get('color')), grout_in: 0.125, waste_pct: 10, source: 'Added in the planner ' + new Date().toISOString().slice(0, 10) };
  try {
    if (file && file.size) {
      say('Uploading the photo…', false);
      const up = await api('POST', '/api/upload', { name, data: await photoData(file) });
      if (isSheet) Object.assign(tile, { look: 'sheet', sheet_img: up.path, sheet_w_in: w, sheet_h_in: h, unit: 'sheet', unit_sqft: Math.round((w * h) / 144 * 10000) / 10000, finish: 'matte' });
      else Object.assign(tile, { look: 'photo', face_img: up.path, face_fit: 'tile', tile_w_in: w, tile_h_in: h, orientation: h >= w ? 'vertical' : 'horizontal', pattern: 'stack', unit: 'piece', unit_sqft: Math.round((w * h) / 144 * 10000) / 10000, finish: 'matte' });
    } else if (sheetLook) {
      Object.assign(tile, { look: look === 'kitkat' ? 'kitkat' : 'hex', sheet_w_in: w || 12, sheet_h_in: h || 12, unit: 'sheet', unit_sqft: Math.round(((w || 12) * (h || 12)) / 144 * 10000) / 10000, finish: 'matte' });
    } else {
      Object.assign(tile, { look, tile_w_in: w, tile_h_in: h, orientation: 'horizontal', pattern: 'stack', unit: 'piece', unit_sqft: Math.round((w * h) / 144 * 10000) / 10000, finish: look === 'gloss' || look === 'zellige' ? 'gloss' : 'matte' });
    }
    if (Number.isFinite(price)) tile.price_per_sqft = price;
    await api('POST', '/api/library', tile);
    S.lib = await api('GET', '/api/library');
    return id;
  } catch (err) { say(err.message); return null; }
}

// ---------- tile on each surface: swap from the library, set direction and pattern ----------
function tileOptions() {
  const lib = S.lib || {}, opts = Object.entries(lib).map(([id, t]) => [id, t.name]);
  for (const [id, m] of Object.entries(S.raw.materials || {})) if (m.kind === 'tile' && !lib[id]) opts.push([id, m.name + (m.status ? ` (${m.status.toLowerCase()})` : '')]);
  return opts;
}
const isRectTile = m => m && m.tile_w_in && m.tile_h_in && !['sheet', 'kitkat', 'hex'].includes(m.look);
function surfaceRows() {
  const opts = tileOptions();
  return surfaces(S.raw).map(sf => {
    const m = S.raw.materials?.[sf.material] || {};
    const sel = (k, v, list) => `<select data-mopt="${esc(sf.material)}|${k}">${list.map(([a, b]) => `<option value="${a}" ${a === v ? 'selected' : ''}>${b}</option>`).join('')}</select>`;
    return `<div class="srow"><div class="slbl">${esc(sf.label)}</div>
      <select class="spick" data-surf="${esc(sf.path)}">${opts.map(([id, name]) => `<option value="${esc(id)}" ${id === sf.material ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select>
      ${isRectTile(m) ? `<div class="sopts">${sel('orientation', m.orientation || 'horizontal', [['vertical', 'Vertical'], ['horizontal', 'Horizontal']])}${sel('pattern', m.pattern || 'stack', [['stack', 'Stacked'], ['offset', 'Offset ½'], ['third', 'Offset ⅓']])}</div>` : ''}</div>`;
  }).join('') || '<p class="hint">No tiled surfaces in this room yet.</p>';
}
function bindSurfaceRows() {
  $$('[data-surf]').forEach(s => s.onchange = () => {
    const next = clone(S.raw), id = s.value;
    next.materials ||= {};
    if (!next.materials[id] && S.lib?.[id]) next.materials[id] = clone(S.lib[id]);
    setDeep(next, s.dataset.surf, id);
    commit(next);
  });
  $$('[data-mopt]').forEach(s => s.onchange = () => {
    const [mid, key] = s.dataset.mopt.split('|'), next = clone(S.raw);
    if (!next.materials?.[mid]) return;
    next.materials[mid][key] = s.value;
    commit(next);
  });
}

// ---------- quantities ----------
function viewQuantities() {
  const M = S.M;
  const tileRows = M.tile.map(t => {
    const unitPrice = t.unitSf && t.price != null ? t.unitSf * t.price : null;
    const math = `${f1(t.net)} sq ft + ${t.waste}% waste = ${f1(t.order)} sq ft` + (t.unitSf ? ` ÷ ${t.unitSf.toFixed(2)} sq ft per ${t.unitName} = ${t.units} ${t.unitName}s` : '') + (unitPrice != null ? ` × $${unitPrice.toFixed(2)} = ${money(t.cost)}` : '');
    const sel = t.selection ? `${t.selection.qty} ${t.unitName}${t.selection.qty === 1 ? '' : 's'} (${f1(t.selection.coverage_sqft)} sq ft)` : '—';
    const gap = t.selection && t.units != null ? (t.shortBy > 0 ? `<span class="short">${t.shortBy} more needed</span>` : '<span class="okc">covered</span>') : '';
    return `<tr class="mat"><td><b>${esc(t.name)}</b><div class="math">${math}</div></td><td class="n">${f1(t.net)}</td><td class="n">${t.waste}%</td><td class="n">${f1(t.order)}</td><td class="n">${t.units ?? '<span class="muted">size?</span>'}</td><td class="n">${t.cost != null ? money(t.cost) : (t.m.allowance ? `<span class="muted">allowance ${money(t.m.allowance.amount)}</span>` : '—')}</td><td>${sel} ${gap}</td></tr>` +
      t.areas.map(a => `<tr class="sub"><td>${esc(a.where)}</td><td class="n">${f1(sqft(a.sqin))}</td><td colspan="5"></td></tr>`).join('');
  }).join('');
  const P = M.paint;
  return `<div class="page">
    <header class="ph"><div><h1>Quantities</h1><div class="sub">${esc(S.raw.name)}</div></div></header>
    <section class="card"><div class="card-h"><h2>Tile</h2></div>
      <table class="qt"><thead><tr><th>Material / where</th><th class="n">Net sq ft</th><th class="n">Waste</th><th class="n">Order sq ft</th><th class="n">Units</th><th class="n">Cost</th><th>On the selection sheet</th></tr></thead><tbody>${tileRows || '<tr><td colspan="7" class="muted">No tile in this room.</td></tr>'}</tbody></table>
    </section>
    <div class="two">
      <section class="card"><div class="card-h"><h2>Paint</h2><span class="muted">${esc(P.m.name || '')}</span></div>
        <table class="kv"><tr><td>Walls</td><td class="n">${f1(P.wallsSf)} sq ft</td></tr><tr><td>Ceiling</td><td class="n">${f1(P.ceilingSf)} sq ft</td></tr><tr class="tot"><td>Total</td><td class="n">${f1(P.totalSf)} sq ft</td></tr>
        <tr><td colspan="2" class="math">${f1(P.totalSf)} sq ft × ${P.coats} coats ÷ ${P.coverage} sq ft per gallon = ${P.gallons.toFixed(2)} gal → buy ${P.buyGallons} gal</td></tr></table>
        <div class="bywall">${P.byWall.map(b => `<span>Wall ${esc(b.wall)} <b>${f1(b.sf)}</b></span>`).join('')}</div></section>
      <section class="card"><div class="card-h"><h2>Edge trim</h2><span class="muted">${f1(M.trim.lf)} lf</span></div>
        <table class="kv"><tr><td>Horizontal (tile tops)</td><td class="n">${f1(M.trim.horizontalLf)} lf</td></tr><tr><td>Vertical (open edges)</td><td class="n">${f1(M.trim.verticalLf)} lf</td></tr>${M.trim.nicheLf ? `<tr><td>Soap niche openings</td><td class="n">${f1(M.trim.nicheLf)} lf</td></tr>` : ''}</table>
        <ul class="edges">${M.trim.edges.map(e => `<li>Wall ${esc(e.wall)} · ${e.kind === 'top' ? 'top of ' : 'side of '}${esc(e.zone.label.toLowerCase())} at ${fmtIn(e.kind === 'top' ? e.y0 : e.x0)} · ${fmtIn(e.len)}</li>`).join('') || '<li class="muted">No exposed tile edges.</li>'}</ul></section>
    </div>
    <div class="two">
      <section class="card"><div class="card-h"><h2>Floor</h2></div><table class="kv"><tr><td>Gross floor</td><td class="n">${f1(sqft(M.floorGross))} sq ft</td></tr>${M.tubs.map(t => `<tr><td>− ${esc(t.label)}</td><td class="n">${f1(sqft(t.area))} sq ft</td></tr>`).join('')}${M.shower ? `<tr><td>− shower floor (own line)</td><td class="n">${f1(sqft(M.shower.area))} sq ft</td></tr>` : ''}<tr class="tot"><td>Floor tile area</td><td class="n">${f1(sqft(M.floorNet))} sq ft</td></tr></table></section>
      <section class="card"><div class="card-h"><h2>Excluded from paint and tile</h2></div><table class="kv">${M.excluded.map(x => `<tr><td>${esc(x.what)}</td><td class="n">${f1(sqft(x.sqin))} sq ft</td></tr>`).join('') || '<tr><td class="muted">Nothing excluded.</td></tr>'}</table></section>
    </div>
    <section class="card"><div class="card-h"><h2>By wall</h2></div><table class="qt"><thead><tr><th>Wall</th><th class="n">Length</th><th class="n">Gross</th><th class="n">Openings</th><th class="n">Tile</th><th class="n">Paint</th><th>Status</th></tr></thead><tbody>
      ${M.walls.map(W => `<tr><td><a href="#/${S.id}/walls/${encodeURIComponent(W.id)}">Wall ${esc(W.id)}</a></td><td class="n">${fmtIn(W.len)}</td><td class="n">${f1(sqft(W.gross))}</td><td class="n">${f1(sqft(W.openArea))}</td><td class="n">${f1(sqft(W.tileNet))}</td><td class="n">${f1(sqft(W.paint))}</td><td>${confChip(W.conf)}</td></tr>`).join('')}
    </tbody></table></section>
  </div>`;
}

// ---------- materials ----------
function viewMaterials() {
  const R = S.raw, M = S.M;
  const used = new Set(surfaces(R).map(s => s.material).concat(R.paint?.material || []));
  const cards = Object.entries(R.materials || {}).filter(([id]) => used.has(id)).map(([id, m]) => {
    const t = M.tile.find(x => x.id === id);
    const size = m.tile_w_in ? `${Math.min(m.tile_w_in, m.tile_h_in)} × ${Math.max(m.tile_w_in, m.tile_h_in)} in, laid ${m.orientation || 'horizontal'}, ${m.pattern || 'stack'}` : m.sheet_w_in ? `${m.sheet_w_in} × ${m.sheet_h_in} in sheets` : m.format || '';
    const sel = m.selection ? `<div class="selline">${esc(m.selection.doc)} · ${esc(m.selection.date)} · ${m.selection.qty} ${esc(m.unit || 'unit')}${m.selection.qty === 1 ? '' : 's'} · ${money(m.selection.price)}${m.selection.rep ? ' · ' + esc(m.selection.rep) : ''}</div>` : '';
    return `<article class="mcard">
      <div class="sw">${m.photo ? `<img src="${esc(m.photo)}" alt="">` : `<div class="swatch" style="background:${esc(m.color || '#ddd')}"></div>`}</div>
      <div class="mb"><div class="mk">${esc(m.kind || '')}${m.sku ? ' · SKU ' + esc(m.sku) : ''}</div><h3>${esc(m.name || id)}</h3>
        <div class="mm">${esc([m.maker, size].filter(Boolean).join(' · '))}</div>
        <dl>${m.where ? `<dt>Where</dt><dd>${esc(m.where)}</dd>` : ''}${m.status ? `<dt>Status</dt><dd>${esc(m.status)}</dd>` : ''}
        ${m.price_per_sqft != null ? `<dt>Price</dt><dd>$${m.price_per_sqft.toFixed(2)} / sq ft${m.unit_sqft ? ` · ${m.unit_sqft.toFixed(2)} sq ft per ${esc(m.unit)} ($${(m.unit_sqft * m.price_per_sqft).toFixed(2)} each)` : ''}</dd>` : ''}
        ${m.product ? `<dt>Product</dt><dd>${esc(m.product)}</dd>` : ''}
        ${m.allowance ? `<dt>Budget</dt><dd>${money(m.allowance.amount)} — ${esc(m.allowance.source)}</dd>` : ''}
        ${t ? `<dt>Needed</dt><dd>${f1(t.order)} sq ft${t.units != null ? ` = ${t.units} ${esc(t.unitName)}s` : ''}</dd>` : ''}</dl>${sel}</div></article>`;
  }).join('');
  const fx = (R.fixtures || []).map(f => `<tr><td><b>${esc(f.item)}</b></td><td>${esc(f.choice)}${f.photos ? `<div class="fxph">${f.photos.map(p => `<img src="${esc(p)}" alt="">`).join('')}</div>` : ''}</td><td class="n">${f.price != null ? money(f.price) : '—'}</td><td class="muted">${esc(f.source || '')}</td></tr>`).join('');
  const lib = Object.entries(S.lib || {}).map(([id, t]) => {
    const size = t.tile_w_in ? `${Math.min(t.tile_w_in, t.tile_h_in)} × ${Math.max(t.tile_w_in, t.tile_h_in)}″` : t.sheet_w_in ? `${t.sheet_w_in} × ${t.sheet_h_in}″ sheet` : '';
    return `<div class="libtile"><img data-thumb="${esc(id)}" alt=""><div><b>${esc(t.name)}</b><div class="muted small">${esc([t.maker, size, t.price_per_sqft != null ? '$' + t.price_per_sqft.toFixed(2) + '/sq ft' : 'no price'].filter(Boolean).join(' · '))}</div>${t.source ? `<div class="muted small">${esc(t.source)}</div>` : ''}</div></div>`;
  }).join('');
  return `<div class="page"><header class="ph"><div><h1>Materials</h1><div class="sub">${esc(R.name)}</div></div></header>
    <section class="card"><div class="card-h"><h2>Tile on each surface</h2></div><div class="surfgrid">${surfaceRows()}</div></section>
    <div class="mgrid">${cards}</div>
    <section class="card"><div class="card-h"><h2>Fixtures and picks</h2></div><table class="qt fx"><thead><tr><th>Item</th><th>Choice</th><th class="n">Price</th><th>Source</th></tr></thead><tbody>${fx || '<tr><td colspan="4" class="muted">—</td></tr>'}</tbody></table></section>
    <section class="card"><div class="card-h"><h2>Tile library</h2><span class="muted">${Object.keys(S.lib || {}).length} tiles</span></div>
      <div class="libgrid">${lib}</div>
      <form id="libf" class="libf"><h4>Add a tile</h4>${tileFormFields()}
        <div class="row"><button class="primary" type="submit">Add to library</button><span id="lib-msg" class="srcmsg"></span></div>
      </form></section></div>`;
}
function bindMaterials() {
  bindSurfaceRows();
  fillThumbs();
  $('#libf').onsubmit = async e => {
    e.preventDefault();
    const id = await addTileFromForm(e.target, $('#lib-msg'));
    if (id) render();
  };
}

// ---------- open items ----------
function viewOpen() {
  const M = S.M, auto = M.open.filter(o => o.auto), hand = M.open.filter(o => !o.auto);
  return `<div class="page"><header class="ph"><div><h1>Open Items</h1><div class="sub">${esc(S.raw.name)} · ${M.open.length} open</div></div></header>
    <section class="card"><div class="card-h"><h2>Decisions and checks</h2></div><ul class="oi big">${hand.map(oiRow).join('') || '<li class="muted">None.</li>'}</ul></section>
    <section class="card"><div class="card-h"><h2>Still to measure</h2><a href="#/${S.id}/measure">Measurements</a></div><ul class="oi big">${auto.map(oiRow).join('') || '<li class="muted">Everything is measured.</li>'}</ul></section>
    ${M.issues.length ? `<section class="card"><div class="card-h"><h2>Validation</h2></div><ul class="val">${M.issues.map(i => `<li class="${i.level}"><span class="code">${esc(i.code)}</span>${esc(i.text)}</li>`).join('')}</ul></section>` : ''}</div>`;
}

// ---------- measurements ----------
export function parseLen(s) {
  s = String(s ?? '').trim().replace(/[″”]/g, '"').replace(/[′’]/g, "'");
  if (!s) return null;
  let feet = 0, rest = s;
  const fm = s.match(/^(\d+(?:\.\d+)?)\s*'\s*-?\s*(.*)$/);
  if (fm) { feet = parseFloat(fm[1]); rest = fm[2].trim(); }
  rest = rest.replace(/"\s*$/, '').trim();
  if (!rest) return fm ? feet * 12 : NaN;
  const im = rest.match(/^(\d+(?:\.\d+)?)?\s*-?\s*(?:(\d+)\s*\/\s*(\d+))?$/);
  if (!im || (im[1] == null && im[2] == null)) return NaN;
  let inch = im[1] != null ? parseFloat(im[1]) : 0;
  if (im[2] != null) { if (+im[3] === 0) return NaN; inch += +im[2] / +im[3]; }
  return feet * 12 + inch;
}
const numStr = v => (v == null ? '' : String(Math.round(v * 1000) / 1000));
function confSelect(path, c) {
  return `<select data-conf="${esc(path)}" class="cs conf-${c}">${CONF_ORDER.map(k => `<option value="${k}" ${k === c ? 'selected' : ''}>${CONF_LABEL[k]}</option>`).join('')}</select>`;
}
function lenInput(path, v, enabled = true) { return `<input class="len" data-len="${esc(path)}" value="${esc(numStr(v))}" ${enabled ? '' : 'disabled'} inputmode="decimal" autocomplete="off"><span class="fmt">${enabled && v != null ? fmtIn(v) : ''}</span>`; }
function viewMeasure() {
  const R = S.raw, M = S.M;
  const wallRows = R.walls.map((w, i) => `<tr><td><b>Wall ${esc(w.id)}</b>${w.note ? `<div class="muted small">${esc(w.note)}</div>` : ''}</td><td>${lenInput(`walls.${i}.length_in`, w.length_in)}</td><td>${confSelect(`walls.${i}.conf`, w.conf || 'assumed')}</td></tr>`).join('');
  const objRows = (R.objects || []).map((o, i) => {
    const T = TYPES[o.type] || {}, k = T.kind;
    const ob = M.byId[o.id] || {};
    const cell = (key, val, on) => `<td>${lenInput(`objects.${i}.${key}`, val, on)}</td>`;
    return `<tr><td><b>${esc(o.label || T.label || o.type)}</b><div class="muted small">${esc(o.type)}</div></td>
      <td><select data-wall="${i}">${R.walls.map(w => `<option ${w.id === o.wall ? 'selected' : ''}>${esc(w.id)}</option>`).join('')}</select></td>
      ${cell('x_in', ob.x ?? o.x_in, true)}${cell('w_in', ob.w ?? o.w_in, true)}${cell('y_in', ob.y ?? o.y_in, k !== 'fixture')}${cell('h_in', ob.h ?? o.h_in, k !== 'fixture' || o.type === 'tub' || o.type === 'vanity' || o.type === 'toilet')}${cell('depth_in', ob.depth ?? o.depth_in, k === 'fixture' || o.type === 'niche' || o.type === 'shelf')}
      <td>${confSelect(`objects.${i}.conf`, o.conf || 'assumed')}</td></tr>`;
  }).join('');
  return `<div class="page measure"><header class="ph"><div><h1>Measurements</h1><div class="sub">${esc(R.name)} · ${M.doneDims} of ${M.dims.length} taped or from records</div></div></header>
    <section class="card"><div class="card-h"><h2>Room</h2><span class="muted">inches or feet-inches: 72 · 70 1/2 · 6' 0 1/2"</span></div>
      <table class="mt"><thead><tr><th>Dimension</th><th>Inches</th><th>Status</th></tr></thead><tbody>
      <tr><td><b>Ceiling height</b>${R.ceiling_source ? `<div class="muted small">${esc(R.ceiling_source)}</div>` : ''}</td><td>${lenInput('ceiling_in', R.ceiling_in)}</td><td>${confSelect('ceiling_conf', R.ceiling_conf || 'assumed')}</td></tr>
      ${wallRows}</tbody></table>
      ${M.closed ? '' : `<div class="warnline">${esc(M.issues.find(i => i.code === 'NOT_CLOSED')?.text || '')}</div>`}</section>
    <section class="card"><div class="card-h"><h2>On the walls</h2></div>
      <table class="mt objs"><thead><tr><th>Item</th><th>Wall</th><th>From left corner</th><th>Width</th><th>Up from floor</th><th>Height</th><th>Depth into room</th><th>Status</th></tr></thead><tbody>${objRows}</tbody></table></section>
  </div>`;
}
function setPath(obj, path, val) {
  const ks = path.split('.'); let o = obj;
  for (let i = 0; i < ks.length - 1; i++) o = o[/^\d+$/.test(ks[i]) ? +ks[i] : ks[i]];
  o[ks[ks.length - 1]] = val;
}
function confPathFor(path) { // walls.0.length_in -> walls.0.conf ; ceiling_in -> ceiling_conf ; objects.3.x_in -> objects.3.conf
  if (path === 'ceiling_in') return 'ceiling_conf';
  const ks = path.split('.'); return `${ks[0]}.${ks[1]}.conf`;
}
function bindMeasure() {
  bindLenInputs(document);
  $$('select[data-conf]').forEach(sel => sel.onchange = () => { const next = clone(S.raw); setPath(next, sel.dataset.conf, sel.value); commit(next); });
  $$('select[data-wall]').forEach(sel => sel.onchange = () => { const next = clone(S.raw); next.objects[+sel.dataset.wall].wall = sel.value; commit(next); });
}
// Length boxes keyed by a path into the room JSON; typing a number marks it measured.
function bindLenInputs(scope) {
  if (!scope) return;
  $$('input[data-len]', scope).forEach(inp => {
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
    inp.addEventListener('change', () => {
      const v = parseLen(inp.value);
      if (v == null || Number.isNaN(v) || v < 0) { inp.classList.add('bad'); return; }
      inp.classList.remove('bad');
      const next = clone(S.raw); setPath(next, inp.dataset.len, Math.round(v * 1000) / 1000);
      setPath(next, confPathFor(inp.dataset.len), 'measured');
      const active = inp.dataset.len;
      commit(next);
      const again = $(`input[data-len="${CSS.escape(active)}"]`); if (again) { const all = $$('input[data-len]:not([disabled])'); const i = all.indexOf(again); (all[i + 1] || again).focus(); }
    });
  });
}

// ---------- source ----------
function viewSource(broken = false) {
  const txt = JSON.stringify(S.raw, null, 2);
  return `<div class="page src"><header class="ph"><div><h1>Source JSON</h1><div class="sub">${esc(S.raw.name)} · rooms/${esc(S.id)}.json</div></div>
    <div class="srcbtns"><button id="src-save" class="primary">Save</button><button id="src-export">Export</button><button id="src-revert">Reset</button></div></header>
    ${broken && S.errs.length ? `<ul class="val">${S.errs.map(e => `<li class="error">${esc(e)}</li>`).join('')}</ul>` : ''}
    <div id="src-msg" class="srcmsg"></div>
    <textarea id="src" spellcheck="false">${esc(txt)}</textarea></div>`;
}
function bindSource() {
  const ta = $('#src'), msg = $('#src-msg');
  const check = () => {
    try { const j = JSON.parse(ta.value); const errs = validate(j); msg.className = 'srcmsg ' + (errs.length ? 'bad' : 'ok'); msg.textContent = errs.length ? errs.join(' ') : 'Valid'; return errs.length ? null : j; }
    catch (e) { msg.className = 'srcmsg bad'; msg.textContent = 'JSON error: ' + e.message; return null; }
  };
  ta.addEventListener('input', check);
  ta.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); $('#src-save').click(); } if (e.key === 'Tab') { e.preventDefault(); const p = ta.selectionStart; ta.setRangeText('  ', p, ta.selectionEnd, 'end'); } });
  $('#src-save').onclick = () => { const j = check(); if (!j) return; if (j.id !== S.id) { msg.className = 'srcmsg bad'; msg.textContent = `"id" must stay "${S.id}".`; return; } commit(j); };
  $('#src-export').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S.raw, null, 2) + '\n'], { type: 'application/json' })); a.download = S.id + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  $('#src-revert').onclick = async () => { const fresh = await api('GET', '/api/rooms/' + encodeURIComponent(S.id)); S.raw = fresh; rebuild(); render(); };
}

// ---------- new bathroom ----------
function viewNew() {
  const props = [...new Set(S.rooms.map(r => r.property).filter(Boolean))];
  return `<div class="page"><header class="ph"><div><h1>New bathroom</h1></div></header>
    <form id="newf" class="card newf">
      <label>Name<input name="name" required placeholder="Guest Bathroom"></label>
      <label>Property<input name="property" list="props" required value="${esc(props[0] || '')}"><datalist id="props">${props.map(p => `<option value="${esc(p)}">`).join('')}</datalist></label>
      <label>Wall A — first wall, left to right (inches)<input name="a" required placeholder="60" inputmode="decimal"></label>
      <label>Wall B — the wall to its right (inches)<input name="b" required placeholder="96" inputmode="decimal"></label>
      <label>Ceiling (inches)<input name="h" value="96" inputmode="decimal"></label>
      <div class="row"><button class="primary" type="submit">Create</button><span id="new-msg" class="srcmsg"></span></div>
    </form></div>`;
}
function bindNew() {
  $('#newf').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target), a = parseLen(fd.get('a')), b = parseLen(fd.get('b')), h = parseLen(fd.get('h') || '96');
    const msg = $('#new-msg');
    if (!(a > 0 && b > 0 && h > 0)) { msg.className = 'srcmsg bad'; msg.textContent = 'Wall lengths and ceiling must be numbers.'; return; }
    const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const prop = String(fd.get('property')).trim(), name = String(fd.get('name')).trim();
    const street = prop.replace(/^\d+\s+/, '').replace(/^[nsew]\.?\s+/i, '').split(/\s+/)[0];
    const id = (slug(street || 'room') + '-' + slug(name)).slice(0, 60);
    const room = {
      schema: 1, id, name, property: prop, as_of: new Date().toISOString().slice(0, 10), summary: '',
      ceiling_in: h, ceiling_conf: 'measured', start_heading: 'E',
      walls: [{ id: 'A', length_in: a, conf: 'measured' }, { id: 'B', length_in: b, conf: 'measured' }, { id: 'C', length_in: a, conf: 'measured' }, { id: 'D', length_in: b, conf: 'measured' }],
      objects: [{ id: 'door', type: 'door', wall: 'C', x_in: Math.max(0, a / 2 - 15), w_in: 30, h_in: 80, hinge: 'left', conf: 'assumed' }],
      floor: {}, paint: { material: 'paint', coats: 2, ceiling: true },
      materials: { paint: { kind: 'paint', name: 'Wall paint', color: '#ece5d4', coverage_sqft_per_gal: 350 } },
      fixtures: [], scope: [], open_items: [], photos: [],
    };
    try { await api('POST', '/api/rooms', room); S.rooms = await api('GET', '/api/rooms'); location.hash = `#/${id}/measure`; }
    catch (err) { msg.className = 'srcmsg bad'; msg.textContent = err.message; }
  };
}

// ---------- boot ----------
document.addEventListener('keydown', e => {
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (S.view !== 'plan' && S.view !== 'walls' && S.view !== '3d') return;
  if (S.sel) {
    if (e.key === 'Escape') { S.sel = null; if (S.view === '3d' && S.three) { S.three.setSel(null); paint3DPanel(); } else render(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); $('[data-ins-act="del"]')?.click(); return; }
    if (e.key.startsWith('Arrow') && nudge(e)) { e.preventDefault(); return; }
  } else if (S.view === 'walls' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    const W = curWall(); go('walls', e.key === 'ArrowRight' ? W.next.id : W.prev.id);
  }
});
window.addEventListener('hashchange', () => route().catch(showFatal));
function showFatal(e) { $('#main').innerHTML = `<div class="page"><div class="card fatal"><h2>Can't reach the planner's server</h2><p>${esc(e.message)}</p></div></div>`; }
route().catch(showFatal);
window.__bp = S; // handy in the console
if (!SHARE) window.name = 'bathroom-planner'; // the bookmark button reuses this tab
