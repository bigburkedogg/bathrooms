// Geometry and take-offs for one bathroom. Pure functions, no DOM: the browser
// views and tools/check.mjs both build from here, so the numbers always agree.
//
// Plan coordinates are inches with y pointing down (south when north is up).
// Walls are listed clockwise as seen from above; walking them clockwise keeps the
// room on your right, which is also left-to-right when you stand inside facing
// each wall. A wall's x runs from its start corner (shared with the previous
// wall) to its end corner; y runs up from the finished floor.

export const CONF_LABEL = { measured: 'Measured', documented: 'From records', estimated: 'Estimated', assumed: 'Assumed' };
export const CONF_ORDER = ['measured', 'documented', 'estimated', 'assumed'];
const RANK = { measured: 0, documented: 1, estimated: 2, assumed: 3 };
export const EPS = 0.25;

const HEAD = { E: [1, 0], S: [0, 1], W: [-1, 0], N: [0, -1] };
const turnRight = d => [-d[1], d[0]];
const turnLeft = d => [d[1], -d[0]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const mul = (a, k) => [a[0] * k, a[1] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
export const SQIN_PER_SQFT = 144;
export const sqft = sqin => sqin / SQIN_PER_SQFT;

export const TYPES = {
  door:       { label: 'Door', w: 30, h: 80, y: 0, kind: 'opening' },
  window:     { label: 'Window', w: 30, h: 36, y: 40, kind: 'opening' },
  niche:      { label: 'Soap niche', w: 12, h: 12, y: 42, depth: 3.5, kind: 'recess' },
  tub:        { label: 'Tub', w: 60, depth: 30, h: 15, kind: 'fixture' },
  shower:     { label: 'Shower', w: 60, depth: 36, h: 0, kind: 'fixture' },
  toilet:     { label: 'Toilet', w: 20, depth: 28, h: 30, kind: 'fixture' },
  vanity:     { label: 'Vanity', w: 30, depth: 21, h: 34, kind: 'fixture' },
  mirror:     { label: 'Mirror', w: 24, h: 32, y: 42, kind: 'flat' },
  light:      { label: 'Light', w: 18, h: 6, y: 80, kind: 'flat' },
  valve:      { label: 'Shower valve', w: 7, h: 7, y: 44, kind: 'flat' },
  showerhead: { label: 'Shower head', w: 5, h: 5, y: 80, kind: 'flat' },
  spout:      { label: 'Tub spout', w: 3, h: 3, y: 22, kind: 'flat' },
  shelf:      { label: 'Shelf', w: 24, h: 2, y: 54, depth: 6, kind: 'flat' },
  towel_bar:  { label: 'Towel bar', w: 24, h: 2, y: 48, kind: 'flat' },
  outlet:     { label: 'Outlet', w: 3, h: 5, y: 42, kind: 'flat' },
  switch:     { label: 'Switch', w: 3, h: 5, y: 48, kind: 'flat' },
  fan:        { label: 'Fan', w: 10, h: 10, y: 0, kind: 'ceiling' },
};

// ---------- number formatting ----------
const FRACS = { 0.125: '⅛', 0.25: '¼', 0.375: '⅜', 0.5: '½', 0.625: '⅝', 0.75: '¾', 0.875: '⅞' };
export function fmtIn(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const neg = v < 0; v = Math.abs(v);
  let whole = Math.floor(v), frac = Math.round((v - whole) * 16) / 16;
  if (frac === 1) { whole += 1; frac = 0; }
  let s = String(whole);
  if (frac) {
    const f8 = Math.round(frac * 8) / 8;
    s = Math.abs(f8 - frac) < 1e-9 && FRACS[f8] ? (whole ? whole : '') + FRACS[f8] : (v.toFixed(3).replace(/0+$/, ''));
  }
  return (neg ? '−' : '') + s + '″';
}
export function fmtFtIn(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const ft = Math.floor((v + 1e-9) / 12), inch = v - ft * 12;
  return `${ft}′-${fmtIn(inch)}`;
}
export const fmtSf = (v, d = 1) => (v == null ? '—' : v.toFixed(d));
export const money = v => (v == null ? '—' : '$' + Math.round(v).toLocaleString('en-US'));

// ---------- helpers ----------
function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}
function rectOverlap(a, b) { // {x0,x1,y0,y1}
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}
function pointInPoly(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function footOverlap(f1, f2) { // axis-aligned in plan for rectilinear rooms; fall back to bbox
  const bb = f => ({ x0: Math.min(...f.map(p => p[0])), x1: Math.max(...f.map(p => p[0])), y0: Math.min(...f.map(p => p[1])), y1: Math.max(...f.map(p => p[1])) });
  return rectOverlap(bb(f1), bb(f2));
}
export function worstConf(list) {
  let w = 'measured';
  for (const c of list) if (RANK[c || 'assumed'] > RANK[w]) w = c || 'assumed';
  return w;
}

// Opening rectangle on its wall, including door casing (paint stops at the casing's outside edge).
export function openingRect(o) {
  const c = o.type === 'door' ? num(o.casing_in, 2.5) : num(o.trim_in, 0);
  return { x0: o.x - c, x1: o.x + o.w + c, y0: o.y, y1: o.y + o.h + (o.type === 'door' ? c : c) };
}

// Where a fixture footprint touches walls. Edge 0 is the back edge on its own wall,
// 1 the right side, 2 the front, 3 the left side (as seen facing the wall).
function contactsOf(foot, walls) {
  const on = [], used = [false, false, false, false];
  for (let k = 0; k < 4; k++) {
    const a = foot[k], b = foot[(k + 1) % 4];
    for (const W of walls) {
      const da = dot(sub(a, W.start), W.normal), db = dot(sub(b, W.start), W.normal);
      if (Math.abs(da) > EPS || Math.abs(db) > EPS) continue;
      let t0 = dot(sub(a, W.start), W.dir), t1 = dot(sub(b, W.start), W.dir);
      if (t0 > t1) [t0, t1] = [t1, t0];
      const x0 = Math.max(0, t0), x1 = Math.min(W.len, t1);
      if (x1 - x0 > EPS) { on.push({ wall: W.id, x0, x1, edge: k }); used[k] = true; }
    }
  }
  const open = [];
  for (let k = 0; k < 4; k++) if (!used[k]) open.push({ edge: k, a: foot[k], b: foot[(k + 1) % 4] });
  return { on, open };
}

// ---------- build ----------
export function build(room) {
  const issues = [];
  const H = num(room.ceiling_in, 96);
  const mats = room.materials || {};
  const startDir = HEAD[room.start_heading || 'E'] || HEAD.E;

  // walls
  const walls = [];
  let p = [0, 0], d = startDir;
  (room.walls || []).forEach((w, i) => {
    const len = num(w.length_in, 0);
    const start = p, end = add(p, mul(d, len));
    walls.push({
      id: w.id, src: w, i, len, start, end, dir: d, normal: turnRight(d), turn: w.turn === 'L' ? 'L' : 'R',
      height: num(w.height_in, H), conf: w.conf || 'assumed', note: w.note || '',
      objects: [], zones: [], contacts: [],
    });
    p = end;
    d = w.turn === 'L' ? turnLeft(d) : turnRight(d);
  });
  const wallById = Object.fromEntries(walls.map(w => [w.id, w]));
  walls.forEach((w, i) => { w.prev = walls[(i - 1 + walls.length) % walls.length]; w.next = walls[(i + 1) % walls.length]; });

  const closure = Math.hypot(p[0], p[1]);
  const headingBack = d[0] === startDir[0] && d[1] === startDir[1];
  const closed = closure <= EPS && headingBack;
  if (!walls.length) issues.push({ level: 'error', code: 'NO_WALLS', text: 'No walls defined.' });
  else if (!closed) {
    let text = `The walls don't close: the last corner misses the first by ${fmtIn(closure)}.`;
    if (walls.length === 4 && walls.every(w => w.turn === 'R')) {
      const parts = [];
      if (Math.abs(walls[0].len - walls[2].len) > EPS) parts.push(`${walls[0].id} is ${fmtIn(walls[0].len)} but ${walls[2].id} is ${fmtIn(walls[2].len)}`);
      if (Math.abs(walls[1].len - walls[3].len) > EPS) parts.push(`${walls[1].id} is ${fmtIn(walls[1].len)} but ${walls[3].id} is ${fmtIn(walls[3].len)}`);
      if (parts.length) text += ' Opposite walls disagree: ' + parts.join('; ') + '.';
    }
    issues.push({ level: 'error', code: 'NOT_CLOSED', text });
  }

  const poly = walls.map(w => w.start);
  const xs = poly.map(q => q[0]).concat(walls.map(w => w.end[0]));
  const ys = poly.map(q => q[1]).concat(walls.map(w => w.end[1]));
  const bbox = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  bbox.w = bbox.x1 - bbox.x0; bbox.h = bbox.y1 - bbox.y0;
  const floorGross = poly.length >= 3 ? polyArea(poly) : 0;

  // objects
  const objects = [];
  for (const o of room.objects || []) {
    const W = wallById[o.wall];
    const T = TYPES[o.type] || { label: o.type, w: 12, h: 12, y: 0, kind: 'flat' };
    if (!W && T.kind !== 'ceiling') { issues.push({ level: 'error', code: 'BAD_WALL', text: `${o.id}: wall "${o.wall}" doesn't exist.` }); continue; }
    const x = num(o.x_in, 0), w = num(o.w_in, T.w), y = num(o.y_in, T.y ?? 0), h = num(o.h_in, T.h ?? 0), depth = num(o.depth_in, T.depth ?? 0);
    const obj = { ...o, T, kind: T.kind, label: o.label || T.label, x, w, y, h, depth, conf: o.conf || 'assumed' };
    if (T.kind === 'ceiling') { obj.plan = [num(o.plan_x_in, bbox.x0 + bbox.w / 2), num(o.plan_y_in, bbox.y0 + bbox.h / 2)]; objects.push(obj); continue; }
    obj.W = W;
    obj.p0 = add(W.start, mul(W.dir, x));
    obj.p1 = add(W.start, mul(W.dir, x + w));
    if (T.kind === 'fixture') {
      obj.foot = [obj.p0, obj.p1, add(obj.p1, mul(W.normal, depth)), add(obj.p0, mul(W.normal, depth))];
      obj.area = w * depth;
      const c = contactsOf(obj.foot, walls);
      obj.on = c.on; obj.open = c.open;
      for (const ct of c.on) wallById[ct.wall].contacts.push({ obj, ...ct });
    }
    if (x < -EPS || x + w > W.len + EPS) issues.push({ level: 'error', code: 'OFF_WALL', wall: W.id, text: `${obj.label} runs past the end of wall ${W.id} (${fmtIn(x)} + ${fmtIn(w)} on a ${fmtIn(W.len)} wall).` });
    if (T.kind !== 'fixture' && y + h > W.height + EPS) issues.push({ level: 'warn', code: 'ABOVE_CEILING', wall: W.id, text: `${obj.label} on wall ${W.id} reaches above the ceiling.` });
    W.objects.push(obj);
    objects.push(obj);
  }
  const byId = Object.fromEntries(objects.map(o => [o.id, o]));

  // fixtures that collide in plan
  const fixtures = objects.filter(o => o.foot);
  for (let i = 0; i < fixtures.length; i++) for (let j = i + 1; j < fixtures.length; j++) {
    const a = fixtures[i], b = fixtures[j];
    if (footOverlap(a.foot, b.foot) > 4) issues.push({ level: 'warn', code: 'FIXTURE_OVERLAP', text: `${a.label} and ${b.label} overlap in plan.` });
  }
  // Toilet centerline: from the center of each toilet to the nearest wall or fixture on each side,
  // measured along the wall it backs onto, anywhere beside it (from that wall out to its front).
  const weakest = (...cs) => CONF_ORDER[Math.max(...cs.map(c => Math.max(0, CONF_ORDER.indexOf(c || 'assumed'))))];
  for (const t of fixtures.filter(o => o.type === 'toilet')) {
    const W = t.W, cx = t.x + t.w / 2, v0 = EPS, v1 = Math.max(t.depth, 1) - EPS;
    const uv = p => [dot(sub(p, W.start), W.dir), dot(sub(p, W.start), W.normal)];
    let left = null, right = null;
    const take = (u0, u1, what, conf) => {
      if (u1 <= cx + EPS) { if (!left || u1 > left.u) left = { u: u1, what, conf }; }
      else if (u0 >= cx - EPS) { if (!right || u0 < right.u) right = { u: u0, what, conf }; }
    };
    for (const V of walls) {
      if (V === W) continue;
      const a = uv(V.start), b = uv(V.end);
      let s0 = 0, s1 = 1;
      if (Math.abs(b[1] - a[1]) < 1e-9) { if (a[1] <= v0 || a[1] >= v1) continue; }
      else {
        const ta = (v0 - a[1]) / (b[1] - a[1]), tb = (v1 - a[1]) / (b[1] - a[1]);
        s0 = Math.max(0, Math.min(ta, tb)); s1 = Math.min(1, Math.max(ta, tb));
        if (s1 <= s0) continue;
      }
      const ua = a[0] + (b[0] - a[0]) * s0, ub = a[0] + (b[0] - a[0]) * s1;
      take(Math.min(ua, ub), Math.max(ua, ub), `wall ${V.id}`, weakest(t.conf, W.conf, V.conf));
    }
    for (const f of fixtures) {
      if (f === t) continue;
      const p = f.foot.map(uv), us = p.map(q => q[0]), vs = p.map(q => q[1]);
      if (Math.max(...vs) <= v0 || Math.min(...vs) >= v1) continue;
      take(Math.min(...us), Math.max(...us), `the ${f.label.toLowerCase()}`, weakest(t.conf, f.conf));
    }
    t.clear = { cx, left: left && { ...left, d: cx - left.u }, right: right && { ...right, d: right.u - cx } };
  }

  // doors blocked by fixtures on the same wall
  for (const W of walls) for (const o of W.objects.filter(q => q.type === 'door')) {
    for (const f of W.objects.filter(q => q.foot)) {
      if (Math.min(o.x + o.w, f.x + f.w) - Math.max(o.x, f.x) > EPS) issues.push({ level: 'warn', code: 'DOOR_BLOCKED', wall: W.id, text: `The door on wall ${W.id} overlaps the ${f.label.toLowerCase()}.` });
    }
  }

  // tile zones
  const zones = [];
  const pushZone = z => {
    const W = wallById[z.wall];
    if (!W) { issues.push({ level: 'error', code: 'BAD_ZONE', text: `Tile zone on unknown wall "${z.wall}".` }); return; }
    const zone = { ...z, W, x0: Math.max(0, z.x0), x1: Math.min(W.len, z.x1), y0: Math.max(0, z.y0), y1: Math.min(W.height, z.y1) };
    if (zone.x1 - zone.x0 <= EPS || zone.y1 - zone.y0 <= EPS) return;
    if (!mats[zone.material]) issues.push({ level: 'error', code: 'BAD_MATERIAL', text: `Material "${zone.material}" isn't defined.` });
    W.zones.push(zone); zones.push(zone);
  };
  for (const o of fixtures) {
    if (o.type === 'shower' && o.walls_material) {
      for (const ct of o.on) pushZone({ wall: ct.wall, x0: ct.x0, x1: ct.x1, y0: 0, y1: num(o.tile_to_in, H), material: o.walls_material, label: 'Shower walls', source: o.id, skey: `${o.id}:walls` });
    }
    if (o.type === 'tub' && o.surround?.material) {
      for (const ct of o.on) pushZone({ wall: ct.wall, x0: ct.x0, x1: ct.x1, y0: o.h, y1: num(o.surround.to_in, H), material: o.surround.material, label: 'Tub surround', source: o.id, skey: `${o.id}:surround` });
    }
  }
  for (const [zi, z] of (room.zones || []).entries()) {
    const ids = z.walls || [z.wall];
    for (const id of ids) {
      const W = wallById[id];
      if (!W) { issues.push({ level: 'error', code: 'BAD_ZONE', text: `Tile zone on unknown wall "${id}".` }); continue; }
      pushZone({ wall: id, x0: num(z.x0_in, 0), x1: num(z.x1_in, W.len), y0: num(z.y0_in, 0), y1: num(z.y1_in, W.height), material: z.material, label: z.label || 'Tile', source: z.id || 'zone', skey: `zone:${zi}` });
    }
  }

  // per-wall areas
  for (const W of walls) {
    W.gross = W.len * W.height;
    W.openings = W.objects.filter(o => o.kind === 'opening');
    W.openArea = 0;
    for (const o of W.openings) {
      const r = openingRect(o);
      W.openArea += rectOverlap(r, { x0: 0, x1: W.len, y0: 0, y1: W.height });
    }
    for (const z of W.zones) {
      const r = { x0: z.x0, x1: z.x1, y0: z.y0, y1: z.y1 };
      let planar = (r.x1 - r.x0) * (r.y1 - r.y0);
      for (const o of W.openings) planar -= rectOverlap(openingRect(o), r);
      let returns = 0, niched = 0;
      for (const o of W.objects.filter(q => q.type === 'niche')) {
        const ov = rectOverlap({ x0: o.x, x1: o.x + o.w, y0: o.y, y1: o.y + o.h }, r);
        if (ov <= 0) continue;
        returns += 2 * (o.w + o.h) * o.depth;
        o.zone = z;
        if (o.back_material && o.back_material !== z.material) niched += ov; // the back is its own tile
      }
      z.planar = Math.max(0, planar);
      z.net = z.planar - niched + returns;
    }
    for (let i = 0; i < W.zones.length; i++) for (let j = i + 1; j < W.zones.length; j++) {
      if (rectOverlap(W.zones[i], W.zones[j]) > 1) issues.push({ level: 'warn', code: 'ZONE_OVERLAP', wall: W.id, text: `Two tile areas overlap on wall ${W.id}; the overlap is counted twice.` });
    }
    W.tileNet = W.zones.reduce((s, z) => s + z.net, 0);
    W.paint = Math.max(0, W.gross - W.openArea - W.zones.reduce((s, z) => s + z.planar, 0));
  }

  // shower curbs: a strip along each open side of the shower, inside its footprint
  for (const s of fixtures.filter(o => o.type === 'shower')) {
    s.panArea = s.area; s.curbs = []; s.curbTile = 0;
    const c = s.curb;
    if (!c || c.none) continue;
    const cw = num(c.w_in, 5), ch = num(c.h_in, 4), W = s.W;
    for (const e of s.open || []) {
      const d = sub(e.b, e.a), L = Math.hypot(d[0], d[1]);
      if (L < EPS) continue;
      const u = mul(d, 1 / L), inward = e.edge === 2 ? mul(W.normal, -1) : e.edge === 1 ? mul(W.dir, -1) : W.dir;
      const poly = [e.a, e.b, add(e.b, mul(inward, cw)), add(e.a, mul(inward, cw))];
      s.curbs.push({ edge: e.edge, a: e.a, b: e.b, u, inward, len: L, poly, w: cw, h: ch });
      s.panArea -= L * cw;
      s.curbTile += L * (cw + 2 * ch);
    }
    // where the curb meets each side wall, for the elevations
    s.curbOnWalls = [];
    for (const ct of s.on || []) {
      if (ct.edge === 0) continue;
      const Wc = wallById[ct.wall];
      for (const cb of s.curbs) for (const p of [cb.a, cb.b]) {
        if (Math.abs(dot(sub(p, Wc.start), Wc.normal)) > EPS) continue;
        const t = dot(sub(p, Wc.start), Wc.dir);
        if (t < ct.x0 - EPS || t > ct.x1 + EPS) continue;
        const toward = Math.abs(t - ct.x1) < Math.abs(t - ct.x0) ? -1 : 1;
        s.curbOnWalls.push({ wall: ct.wall, x0: Math.min(t, t + toward * cw), x1: Math.max(t, t + toward * cw), h: ch });
      }
    }
  }

  // floor
  const floor = room.floor || {};
  const shower = fixtures.find(o => o.type === 'shower');
  const tubs = fixtures.filter(o => o.type === 'tub');
  const excluded = [];
  let floorNet = floorGross;
  for (const t of tubs) { floorNet -= t.area; excluded.push({ what: `${t.label} footprint (floor)`, sqin: t.area }); }
  if (shower) floorNet -= shower.area;
  for (const v of fixtures.filter(o => o.type === 'vanity' && o.floor_under === false)) { floorNet -= v.area; excluded.push({ what: `${v.label} footprint (floor)`, sqin: v.area }); }
  for (const W of walls) for (const o of W.openings) excluded.push({ what: `${o.label} on wall ${W.id}`, sqin: rectOverlap(openingRect(o), { x0: 0, x1: W.len, y0: 0, y1: W.height }) });
  floorNet = Math.max(0, floorNet);

  // take-off by material
  const lines = {};
  const addArea = (mid, where, sqin, extra = {}) => {
    if (!mid || sqin <= 0) return;
    (lines[mid] ||= { id: mid, areas: [] }).areas.push({ where, sqin, ...extra });
  };
  for (const z of zones) addArea(z.material, `Wall ${z.wall} · ${z.label}`, z.net, { wall: z.wall, skey: z.skey });
  if (floor.material) addArea(floor.material, 'Floor', floorNet, { floor: true, skey: 'floor' });
  if (shower && shower.floor_material) addArea(shower.floor_material, 'Shower floor', shower.panArea ?? shower.area, { floor: true, skey: `${shower.id}:floor` });
  if (shower && shower.curbTile) addArea(shower.curb.material || shower.walls_material, 'Shower curb (top and both faces)', shower.curbTile, { skey: `${shower.id}:curb` });
  for (const o of objects.filter(q => q.type === 'niche' && q.back_material && q.zone && q.back_material !== q.zone.material)) {
    addArea(o.back_material, `${o.label} back (wall ${o.W.id})`, o.w * o.h, { skey: `${o.id}:back` });
  }

  const tile = Object.values(lines).map(L => {
    const m = mats[L.id] || {};
    const net = sqft(L.areas.reduce((s, a) => s + a.sqin, 0));
    const waste = num(m.waste_pct, 10);
    const order = net * (1 + waste / 100);
    const unitSf = num(m.unit_sqft, null);
    const units = unitSf ? Math.ceil(order / unitSf - 1e-9) : null;
    const price = num(m.price_per_sqft, null);
    const cost = units != null && price != null ? units * unitSf * price : null;
    const sel = m.selection || null;
    return { id: L.id, m, name: m.name || L.id, net, waste, order, units, unitName: m.unit || 'unit', unitSf, price, cost, areas: L.areas, selection: sel, shortBy: sel && units != null ? units - num(sel.qty, 0) : null };
  }).sort((a, b) => b.net - a.net);

  // paint
  const paintCfg = room.paint || {};
  const pm = mats[paintCfg.material] || {};
  const wallsPaint = walls.reduce((s, W) => s + W.paint, 0);
  const ceilingPaint = paintCfg.ceiling === false ? 0 : floorGross;
  const coats = num(paintCfg.coats, 2);
  const coverage = num(pm.coverage_sqft_per_gal, 350);
  const paintSf = sqft(wallsPaint + ceilingPaint);
  const gallons = (paintSf * coats) / coverage;
  const paint = { material: paintCfg.material, m: pm, wallsSf: sqft(wallsPaint), ceilingSf: sqft(ceilingPaint), totalSf: paintSf, coats, coverage, gallons, buyGallons: paintSf > 0 ? Math.max(1, Math.ceil(gallons - 1e-9)) : 0, byWall: walls.map(W => ({ wall: W.id, sf: sqft(W.paint) })) };

  // exposed tile edges -> edge trim
  const trimEdges = [];
  for (const W of walls) for (const z of W.zones) {
    const abuts = (x) => W.zones.some(o => o !== z && Math.abs((x === z.x0 ? o.x1 : o.x0) - x) < EPS && Math.min(o.y1, z.y1) - Math.max(o.y0, z.y0) > EPS);
    if (z.y1 < W.height - EPS) trimEdges.push({ wall: W.id, zone: z, kind: 'top', x0: z.x0, x1: z.x1, y0: z.y1, y1: z.y1, len: z.x1 - z.x0 });
    const leftExposed = (z.x0 > EPS && !abuts(z.x0)) || (z.x0 <= EPS && W.prev && W.prev.turn === 'L');
    const rightExposed = (z.x1 < W.len - EPS && !abuts(z.x1)) || (z.x1 >= W.len - EPS && W.turn === 'L');
    if (leftExposed) trimEdges.push({ wall: W.id, zone: z, kind: 'side', x0: z.x0, x1: z.x0, y0: z.y0, y1: z.y1, len: z.y1 - z.y0 });
    if (rightExposed) trimEdges.push({ wall: W.id, zone: z, kind: 'side', x0: z.x1, x1: z.x1, y0: z.y0, y1: z.y1, len: z.y1 - z.y0 });
  }
  // soap niches: the opening's four edges take trim
  for (const W of walls) for (const o of W.objects.filter(q => q.type === 'niche')) {
    if (!W.zones.some(z => rectOverlap({ x0: o.x, x1: o.x + o.w, y0: o.y, y1: o.y + o.h }, z) > 0)) continue;
    trimEdges.push({ wall: W.id, zone: { label: o.label }, kind: 'niche', x0: o.x, x1: o.x + o.w, y0: o.y, y1: o.y + o.h, len: 2 * (o.w + o.h), niche: o.id });
  }
  const trimIn = trimEdges.reduce((s, e) => s + e.len, 0);
  const trim = { edges: trimEdges, lf: trimIn / 12, horizontalLf: trimEdges.filter(e => e.kind === 'top').reduce((s, e) => s + e.len, 0) / 12, verticalLf: trimEdges.filter(e => e.kind === 'side').reduce((s, e) => s + e.len, 0) / 12, nicheLf: trimEdges.filter(e => e.kind === 'niche').reduce((s, e) => s + e.len, 0) / 12, m: mats[room.edge_trim?.material] || null };

  // measurement status
  const dims = [{ key: 'ceiling', label: 'Ceiling height', conf: room.ceiling_conf || 'assumed' }]
    .concat(walls.map(W => ({ key: 'wall:' + W.id, label: `Wall ${W.id} length`, conf: W.conf })))
    .concat(objects.map(o => ({ key: 'obj:' + o.id, label: `${o.label}${o.W ? ' (wall ' + o.W.id + ')' : ''}`, conf: o.conf })));
  const doneDims = dims.filter(x => x.conf === 'measured' || x.conf === 'documented').length;
  const estDims = dims.filter(x => x.conf === 'estimated').length;
  const conf = worstConf(dims.map(x => x.conf));

  // open items: generated from the data, then the hand-written ones
  const open = [];
  if ((room.ceiling_conf || 'assumed') === 'assumed') open.push({ id: 'auto:ceiling', severity: 'high', auto: true, text: 'Measure the ceiling height', blocks: ['wall tile height', 'paint area'] });
  for (const W of walls) {
    if (W.conf === 'assumed') open.push({ id: 'auto:wall:' + W.id, severity: 'high', auto: true, text: `Measure wall ${W.id} (currently ${fmtIn(W.len)}, assumed)`, blocks: ['floor plan', 'tile quantity', 'paint quantity'] });
    else if (W.conf === 'estimated') open.push({ id: 'auto:wall:' + W.id, severity: 'medium', auto: true, text: `Tape wall ${W.id} (${fmtIn(W.len)} is a rough number)`, blocks: ['tile quantity', 'cut plan'] });
  }
  for (const o of objects) if (o.conf === 'assumed') open.push({ id: 'auto:obj:' + o.id, severity: o.kind === 'fixture' || o.kind === 'opening' ? 'medium' : 'low', auto: true, text: `Locate the ${o.label.toLowerCase()}${o.W ? ' on wall ' + o.W.id : ''} (position assumed)`, blocks: o.kind === 'opening' ? ['tile quantity', 'paint quantity'] : o.type === 'shower' || o.type === 'tub' ? ['tile layout', 'tile quantity'] : ['layout'] });
  for (const t of tile) if (!t.unitSf) open.push({ id: 'auto:mat:' + t.id, severity: 'medium', auto: true, text: `Choose the ${t.name.toLowerCase()} — the piece count waits on a size`, blocks: ['piece count', 'cost'] });
  for (const it of room.open_items || []) open.push({ severity: 'medium', blocks: [], ...it, auto: false });
  const sevRank = { high: 0, medium: 1, low: 2 };
  open.sort((a, b) => (sevRank[a.severity] ?? 3) - (sevRank[b.severity] ?? 3));

  return {
    room, H, walls, wallById, poly, bbox, closed, closure, floorGross, floorNet,
    objects, byId, fixtures, zones, shower, tubs, excluded,
    tile, paint, trim, issues, dims, doneDims, estDims, conf, open,
    wallTileSf: sqft(zones.reduce((s, z) => s + z.net, 0)),
    floorTileSf: tile.filter(t => t.areas.some(a => a.floor)).reduce((s, t) => s + sqft(t.areas.filter(a => a.floor).reduce((q, a) => q + a.sqin, 0)), 0),
    tileCost: tile.reduce((s, t) => (t.cost != null ? s + t.cost : s), 0),
    tileCostComplete: tile.every(t => t.cost != null),
  };
}

// Every tiled surface in a room, with the JSON path that names its material (for the swap menus).
export function surfaces(room) {
  const out = [];
  if (room.floor) out.push({ key: 'floor', skey: 'floor', label: 'Floor', path: 'floor.material', material: room.floor.material });
  (room.objects || []).forEach((o, i) => {
    const name = o.label || TYPES[o.type]?.label || o.type;
    if (o.type === 'shower') {
      out.push({ key: `o${i}w`, skey: `${o.id}:walls`, label: `${name} — walls`, path: `objects.${i}.walls_material`, material: o.walls_material });
      out.push({ key: `o${i}f`, skey: `${o.id}:floor`, label: `${name} — floor`, path: `objects.${i}.floor_material`, material: o.floor_material });
      if (o.curb && !o.curb.none) out.push({ key: `o${i}c`, skey: `${o.id}:curb`, label: `${name} — curb`, path: `objects.${i}.curb.material`, material: o.curb.material || o.walls_material });
    }
    if (o.type === 'tub' && o.surround) out.push({ key: `o${i}s`, skey: `${o.id}:surround`, label: `${name} — surround`, path: `objects.${i}.surround.material`, material: o.surround.material });
    if (o.type === 'niche') {
      const host = (room.objects || []).find(q => q.type === 'shower' && q.wall !== undefined);
      out.push({ key: `o${i}b`, skey: `${o.id}:back`, label: `${name} — back`, path: `objects.${i}.back_material`, material: o.back_material || host?.walls_material || null, niche: true, inherit: !o.back_material });
    }
  });
  (room.zones || []).forEach((z, i) => out.push({ key: `z${i}`, skey: `zone:${i}`, label: z.label || `Tile area ${i + 1}`, path: `zones.${i}.material`, material: z.material }));
  return out;
}

// Validates the raw JSON shape before building. Returns a list of strings.
export function validate(room) {
  const errs = [];
  if (!room || typeof room !== 'object') return ['Not an object.'];
  if (!room.id) errs.push('Missing "id".');
  if (!room.name) errs.push('Missing "name".');
  if (!Array.isArray(room.walls) || room.walls.length < 3) errs.push('"walls" needs at least three walls.');
  const ids = new Set();
  for (const w of room.walls || []) {
    if (!w.id) errs.push('A wall is missing its "id".');
    if (ids.has(w.id)) errs.push(`Wall id "${w.id}" is used twice.`);
    ids.add(w.id);
    if (!(num(w.length_in, 0) > 0)) errs.push(`Wall ${w.id}: "length_in" must be a positive number.`);
  }
  const oids = new Set();
  for (const o of room.objects || []) {
    if (!o.id) errs.push('An object is missing its "id".');
    if (oids.has(o.id)) errs.push(`Object id "${o.id}" is used twice.`);
    oids.add(o.id);
    if (!TYPES[o.type]) errs.push(`Object ${o.id}: unknown type "${o.type}".`);
  }
  return errs;
}

export { pointInPoly, polyArea };
