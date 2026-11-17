// SVG drawings: floor plan, wall elevations, unfolded run. Everything is drawn in inches.
import { fmtIn, add, sub, mul, dot, openingRect, sqft } from './model.js';

const INK = '#2a2723', SOFT = '#8b8478', WALLC = '#33302b', PAPER = '#f6f2ea', BLUE = '#3b7be0', BLACK = '#1f1e1c';
const r = v => Math.round(v * 100) / 100;
const pts = a => a.map(p => `${r(p[0])},${r(p[1])}`).join(' ');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- deterministic randomness for the pebble mosaic ----------
function rng(seed) {
  let a = 0;
  for (const ch of String(seed)) a = (a * 31 + ch.charCodeAt(0)) | 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shade(hex, k) { // k in [-1,1]
  const n = parseInt(hex.slice(1), 16);
  let rr = (n >> 16) & 255, gg = (n >> 8) & 255, bb = n & 255;
  const f = c => Math.max(0, Math.min(255, Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k))));
  return '#' + ((1 << 24) + (f(rr) << 16) + (f(gg) << 8) + f(bb)).toString(16).slice(1);
}
// Pebble stones for one 12″ sheet: a wrapped Voronoi tiling inset by the grout joint, so the
// stones pack tight like the real mosaic. Shared with the 3D texture so both views match.
export function pebbleStones(seed, color, grout = 0.22) {
  const rand = rng(seed), n = 4, cell = 12 / n, sites = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    sites.push([(i + 0.5 + (j % 2 ? 0.5 : 0) + (rand() - 0.5) * 0.62) * cell, (j + 0.5 + (rand() - 0.5) * 0.62) * cell]);
  }
  const all = [];
  for (const s of sites) for (const dx of [-12, 0, 12]) for (const dy of [-12, 0, 12]) all.push([s[0] + dx, s[1] + dy]);
  const tones = [shade(color, 0.14), shade(color, 0.06), shade(color, -0.03), shade(color, -0.1), shade(color, 0.22), shade(color, -0.16)];
  return sites.map(s => {
    let poly = [[s[0] - 7, s[1] - 7], [s[0] + 7, s[1] - 7], [s[0] + 7, s[1] + 7], [s[0] - 7, s[1] + 7]];
    for (const t of all) {
      if (Math.abs(t[0] - s[0]) < 1e-9 && Math.abs(t[1] - s[1]) < 1e-9) continue;
      const nx = t[0] - s[0], ny = t[1] - s[1], len = Math.hypot(nx, ny);
      if (len > 9) continue;
      const c = (t[0] * t[0] + t[1] * t[1] - s[0] * s[0] - s[1] * s[1]) / 2 - (grout / 2) * len;
      poly = clipHalf(poly, nx, ny, c);
      if (poly.length < 3) break;
    }
    return { poly, fill: tones[Math.floor(rand() * tones.length)] };
  }).filter(st => st.poly.length >= 3);
}
function clipHalf(poly, nx, ny, c) { // keep points with nx*x + ny*y <= c
  const out = [], f = p => nx * p[0] + ny * p[1] - c;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], fa = f(a), fb = f(b);
    if (fa <= 0) out.push(a);
    if ((fa <= 0) !== (fb <= 0)) { const t = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}
// Polygon with softened corners, as path commands usable by SVG and canvas.
export function stoneOutline(poly, rad = 0.38) {
  const cmds = [], n = poly.length;
  const toward = (v, a, k) => { const dx = a[0] - v[0], dy = a[1] - v[1], L = Math.hypot(dx, dy) || 1, t = Math.min(rad / L, 0.45); return [v[0] + dx * t, v[1] + dy * t]; };
  for (let i = 0; i < n; i++) {
    const v = poly[i], a = poly[(i - 1 + n) % n], b = poly[(i + 1) % n];
    const p1 = toward(v, a), p2 = toward(v, b);
    cmds.push(i === 0 ? ['M', p1[0], p1[1]] : ['L', p1[0], p1[1]]);
    cmds.push(['Q', v[0], v[1], p2[0], p2[1]]);
  }
  return cmds;
}
function roundedPath(poly) {
  let d = '';
  for (const c of stoneOutline(poly)) d += c[0] === 'Q' ? `Q${r(c[1])},${r(c[2])} ${r(c[3])},${r(c[4])}` : `${c[0]}${r(c[1])},${r(c[2])}`;
  return d + 'Z';
}

// ---------- material fills ----------
export function materialDefs(M, prefix) {
  let s = '';
  for (const [id, m] of Object.entries(M.room.materials || {})) {
    if (m.kind !== 'tile') continue;
    const pid = `${prefix}-${id}`;
    if (m.look === 'pebble') {
      s += `<pattern id="${pid}" patternUnits="userSpaceOnUse" width="12" height="12"><rect width="12" height="12" fill="${m.grout_color || '#ece8e0'}"/>`;
      for (const st of pebbleStones(id, m.color || '#b9b2a6')) for (const dx of [-12, 0, 12]) for (const dy of [-12, 0, 12]) {
        s += `<path d="${roundedPath(st.poly.map(p => [p[0] + dx, p[1] + dy]))}" fill="${st.fill}"/>`;
      }
      s += '</pattern>';
    } else if (m.look === 'linen') {
      const c = m.color || '#d2c9b8';
      s += `<pattern id="${pid}" patternUnits="userSpaceOnUse" width="1.2" height="1.2"><rect width="1.2" height="1.2" fill="${c}"/><path d="M0,0.3H1.2M0,0.9H1.2M0.3,0V1.2M0.9,0V1.2" stroke="${shade(c, -0.1)}" stroke-width="0.12" opacity="0.55"/></pattern>`;
    } else if (/not chosen/i.test(m.status || '')) {
      const c = m.color || '#e6e3dc';
      s += `<pattern id="${pid}" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)"><rect width="4" height="4" fill="${c}"/><path d="M0,0V4" stroke="${shade(c, -0.18)}" stroke-width="0.35"/></pattern>`;
    }
  }
  s += `<pattern id="${prefix}-hatch" patternUnits="userSpaceOnUse" width="3" height="3" patternTransform="rotate(45)"><path d="M0,0V3" stroke="${SOFT}" stroke-width="0.25"/></pattern>`;
  return s;
}
export function fillOf(M, mid, prefix) {
  const m = (M.room.materials || {})[mid];
  if (!m) return '#ddd';
  if (m.look === 'pebble' || m.look === 'linen' || /not chosen/i.test(m.status || '')) return `url(#${prefix}-${mid})`;
  return m.color || '#ddd';
}
const paintColor = M => ((M.room.materials || {})[M.room.paint?.material] || {}).color || '#ece5d4';

// ---------- small svg helpers ----------
function textAlong(x, y, deg, txt, fs, cls = 'dim-t', anchor = 'middle', extra = '') {
  let a = deg;
  if (a > 90.01) a -= 180; if (a < -90.01) a += 180;
  return `<text x="${r(x)}" y="${r(y)}" font-size="${r(fs)}" text-anchor="${anchor}" dominant-baseline="central" class="${cls}" transform="rotate(${r(a)} ${r(x)} ${r(y)})" ${extra}>${esc(txt)}</text>`;
}
function dimLine(a, b, off, normal, fs, label, cls = 'dim') {
  // dimension from a to b, offset by off along normal
  const A = add(a, mul(normal, off)), B = add(b, mul(normal, off));
  const d = sub(B, A), len = Math.hypot(d[0], d[1]);
  if (len < 0.5) return '';
  const u = mul(d, 1 / len), tick = mul(add(u, normal), 1.2);
  const deg = (Math.atan2(u[1], u[0]) * 180) / Math.PI;
  const mid = add(mul(add(A, B), 0.5), mul(normal, fs * 0.75));
  const base = cls.split(' ')[0]; // 'dim c-est' → parts are dim-l, dim-t…; the extra classes stay on the group
  const ext = (p, q) => `<line x1="${r(p[0])}" y1="${r(p[1])}" x2="${r(q[0])}" y2="${r(q[1])}" class="${base}-ext"/>`;
  return `<g class="${cls}">${ext(add(a, mul(normal, 1)), add(A, mul(normal, 1.2)))}${ext(add(b, mul(normal, 1)), add(B, mul(normal, 1.2)))}` +
    `<line x1="${r(A[0])}" y1="${r(A[1])}" x2="${r(B[0])}" y2="${r(B[1])}" class="${base}-l"/>` +
    `<line x1="${r(A[0] - tick[0])}" y1="${r(A[1] - tick[1])}" x2="${r(A[0] + tick[0])}" y2="${r(A[1] + tick[1])}" class="${base}-tk"/>` +
    `<line x1="${r(B[0] - tick[0])}" y1="${r(B[1] - tick[1])}" x2="${r(B[0] + tick[0])}" y2="${r(B[1] + tick[1])}" class="${base}-tk"/>` +
    textAlong(mid[0], mid[1], deg, label, fs, base + '-t') + '</g>';
}
function intersect(p1, d1, p2, d2) {
  const det = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(det) < 1e-9) return p2;
  const a = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / det;
  return add(p1, mul(d1, a));
}
const confCls = c => (c === 'measured' ? 'c-meas' : c === 'documented' ? 'c-doc' : c === 'estimated' ? 'c-est' : 'c-asm');

// ======================= FLOOR PLAN =======================
export function planSVG(M, o) {
  const T = 4.5, pad = o.dims ? 34 : 18, b = M.bbox;
  const fs = Math.max(b.w, b.h) / 32;
  const vb = [b.x0 - pad, b.y0 - pad, b.w + pad * 2, b.h + pad * 2];
  const P = 'pl';
  let s = `<svg xmlns="http://www.w3.org/2000/svg" class="drawing plan" viewBox="${vb.map(r).join(' ')}" preserveAspectRatio="xMidYMid meet"><defs>${materialDefs(M, P)}</defs>`;

  // floor + shower floor
  const fm = M.room.floor?.material;
  const floorSf = sqft(M.floorNet).toFixed(1);
  const ft = texPattern(o, fm, 'pl-tx-floor', 0, 0);
  s += `${ft ? ft.defs : ''}<polygon points="${pts(M.poly)}" fill="${ft ? ft.fill : fm ? fillOf(M, fm, P) : PAPER}" class="floor"><title>Floor · ${esc(((M.room.materials || {})[fm] || {}).name || 'not set')} · ${floorSf} sq ft</title></polygon>`;
  s += `<polygon points="${pts(M.poly)}" class="veil"/>`;

  // fixtures
  for (const f of M.fixtures) s += planFixture(M, f, P, fs, o.sel === f.id, o);

  // walls
  const n = M.walls.length;
  if (M.closed && n >= 3) {
    const outer = M.walls.map((W, i) => {
      const Pv = M.walls[(i - 1 + n) % n];
      return intersect(sub(Pv.start, mul(Pv.normal, T)), Pv.dir, sub(W.start, mul(W.normal, T)), W.dir);
    });
    s += `<path d="M${pts(outer)}Z M${pts(M.poly)}Z" fill-rule="evenodd" class="wallband"/>`;
  } else {
    for (const W of M.walls) s += `<polygon points="${pts([W.start, W.end, sub(W.end, mul(W.normal, T)), sub(W.start, mul(W.normal, T))])}" class="wallband"/>`;
  }
  // assumed walls get a dashed inner line
  for (const W of M.walls) s += `<line x1="${r(W.start[0])}" y1="${r(W.start[1])}" x2="${r(W.end[0])}" y2="${r(W.end[1])}" class="wall-in ${confCls(W.conf)}"><title>Wall ${W.id} · ${fmtIn(W.len)} · ${W.conf}</title></line>`;

  // openings
  for (const W of M.walls) for (const op of W.openings) {
    const q = [op.p0, op.p1, sub(op.p1, mul(W.normal, T)), sub(op.p0, mul(W.normal, T))];
    const reach = 6; // the opening itself, not the door swing, so fixtures near a door stay clickable
    const hit = [sub(op.p0, mul(W.normal, T)), sub(op.p1, mul(W.normal, T)), add(op.p1, mul(W.normal, reach)), add(op.p0, mul(W.normal, reach))];
    s += `<g class="op" data-oid="${esc(op.id)}"><polygon points="${pts(hit)}" class="hit"><title>${esc(op.label)} · ${fmtIn(op.w)} wide · wall ${esc(W.id)} at ${fmtIn(op.x)}</title></polygon>`;
    if (o.sel === op.id) s += `<polygon points="${pts(hit)}" class="selbox"/>`;
    if (op.type === 'door') {
      s += `<polygon points="${pts(q)}" fill="${PAPER}" stroke="none"/>`;
      s += `<line x1="${r(op.p0[0])}" y1="${r(op.p0[1])}" x2="${r(q[3][0])}" y2="${r(q[3][1])}" class="jamb"/><line x1="${r(op.p1[0])}" y1="${r(op.p1[1])}" x2="${r(q[2][0])}" y2="${r(q[2][1])}" class="jamb"/>`;
      const hinge = op.hinge === 'right' ? op.p1 : op.p0, other = op.hinge === 'right' ? op.p0 : op.p1;
      const swing = op.swing === 'out' ? -1 : 1;
      const leafEnd = add(hinge, mul(W.normal, op.w * swing));
      const v1 = sub(leafEnd, hinge), v2 = sub(other, hinge);
      const sweep = v1[0] * v2[1] - v1[1] * v2[0] > 0 ? 1 : 0;
      s += `<line x1="${r(hinge[0])}" y1="${r(hinge[1])}" x2="${r(leafEnd[0])}" y2="${r(leafEnd[1])}" class="door-leaf ${confCls(op.conf)}"/>`;
      s += `<path d="M${r(leafEnd[0])},${r(leafEnd[1])} A${r(op.w)},${r(op.w)} 0 0 ${sweep} ${r(other[0])},${r(other[1])}" class="door-arc"/>`;
    } else if (op.type === 'window') {
      s += `<polygon points="${pts(q)}" class="win-plan"/>`;
      const m0 = sub(op.p0, mul(W.normal, T / 2)), m1 = sub(op.p1, mul(W.normal, T / 2));
      s += `<line x1="${r(m0[0])}" y1="${r(m0[1])}" x2="${r(m1[0])}" y2="${r(m1[1])}" class="win-line"/>`;
    }
    s += '</g>';
  }
  // things mounted on the walls (valve, shower head, mirror, niche…): small marks at the wall face, draggable
  for (const W of M.walls) for (const ob of W.objects) {
    if (ob.kind !== 'flat' && ob.kind !== 'recess') continue;
    s += planWallItem(ob, W, fs, o.sel === ob.id, o);
  }
  // ceiling items
  for (const c of M.objects.filter(q => q.kind === 'ceiling')) {
    s += `<rect x="${r(c.plan[0] - c.w / 2)}" y="${r(c.plan[1] - c.w / 2)}" width="${r(c.w)}" height="${r(c.w)}" class="ceil-item"/><line x1="${r(c.plan[0] - c.w / 2)}" y1="${r(c.plan[1] - c.w / 2)}" x2="${r(c.plan[0] + c.w / 2)}" y2="${r(c.plan[1] + c.w / 2)}" class="ceil-item"/>`;
    if (o.labels) s += `<text x="${r(c.plan[0])}" y="${r(c.plan[1] + c.w / 2 + fs * 0.8)}" font-size="${r(fs * 0.62)}" text-anchor="middle" class="lbl-small">${esc(c.label.toUpperCase())}</text>`;
  }

  // labels
  if (o.labels) {
    for (const W of M.walls) {
      const mid = add(mul(add(W.start, W.end), 0.5), mul(W.normal, fs * 1.25));
      s += `<text x="${r(mid[0])}" y="${r(mid[1])}" font-size="${r(fs * 1.25)}" text-anchor="middle" dominant-baseline="central" class="wall-letter">${esc(W.id)}</text>`;
    }
    for (const W of M.walls) {
      const c = sub(W.start, add(mul(W.normal, T + fs * 0.9), mul(W.dir, fs * 0.9)));
      s += `<text x="${r(c[0])}" y="${r(c[1])}" font-size="${r(fs * 0.62)}" text-anchor="middle" dominant-baseline="central" class="corner">${esc(W.prev.id)}·${esc(W.id)}</text>`;
    }
  }
  // dimensions
  if (o.dims) {
    for (const W of M.walls) {
      s += dimLine(W.start, W.end, -(T + fs * 2.6), W.normal, fs * 0.85, fmtIn(W.len), 'dim ' + confCls(W.conf));
      // chain of openings + fixtures along the wall, second tier
      const marks = new Set([0, W.len]);
      for (const ob of W.objects) if (ob.kind === 'opening' || ob.kind === 'fixture') { marks.add(Math.max(0, ob.x)); marks.add(Math.min(W.len, ob.x + ob.w)); }
      const xs = [...marks].sort((a, c) => a - c);
      if (xs.length > 2) for (let i = 0; i < xs.length - 1; i++) {
        const a = add(W.start, mul(W.dir, xs[i])), c = add(W.start, mul(W.dir, xs[i + 1]));
        s += dimLine(a, c, -(T + fs * 0.9), W.normal, fs * 0.62, fmtIn(xs[i + 1] - xs[i]), 'dim2');
      }
    }
    // fixture depths
    for (const f of M.fixtures) {
      const a = f.p1, c = add(f.p1, mul(f.W.normal, f.depth));
      if (f.depth > 6) s += dimLine(a, c, f.type === 'shower' ? 2.5 : 1.5, f.W.dir, fs * 0.58, fmtIn(f.depth), 'dim2');
    }
  }
  return s + '</svg>';
}

// A tile material laid as a real texture (when the app has prepared one), anchored at ox,oy.
function texPattern(o, mid, pid, ox, oy) {
  const T = mid && o.tex && o.courses !== false ? o.tex[mid] : null;
  if (!T) return null;
  return {
    defs: `<defs><pattern id="${pid}" patternUnits="userSpaceOnUse" width="${r(T.unitW)}" height="${r(T.unitH)}" patternTransform="translate(${r(ox)} ${r(oy)})"><image href="${T.url}" width="${r(T.unitW)}" height="${r(T.unitH)}" preserveAspectRatio="none"/></pattern></defs>`,
    fill: `url(#${pid})`,
  };
}

function planWallItem(ob, W, fs, selected, o) {
  const mtx = `matrix(${r(W.dir[0])} ${r(W.dir[1])} ${r(W.normal[0])} ${r(W.normal[1])} ${r(ob.p0[0])} ${r(ob.p0[1])})`;
  const w = ob.w, cc = confCls(ob.conf);
  const t = `<title>${esc(ob.label)} · wall ${esc(W.id)} at ${fmtIn(ob.x)} · ${fmtIn(ob.y)} up · ${ob.conf}</title>`;
  let g = `<g transform="${mtx}" class="wi ${cc}" data-oid="${esc(ob.id)}"><rect x="-1" y="${ob.type === 'niche' ? -ob.depth : -1}" width="${r(w + 2)}" height="${r(ob.type === 'niche' ? ob.depth + 5 : 6)}" class="hit">${t}</rect>`;
  switch (ob.type) {
    case 'valve': g += `<line x1="${r(w / 2)}" y1="0" x2="${r(w / 2)}" y2="2.6" class="wi-line"/><circle cx="${r(w / 2)}" cy="2.6" r="${r(Math.max(2, w / 2.6))}" class="wi-black"/>`; break;
    case 'showerhead': g += `<line x1="${r(w / 2)}" y1="0" x2="${r(w / 2)}" y2="5" class="wi-line"/><path d="M${r(w / 2 - 2.6)},6.2 L${r(w / 2 + 2.6)},6.2 L${r(w / 2)},4.2 Z" class="wi-black"/>`; break;
    case 'spout': g += `<rect x="0" y="0" width="${r(w)}" height="4.5" rx="1" class="wi-black"/>`; break;
    case 'mirror': g += `<rect x="0" y="0.2" width="${r(w)}" height="1" class="wi-mirror"/>`; break;
    case 'light': g += `<rect x="0" y="0.2" width="${r(w)}" height="2" class="wi-black"/>`; break;
    case 'niche': g += `<rect x="0" y="${r(-ob.depth)}" width="${r(w)}" height="${r(ob.depth)}" class="wi-niche"/>`; break;
    case 'shelf': g += `<rect x="0" y="0" width="${r(w)}" height="${r(ob.depth || 6)}" class="wi-wood"/>`; break;
    case 'towel_bar': g += `<line x1="0" y1="3" x2="${r(w)}" y2="3" class="wi-line"/>`; break;
    default: g += `<rect x="0" y="0" width="${r(w)}" height="1" class="wi-plate"/>`;
  }
  if (selected) g += `<rect x="-1.5" y="${ob.type === 'niche' ? r(-ob.depth - 1.5) : -1.5}" width="${r(w + 3)}" height="${r(ob.type === 'niche' ? ob.depth + 8 : 9)}" class="selbox"/>`;
  return g + '</g>';
}

function planFixture(M, f, P, fs, selected, o = {}) {
  const W = f.W, mtx = `matrix(${r(W.dir[0])} ${r(W.dir[1])} ${r(W.normal[0])} ${r(W.normal[1])} ${r(f.p0[0])} ${r(f.p0[1])})`;
  const w = f.w, d = f.depth, cc = confCls(f.conf);
  let g = `<g transform="${mtx}" class="fx ${cc}" data-oid="${esc(f.id)}"><rect x="0" y="0" width="${r(w)}" height="${r(d)}" class="hit"/>`;
  const title = `<title>${esc(f.label)} · ${fmtIn(w)} × ${fmtIn(d)} · ${f.conf}</title>`;
  if (f.type === 'shower') {
    const loc = q => { const v = sub(q, f.p0); return [dot(v, W.dir), dot(v, W.normal)]; };
    const sf = texPattern(o, f.floor_material, `pl-tx-sh-${esc(f.id)}`, 0, 0);
    g += `${sf ? sf.defs : ''}<rect x="0" y="0" width="${r(w)}" height="${r(d)}" fill="${sf ? sf.fill : f.floor_material ? fillOf(M, f.floor_material, P) : '#e8e4dc'}" class="fx-shower">${title}</rect><rect x="0" y="0" width="${r(w)}" height="${r(d)}" class="veil"/>`;
    const dr = f.drain || {};
    if (dr.type === 'linear') g += `<rect x="${r(num(dr.u_in, w / 2) - 12)}" y="${r(num(dr.v_in, d - 3) - 1)}" width="24" height="2" class="drain"/>`;
    else g += `<circle cx="${r(num(dr.u_in, w / 2))}" cy="${r(num(dr.v_in, d / 2))}" r="2" class="drain"/>`;
    // curb along each open side
    for (const cb of f.curbs || []) {
      const mid = f.curb?.material || f.walls_material, ct = texPattern(o, mid, `pl-tx-curb-${esc(f.id)}-${cb.edge}`, 0, 0);
      g += `${ct ? ct.defs : ''}<polygon points="${pts(cb.poly.map(loc))}" fill="${ct ? ct.fill : fillOf(M, mid, P)}" class="curb"><title>Curb · ${fmtIn(cb.w)} wide × ${fmtIn(cb.h)} tall</title></polygon>`;
    }
    // enclosure on open edges, standing on the curb's centre line
    const ent = f.entry || { type: 'panel', panel_w_in: Math.min(34, w), side: 'start' };
    const inset = f.curbs?.length ? f.curbs[0].w / 2 : 0;
    for (const e of f.open || []) {
      const A = loc(e.a), B = loc(e.b);
      if (ent.type === 'panel' && e.edge === 2) {
        const pw = Math.min(num(ent.panel_w_in, 34), w);
        const u0 = ent.side === 'end' ? w - pw : 0, u1 = u0 + pw;
        g += `<line x1="${r(u0)}" y1="${r(d - inset)}" x2="${r(u1)}" y2="${r(d - inset)}" class="glass"/>`;
      } else if (ent.type === 'panel' || ent.type === 'glass') {
        g += `<line x1="${r(A[0])}" y1="${r(A[1])}" x2="${r(B[0])}" y2="${r(B[1])}" class="glass"/>`;
      } else if (ent.type === 'curtain') {
        g += `<line x1="${r(A[0])}" y1="${r(A[1])}" x2="${r(B[0])}" y2="${r(B[1])}" class="curtain"/>`;
      }
    }
  } else if (f.type === 'tub') {
    const valveSide = sideWithPlumbing(M, f);
    g += `<rect x="0" y="0" width="${r(w)}" height="${r(d)}" class="fx-white">${title}</rect><rect x="3" y="3" width="${r(w - 6)}" height="${r(d - 6)}" rx="7" class="fx-inner"/>`;
    g += `<circle cx="${r(valveSide === 'start' ? 7 : w - 7)}" cy="${r(d / 2)}" r="1.3" class="drain"/>`;
  } else if (f.type === 'toilet') {
    const cx = w / 2, tw = Math.min(19, w - 1);
    g += `<rect x="${r(cx - tw / 2)}" y="0.6" width="${r(tw)}" height="8" rx="1.5" class="fx-white">${title}</rect>`;
    g += `<ellipse cx="${r(cx)}" cy="${r(8.6 + (d - 8.6) / 2)}" rx="${r(Math.min(7.4, w / 2 - 1))}" ry="${r((d - 8.6) / 2)}" class="fx-white"/>`;
    g += `<ellipse cx="${r(cx)}" cy="${r(8.6 + (d - 8.6) / 2 + 0.8)}" rx="${r(Math.min(5.2, w / 2 - 3))}" ry="${r((d - 8.6) / 2 - 2.6)}" class="fx-inner"/>`;
  } else if (f.type === 'vanity') {
    g += `<rect x="0" y="0" width="${r(w)}" height="${r(d)}" class="fx-vanity">${title}</rect><rect x="0" y="0" width="${r(w)}" height="${r(d)}" fill="url(#${P}-hatch)" opacity="0.6"/>`;
    g += `<rect x="${r(w / 2 - Math.min(9, w * 0.3))}" y="${r(d / 2 - 6)}" width="${r(Math.min(18, w * 0.6))}" height="12" rx="4" class="fx-white"/>`;
    g += `<circle cx="${r(w / 2)}" cy="2.6" r="0.9" class="tap"/>`;
  } else {
    g += `<rect x="0" y="0" width="${r(w)}" height="${r(d)}" class="fx-white">${title}</rect>`;
  }
  if (selected) g += `<rect x="-1" y="-1" width="${r(w + 2)}" height="${r(d + 2)}" class="selbox"/>`;
  g += '</g>';
  // label in plan coords so it reads upright
  const c = add(add(f.p0, mul(W.dir, w / 2)), mul(W.normal, f.type === 'shower' ? d * 0.27 : d / 2));
  const deg = (Math.atan2(W.dir[1], W.dir[0]) * 180) / Math.PI;
  const lab = f.type === 'shower' ? f.label.toUpperCase() : f.type === 'toilet' ? 'WC' : f.label.toUpperCase();
  g += `<g class="fx-label">${textAlong(c[0], f.type === 'toilet' ? c[1] : c[1], deg, lab, fs * (f.type === 'shower' ? 0.75 : 0.6), 'lbl-small' + (f.conf === 'assumed' ? ' asm' : ''))}</g>`;
  return g;
}
const num = (v, dflt) => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);
function sideWithPlumbing(M, f) {
  const plumb = M.objects.filter(o => ['valve', 'spout', 'showerhead'].includes(o.type));
  for (const ct of f.on || []) {
    if (ct.edge === 3 && plumb.some(p => p.W && p.W.id === ct.wall)) return 'start';
    if (ct.edge === 1 && plumb.some(p => p.W && p.W.id === ct.wall)) return 'end';
  }
  return 'start';
}

// ======================= ELEVATIONS =======================
// Draws one wall with its left edge at ox; floor at y = Hmax, ceiling at Hmax - wall height.
export function wallGroup(M, W, o, ox, Hmax, P, fs) {
  const H = W.height, Y = v => Hmax - v, X = u => ox + u;
  let s = `<g class="wall-elev" data-wall="${esc(W.id)}">`;
  s += `<rect x="${r(X(0))}" y="${r(Y(H))}" width="${r(W.len)}" height="${r(H)}" fill="${paintColor(M)}" class="paint-field"><title>Wall ${esc(W.id)} · paint ${sqft(W.paint).toFixed(1)} sq ft</title></rect>`;

  // tile zones
  W.zones.forEach((z, zi) => {
    const m = (M.room.materials || {})[z.material] || {};
    const tp = texPattern(o, z.material, `${P}-tx-${esc(W.id)}-${zi}-${Math.round(ox)}`, X(z.x0), Y(z.y0));
    s += `${tp ? tp.defs : ''}<rect x="${r(X(z.x0))}" y="${r(Y(z.y1))}" width="${r(z.x1 - z.x0)}" height="${r(z.y1 - z.y0)}" fill="${tp ? tp.fill : o.courses === false ? (m.color || '#ddd') : fillOf(M, z.material, P)}" class="zone"><title>${esc(m.name || z.material)} · wall ${esc(W.id)} · ${sqft(z.net).toFixed(1)} sq ft</title></rect>`;
    if (!tp && o.courses && m.tile_w_in && m.tile_h_in) s += courses(z, m, X, Y);
    if (o.labels) {
      const lfs = fs * 0.62, room = z.x1 - z.x0 - fs;
      let name = (m.name || z.material).toUpperCase();
      while (name.length * lfs * 0.62 > room && name.includes(' ')) name = name.slice(0, name.lastIndexOf(' '));
      if (name.length * lfs * 0.62 <= room) s += `<text x="${r(X(z.x0) + fs * 0.5)}" y="${r(Y(z.y1) + fs * 1.0)}" font-size="${r(lfs)}" class="zone-lbl">${esc(name)}</text>`;
    }
  });

  // shower curbs where they meet this wall
  for (const f of M.fixtures) for (const cw of f.curbOnWalls || []) {
    if (cw.wall !== W.id) continue;
    const mid = f.curb?.material || f.walls_material, tp = texPattern(o, mid, `${P}-tx-curb-${esc(W.id)}-${Math.round(cw.x0)}-${Math.round(ox)}`, X(cw.x0), Y(0));
    s += `${tp ? tp.defs : ''}<rect x="${r(X(cw.x0))}" y="${r(Y(cw.h))}" width="${r(cw.x1 - cw.x0)}" height="${r(cw.h)}" fill="${tp ? tp.fill : fillOf(M, mid, P)}" class="curb-el"><title>Curb · ${fmtIn(cw.x1 - cw.x0)} wide × ${fmtIn(cw.h)} tall</title></rect>`;
  }

  // fixtures that meet this wall (the wall a fixture backs onto can slide it sideways)
  for (const ct of W.contacts) {
    const body = elevFixture(M, ct, X, Y, fs, o), f = ct.obj;
    if (ct.edge !== 0 || f.type === 'shower') { s += body; continue; }
    const hh = Math.max(f.h, 6);
    s += `<g class="drag" data-oid="${esc(f.id)}"><rect x="${r(X(ct.x0))}" y="${r(Y(hh))}" width="${r(ct.x1 - ct.x0)}" height="${r(hh)}" class="hit"/>${body}` +
      (o.sel === f.id ? `<rect x="${r(X(ct.x0) - 1)}" y="${r(Y(hh) - 1)}" width="${r(ct.x1 - ct.x0 + 2)}" height="${r(hh + 2)}" class="selbox"/>` : '') + '</g>';
  }

  // flat objects and openings: doors and windows first, so smaller items on top get the click
  const flat = W.objects.filter(q => q.kind !== 'fixture').sort((a, b) => (b.kind === 'opening') - (a.kind === 'opening'));
  for (const ob of flat) {
    const c = ob.type === 'door' ? num(ob.casing_in, 2.5) : 0;
    const bx = { x: X(ob.x - c), y: Y(ob.y + ob.h + c), w: ob.w + 2 * c, h: ob.h + c };
    s += `<g class="drag" data-oid="${esc(ob.id)}"><rect x="${r(bx.x - 1.5)}" y="${r(bx.y - 1.5)}" width="${r(bx.w + 3)}" height="${r(bx.h + 3)}" class="hit"/>${elevObject(ob, X, Y, fs, o)}` +
      (o.sel === ob.id ? `<rect x="${r(bx.x - 1)}" y="${r(bx.y - 1)}" width="${r(bx.w + 2)}" height="${r(bx.h + 2)}" class="selbox"/>` : '') + '</g>';
  }

  // edge trim
  if (o.trim) for (const e of M.trim.edges.filter(q => q.wall === W.id)) {
    s += e.kind === 'niche'
      ? `<rect x="${r(X(e.x0))}" y="${r(Y(e.y1))}" width="${r(e.x1 - e.x0)}" height="${r(e.y1 - e.y0)}" class="edge-trim" fill="none"><title>Niche trim · ${fmtIn(e.len)}</title></rect>`
      : `<line x1="${r(X(e.x0))}" y1="${r(Y(e.y0))}" x2="${r(X(e.x1))}" y2="${r(Y(e.y1))}" class="edge-trim"><title>Edge trim · ${fmtIn(e.len)}</title></line>`;
  }

  s += `<rect x="${r(X(0))}" y="${r(Y(H))}" width="${r(W.len)}" height="${r(H)}" class="wall-outline ${confCls(W.conf)}"/>`;
  s += `<line x1="${r(X(-3))}" y1="${r(Y(0))}" x2="${r(X(W.len + 3))}" y2="${r(Y(0))}" class="floor-line"/>`;

  if (o.dims) {
    s += dimLine([X(0), Y(0)], [X(W.len), Y(0)], fs * 2.3, [0, 1], fs * 0.8, fmtIn(W.len), 'dim ' + confCls(W.conf));
    s += dimLine([X(0), Y(0)], [X(0), Y(H)], fs * 2.2, [-1, 0], fs * 0.75, fmtIn(H), 'dim');
    const tops = [...new Set(W.zones.map(z => r(z.y1)))].filter(v => v < H - 0.25);
    tops.forEach((t, i) => { s += dimLine([X(W.len), Y(0)], [X(W.len), Y(t)], fs * (1.4 + i * 1.6), [1, 0], fs * 0.62, fmtIn(t), 'dim2'); });
    const marks = new Set([0, W.len]);
    for (const ob of W.openings) { marks.add(Math.max(0, Math.min(W.len, ob.x))); marks.add(Math.max(0, Math.min(W.len, ob.x + ob.w))); }
    for (const ct of W.contacts) { marks.add(ct.x0); marks.add(ct.x1); }
    const xs = [...marks].map(v => r(v)).sort((a, c) => a - c).filter((v, i, a) => i === 0 || v - a[i - 1] > 0.2);
    if (xs.length > 2) for (let i = 0; i < xs.length - 1; i++) s += dimLine([X(xs[i]), Y(0)], [X(xs[i + 1]), Y(0)], fs * 0.85, [0, 1], fs * 0.55, fmtIn(xs[i + 1] - xs[i]), 'dim2');
    // toilet centerline, and its distance to the nearest wall or fixture on each side
    for (const ct of W.contacts) {
      const t = ct.obj;
      if (t.type !== 'toilet' || ct.edge !== 0 || !t.clear) continue;
      const { cx, left, right } = t.clear, top = t.h + 6 + fs * 1.1;
      s += `<g class="cl-mark"><line x1="${r(X(cx))}" y1="${r(Y(-2))}" x2="${r(X(cx))}" y2="${r(Y(top))}" class="cl-line"/>` +
        `<text x="${r(X(cx))}" y="${r(Y(top) - fs * 0.6)}" font-size="${r(fs * 0.95)}" text-anchor="middle" class="cl-sym">℄</text></g>`;
      for (const sd of [left, right]) {
        if (!sd || sd.d < 0.1) continue;
        const u0 = sd === left ? sd.u : cx, u1 = sd === left ? cx : sd.u;
        s += dimLine([X(u0), Y(t.h)], [X(u1), Y(t.h)], 6, [0, -1], fs * 0.62, fmtIn(sd.d), 'dim cl-dim ' + confCls(sd.conf));
      }
    }
  }
  return s + '</g>';
}

function courses(z, m, X, Y) {
  const horiz = (m.orientation || 'horizontal') === 'horizontal';
  const tw = horiz ? Math.max(m.tile_w_in, m.tile_h_in) : Math.min(m.tile_w_in, m.tile_h_in);
  const th = horiz ? Math.min(m.tile_w_in, m.tile_h_in) : Math.max(m.tile_w_in, m.tile_h_in);
  const g = num(m.grout_in, 0.125);
  const shift = m.pattern === 'offset' ? 0.5 : m.pattern === 'third' ? 1 / 3 : 0;
  let s = `<g class="courses" clip-path="none">`;
  let row = 0;
  for (let y = z.y0 + th; y < z.y1 - 0.01; y += th + g, row++) s += `<line x1="${r(X(z.x0))}" y1="${r(Y(y))}" x2="${r(X(z.x1))}" y2="${r(Y(y))}"/>`;
  row = 0;
  for (let y0 = z.y0; y0 < z.y1 - 0.01; y0 += th + g, row++) {
    const y1 = Math.min(z.y1, y0 + th);
    const off = ((row * shift) % 1) * (tw + g);
    for (let x = z.x0 + tw - off; x < z.x1 - 0.01; x += tw + g) if (x > z.x0 + 0.01) s += `<line x1="${r(X(x))}" y1="${r(Y(y0))}" x2="${r(X(x))}" y2="${r(Y(y1))}"/>`;
  }
  return s + '</g>';
}

function elevFixture(M, ct, X, Y, fs, o) {
  const f = ct.obj, front = ct.edge === 0 || ct.edge === 2, x0 = ct.x0, x1 = ct.x1, w = x1 - x0;
  const lab = o.labels ? `<text x="${r(X((x0 + x1) / 2))}" y="${r(Y(Math.max(f.h, 6) / 2))}" font-size="${r(fs * 0.55)}" text-anchor="middle" dominant-baseline="central" class="lbl-small">${esc((f.type === 'shower' ? '' : f.label).toUpperCase())}</text>` : '';
  const t = `<title>${esc(f.label)} · ${fmtIn(f.w)} × ${fmtIn(f.depth)} · ${f.conf}</title>`;
  if (f.type === 'tub') {
    return `<g class="${confCls(f.conf)}"><rect x="${r(X(x0))}" y="${r(Y(f.h))}" width="${r(w)}" height="${r(f.h)}" class="el-white">${t}</rect><line x1="${r(X(x0))}" y1="${r(Y(f.h - 1.6))}" x2="${r(X(x1))}" y2="${r(Y(f.h - 1.6))}" class="el-fine"/>${lab}</g>`;
  }
  if (f.type === 'toilet' && ct.edge === 0) {
    const cx = (x0 + x1) / 2, tw = Math.min(19, w - 1);
    let s = `<g class="${confCls(f.conf)}">`;
    s += `<rect x="${r(X(cx - tw / 2))}" y="${r(Y(f.h))}" width="${r(tw)}" height="${r(f.h - 16)}" rx="1.2" class="el-white">${t}</rect>`;
    s += `<rect x="${r(X(cx - tw / 2 - 0.5))}" y="${r(Y(f.h + 0.8))}" width="${r(tw + 1)}" height="1.6" rx="0.6" class="el-white"/>`;
    s += `<path d="M${r(X(cx - 8))},${r(Y(16))} L${r(X(cx + 8))},${r(Y(16))} L${r(X(cx + 4.8))},${r(Y(0))} L${r(X(cx - 4.8))},${r(Y(0))} Z" class="el-white"/>`;
    s += `<rect x="${r(X(cx - 8.6))}" y="${r(Y(17))}" width="17.2" height="1.4" rx="0.7" class="el-white"/>`;
    s += `<rect x="${r(X(cx + tw / 2 - 4))}" y="${r(Y(f.h - 2.5))}" width="3" height="0.9" class="el-black"/>`;
    return s + lab + '</g>';
  }
  if (f.type === 'vanity') {
    const top = 1.5, kick = 3.5;
    let s = `<g class="${confCls(f.conf)}">`;
    s += `<rect x="${r(X(x0))}" y="${r(Y(f.h - top))}" width="${r(w)}" height="${r(f.h - top - kick)}" class="el-cab ${f.style === 'walnut' ? 'walnut' : ''}">${t}</rect>`;
    s += `<rect x="${r(X(x0 + 1.5))}" y="${r(Y(kick))}" width="${r(w - 3)}" height="${r(kick)}" class="el-kick"/>`;
    s += `<rect x="${r(X(x0 - (front ? 0.5 : 0)))}" y="${r(Y(f.h))}" width="${r(w + (front ? 1 : 0))}" height="${top}" class="el-top"/>`;
    if (front) {
      const doors = w >= 36 ? 2 : 1;
      const ih = f.h - top - kick;
      s += `<line x1="${r(X(x0 + 1))}" y1="${r(Y(kick + ih - 6))}" x2="${r(X(x1 - 1))}" y2="${r(Y(kick + ih - 6))}" class="el-fine"/>`;
      for (let i = 1; i < doors; i++) s += `<line x1="${r(X(x0 + (w * i) / doors))}" y1="${r(Y(kick + ih - 6))}" x2="${r(X(x0 + (w * i) / doors))}" y2="${r(Y(kick + 1))}" class="el-fine"/>`;
      s += `<rect x="${r(X((x0 + x1) / 2 - 3))}" y="${r(Y(kick + ih - 2.6))}" width="6" height="0.8" class="el-black"/>`;
      s += `<rect x="${r(X((x0 + x1) / 2 - 0.6))}" y="${r(Y(f.h + 7))}" width="1.2" height="7" class="el-black"/><rect x="${r(X((x0 + x1) / 2 - 0.6))}" y="${r(Y(f.h + 7))}" width="4.2" height="1" class="el-black"/>`;
    }
    return s + lab + '</g>';
  }
  if (f.type === 'shower') return '';
  return `<rect x="${r(X(x0))}" y="${r(Y(Math.max(f.h, 1)))}" width="${r(w)}" height="${r(Math.max(f.h, 1))}" class="el-white ${confCls(f.conf)}">${t}</rect>${lab}`;
}

function elevObject(ob, X, Y, fs, o) {
  const x0 = ob.x, x1 = ob.x + ob.w, y0 = ob.y, y1 = ob.y + ob.h, cc = confCls(ob.conf);
  const t = `<title>${esc(ob.label)} · ${fmtIn(ob.w)} × ${fmtIn(ob.h)} at ${fmtIn(ob.x)} from the left, ${fmtIn(ob.y)} up · ${ob.conf}</title>`;
  const lab = (txt, yy) => (o.labels ? `<text x="${r(X((x0 + x1) / 2))}" y="${r(yy)}" font-size="${r(fs * 0.55)}" text-anchor="middle" dominant-baseline="central" class="lbl-small">${esc(txt.toUpperCase())}</text>` : '');
  let s = `<g class="${cc}">`;
  switch (ob.type) {
    case 'door': {
      const c = num(ob.casing_in, 2.5);
      s += `<rect x="${r(X(x0 - c))}" y="${r(Y(y1 + c))}" width="${r(ob.w + 2 * c)}" height="${r(ob.h + c)}" class="el-casing">${t}</rect>`;
      s += `<rect x="${r(X(x0))}" y="${r(Y(y1))}" width="${r(ob.w)}" height="${r(ob.h)}" class="el-door"/>`;
      s += `<circle cx="${r(X(ob.hinge === 'right' ? x0 + 2.6 : x1 - 2.6))}" cy="${r(Y(36))}" r="1.1" class="el-black"/>`;
      s += lab(ob.label, Y((y0 + y1) / 2));
      break;
    }
    case 'window':
      s += `<rect x="${r(X(x0))}" y="${r(Y(y1))}" width="${r(ob.w)}" height="${r(ob.h)}" class="el-win">${t}</rect>`;
      s += `<path d="M${r(X(x0))},${r(Y(y1))}L${r(X(x1))},${r(Y(y0))}M${r(X(x1))},${r(Y(y1))}L${r(X(x0))},${r(Y(y0))}" class="el-win-x"/>`;
      s += lab(ob.label, Y((y0 + y1) / 2));
      break;
    case 'mirror':
      s += `<rect x="${r(X(x0))}" y="${r(Y(y1))}" width="${r(ob.w)}" height="${r(ob.h)}" class="el-mirror">${t}</rect><path d="M${r(X(x0 + ob.w * 0.18))},${r(Y(y1 - ob.h * 0.25))} l${r(ob.w * 0.18)},${r(-ob.h * 0.12)} M${r(X(x0 + ob.w * 0.18))},${r(Y(y1 - ob.h * 0.42))} l${r(ob.w * 0.3)},${r(-ob.h * 0.2)}" class="el-glint"/>`;
      s += lab(ob.label, Y(y0 + ob.h * 0.5));
      break;
    case 'light':
      s += `<rect x="${r(X(x0))}" y="${r(Y(y1))}" width="${r(ob.w)}" height="${r(ob.h)}" rx="1" class="el-black">${t}</rect>`;
      for (let i = 0; i < 3; i++) s += `<circle cx="${r(X(x0 + (ob.w * (i + 0.5)) / 3))}" cy="${r(Y(y0 - 1.6))}" r="1.6" class="el-bulb"/>`;
      break;
    case 'valve':
      s += `<circle cx="${r(X((x0 + x1) / 2))}" cy="${r(Y((y0 + y1) / 2))}" r="${r(ob.w / 2)}" class="el-black">${t}</circle><line x1="${r(X((x0 + x1) / 2))}" y1="${r(Y((y0 + y1) / 2))}" x2="${r(X((x0 + x1) / 2 + ob.w * 0.6))}" y2="${r(Y((y0 + y1) / 2 + 1.5))}" class="el-handle"/>`;
      s += lab(ob.label, Y(y0 - 3));
      break;
    case 'showerhead': {
      const cx = X((x0 + x1) / 2);
      s += `<line x1="${r(cx)}" y1="${r(Y(y1 + 4))}" x2="${r(cx)}" y2="${r(Y(y1))}" class="el-handle"/><rect x="${r(X(x0))}" y="${r(Y(y1))}" width="${r(ob.w)}" height="1.6" rx="0.6" class="el-black">${t}</rect>`;
      break;
    }
    case 'spout':
      s += `<rect x="${r(X(x0))}" y="${r(Y(y1))}" width="${r(ob.w)}" height="${r(ob.h)}" rx="0.8" class="el-black">${t}</rect>`;
      break;
    case 'niche': {
      const tp = ob.back_material ? texPattern(o, ob.back_material, `nb-${esc(ob.id)}-${Math.round(X(0))}`, X(x0), Y(y0)) : null;
      if (tp) s += `${tp.defs}<rect x="${r(X(x0))}" y="${r(Y(y1))}" width="${r(ob.w)}" height="${r(ob.h)}" fill="${tp.fill}"/>`;
      s += `<rect x="${r(X(x0))}" y="${r(Y(y1))}" width="${r(ob.w)}" height="${r(ob.h)}" class="el-niche">${t}</rect>`;
      s += lab(ob.label, Y((y0 + y1) / 2));
      break;
    }
    case 'shelf':
    case 'towel_bar':
      s += `<rect x="${r(X(x0))}" y="${r(Y(y1))}" width="${r(ob.w)}" height="${r(Math.max(ob.h, 1))}" class="${ob.type === 'shelf' ? 'el-wood' : 'el-black'}">${t}</rect>`;
      break;
    default:
      s += `<rect x="${r(X(x0))}" y="${r(Y(y1))}" width="${r(ob.w)}" height="${r(ob.h)}" class="el-plate">${t}</rect>`;
  }
  return s + '</g>';
}

export function elevationSVG(M, W, o) {
  const fs = Math.max(W.len, W.height) / 30, padX = o.dims ? fs * 5 : fs * 2, padTop = fs * 2, padBot = o.dims ? fs * 6.5 : fs * 3.5;
  const P = 'el';
  let s = `<svg xmlns="http://www.w3.org/2000/svg" class="drawing elev" viewBox="${r(-padX)} ${r(-padTop)} ${r(W.len + padX * 2)} ${r(W.height + padTop + padBot)}" preserveAspectRatio="xMidYMid meet"><defs>${materialDefs(M, P)}</defs>`;
  s += wallGroup(M, W, o, 0, W.height, P, fs);
  s += `<text x="0" y="${r(W.height + padBot - fs * 0.9)}" font-size="${r(fs * 0.62)}" class="corner">x=0 · wall ${esc(W.prev.id)} corner</text>`;
  s += `<text x="${r(W.len)}" y="${r(W.height + padBot - fs * 0.9)}" font-size="${r(fs * 0.62)}" text-anchor="end" class="corner">wall ${esc(W.next.id)} corner</text>`;
  return s + '</svg>';
}

export function unfoldedSVG(M, o) {
  const gap = 14, Hmax = Math.max(...M.walls.map(W => W.height));
  const total = M.walls.reduce((s2, W) => s2 + W.len, 0) + gap * (M.walls.length - 1);
  const fs = Math.max(total / 70, Hmax / 28);
  const padX = fs * 3, padTop = fs * 3.2, padBot = o.dims ? fs * 6 : fs * 2.5;
  const P = 'un';
  let s = `<svg xmlns="http://www.w3.org/2000/svg" class="drawing unfolded" viewBox="${r(-padX)} ${r(-padTop)} ${r(total + padX * 2)} ${r(Hmax + padTop + padBot)}" preserveAspectRatio="xMidYMid meet"><defs>${materialDefs(M, P)}</defs>`;
  let ox = 0;
  for (const W of M.walls) {
    s += wallGroup(M, W, { ...o, dims: o.dims }, ox, Hmax, P, fs);
    s += `<text x="${r(ox + W.len / 2)}" y="${r(-fs * 1.1)}" font-size="${r(fs * 1.25)}" text-anchor="middle" class="wall-letter">${esc(W.id)}</text>`;
    if (W !== M.walls[M.walls.length - 1]) s += `<line x1="${r(ox + W.len + gap / 2)}" y1="${r(-fs * 0.4)}" x2="${r(ox + W.len + gap / 2)}" y2="${r(Hmax + fs * 0.4)}" class="fold"/><text x="${r(ox + W.len + gap / 2)}" y="${r(Hmax + fs * 1.3)}" font-size="${r(fs * 0.55)}" text-anchor="middle" class="corner">${esc(W.id)}·${esc(W.next.id)}</text>`;
    ox += W.len + gap;
  }
  return s + '</svg>';
}
