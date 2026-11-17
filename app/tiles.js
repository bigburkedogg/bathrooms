// What each tile looks like, laid out at real size: tile faces, grout, orientation, pattern.
// One repeat unit per material, drawn on a canvas; the 3D view uses the canvas as a texture
// (plus a bump map for the grout recess), the drawings use it as an SVG pattern.

const imgs = new Map();
function loadImg(src) {
  if (!imgs.has(src)) imgs.set(src, new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }));
  return imgs.get(src);
}
const units = new Map(); // key -> unit

function rng(seed) {
  let a = 0;
  for (const ch of String(seed)) a = (a * 31 + ch.charCodeAt(0)) | 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hexRgb(h) { const n = parseInt((h || '#cccccc').slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
const css = (rgb, k = 1) => `rgb(${rgb.map(c => Math.max(0, Math.min(255, Math.round(c * k)))).join(',')})`;
function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }

// Installed tile size: "vertical" puts the long side up the wall (or along the room on a floor).
export function laidSize(m) {
  const a = m.tile_w_in || 12, b = m.tile_h_in || 12, lo = Math.min(a, b), hi = Math.max(a, b);
  return (m.orientation || 'horizontal') === 'vertical' ? [lo, hi] : [hi, lo];
}

export async function prepare(materials) {
  const srcs = [];
  for (const m of Object.values(materials || {})) for (const k of ['face_img', 'sheet_img', 'bump_img', 'photo']) if (m[k]) srcs.push(m[k]);
  await Promise.all(srcs.map(loadImg));
}

// ---------- surfaces from the product photo ----------
// Finds clean squares of tile surface in the product photo (no grout line or background inside), taken
// from different tiles across the photo. Painting each tile with one of them gives the photo's own
// colours, pixel for pixel, and its tile-to-tile variation.
const analyses = new Map();
function analyzePhoto(img) {
  if (analyses.has(img.src)) return analyses.get(img.src);
  const k = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
  const W = Math.max(8, Math.round(img.naturalWidth * k)), H = Math.max(8, Math.round(img.naturalHeight * k));
  const c = mkCanvas(W, H), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, W, H);
  const d = x.getImageData(0, 0, W, H).data;
  const lum = i => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  // how even the centre is (a swatch of one colour reads as even; a room shot doesn't)
  const centre = [];
  for (let yy = Math.round(H * 0.3); yy < H * 0.7; yy += 3) for (let xx = Math.round(W * 0.3); xx < W * 0.7; xx += 3) centre.push(lum((yy * W + xx) * 4));
  centre.sort((a, b) => a - b);
  const cm = centre[centre.length >> 1], even = centre.filter(v => Math.abs(v - cm) <= 22).length / centre.length >= 0.7;
  let picks = [];
  for (const f of [0.22, 0.15, 0.1, 0.07, 0.05]) {
    const s = Math.max(8, Math.round(Math.min(W, H) * f)), step = Math.max(3, Math.round(s / 2)), cands = [];
    for (let py = Math.round(H * 0.08); py + s <= H * 0.92; py += step) for (let px = Math.round(W * 0.08); px + s <= W * 0.92; px += step) {
      const vals = []; let n = 0, white = 0;
      for (let yy = py; yy < py + s; yy += 2) for (let xx = px; xx < px + s; xx += 2) {
        const i = (yy * W + xx) * 4; vals.push(lum(i)); n++;
        if (d[i] > 238 && d[i + 1] > 238 && d[i + 2] > 238) white++;
      }
      vals.sort((a, b) => a - b);
      const med = vals[vals.length >> 1], far = vals.filter(v => Math.abs(v - med) > 32).length / vals.length;
      if (far >= 0.07 || white / n >= 0.15) continue;
      // a grout line or tile edge shows as a sharp jump in brightness; texture inside a tile doesn't
      let sharp = 0, tot = 0;
      for (let yy = py; yy < py + s - 2; yy += 2) for (let xx = px; xx < px + s - 2; xx += 2) {
        const i = (yy * W + xx) * 4, v = lum(i);
        if (Math.abs(v - lum(i + 8)) > 40 || Math.abs(v - lum(i + W * 8)) > 40) sharp++;
        tot++;
      }
      if (sharp / tot < 0.002) cands.push({ x: px, y: py, s, far });
    }
    cands.sort((a, b) => a.far - b.far);
    const got = [];
    for (const cd of cands) {
      if (got.every(p => Math.abs(p.x - cd.x) >= s || Math.abs(p.y - cd.y) >= s)) got.push(cd);
      if (got.length >= 14) break;
    }
    if (got.length >= 4) { picks = got; break; }
  }
  const coverage = picks.length ? (picks.length * picks[0].s * picks[0].s) / (W * H * 0.7) : 0;
  const res = { canvas: c, patches: picks, even, coverage };
  analyses.set(img.src, res);
  return res;
}
const VARIEGATED = /zellige|hand-?made|cotto|terra ?cotta|saltillo|variegat|marble|stone|concrete|travertine|slate|multi|blend|crackle|artisan|encaustic|terrazzo|weathered|rustic|wood/i;
// The photo paints the tile when it's a clean swatch, or when the tile is the kind that varies and the
// photo is mostly tile surface. face_from_photo: true / false overrides (the colour box sets false).
function photoSurface(m) {
  if (!m.photo || m.face_from_photo === false || ['photo', 'sheet'].includes(m.look)) return null;
  const img = imgs.get(m.photo)?.__v;
  if (!img) return null;
  const an = analyzePhoto(img);
  if (an.patches.length < 4) return null;
  if (m.face_from_photo === true || an.even || (VARIEGATED.test(m.name || '') && an.coverage >= 0.2)) return an;
  return null;
}
function paintFromPhoto(ctx, an, x, y, w, h, rand) {
  const p = an.patches[Math.floor(rand() * an.patches.length)];
  const ratio = Math.max(w, h) / Math.min(w, h), reps = ratio > 2.2 ? Math.round(ratio) : 1; // long tiles: repeat the square, mirrored
  ctx.save();
  for (let i = 0; i < reps; i++) {
    const along = (i / reps), seg = 1 / reps;
    const sx = w >= h ? x + along * w : x, sy = w >= h ? y : y + along * h, sw = w >= h ? w * seg : w, sh = w >= h ? h : h * seg;
    ctx.save();
    const flip = (i + (rand() < 0.5 ? 1 : 0)) % 2 === 1;
    ctx.translate(sx + sw / 2, sy + sh / 2); if (flip) ctx.scale(-1, 1); if (rand() < 0.5) ctx.scale(1, -1);
    ctx.drawImage(an.canvas, p.x, p.y, p.s, p.s, -sw / 2, -sh / 2, sw, sh);
    ctx.restore();
  }
  ctx.restore();
}

// ---------- tile faces ----------
function drawFace(ctx, m, x, y, w, h, ppi, rand, img, an) {
  const base = hexRgb(m.color), look = m.look || 'plain';
  if (an) { // the product photo's own surface
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    paintFromPhoto(ctx, an, x, y, w, h, rand);
    if (look === 'gloss' || look === 'zellige') { const g = ctx.createLinearGradient(x, y, x, y + h); g.addColorStop(0, 'rgba(255,255,255,0.14)'); g.addColorStop(0.15, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.06)'); ctx.fillStyle = g; ctx.fillRect(x, y, w, h); }
    ctx.restore();
    return;
  }
  if (look === 'photo' && img && m.face_fit === 'tile') { // a photo of one whole tile: stretch it onto each tile
    const k = 0.97 + rand() * 0.06;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    const turn = (img.naturalHeight > img.naturalWidth) !== (h > w);
    if (turn) { ctx.translate(x + w / 2, y + h / 2); ctx.rotate(Math.PI / 2); ctx.drawImage(img, -h / 2, -w / 2, h, w); }
    else ctx.drawImage(img, x, y, w, h);
    ctx.restore();
    ctx.fillStyle = k > 1 ? `rgba(255,255,255,${(k - 1) * 1.5})` : `rgba(0,0,0,${(1 - k) * 1.5})`; ctx.fillRect(x, y, w, h);
    return;
  }
  if (look === 'photo' && img) {
    const k = 0.97 + rand() * 0.06, s = (m.face_img_in || 12) * ppi;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    const ox = -rand() * s, oy = -rand() * s;
    for (let yy = y + oy; yy < y + h; yy += s) for (let xx = x + ox; xx < x + w; xx += s) ctx.drawImage(img, xx, yy, s, s);
    ctx.fillStyle = k > 1 ? `rgba(255,255,255,${(k - 1) * 1.5})` : `rgba(0,0,0,${(1 - k) * 1.5})`; ctx.fillRect(x, y, w, h);
    ctx.restore();
    return;
  }
  if (look === 'zellige') {
    const k = 0.9 + rand() * 0.14;
    const g = ctx.createRadialGradient(x + w * (0.3 + rand() * 0.4), y + h * (0.3 + rand() * 0.4), 0, x + w / 2, y + h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, css(base, k * 1.04)); g.addColorStop(1, css(base, k * 0.9));
    ctx.fillStyle = g;
    const r = Math.min(w, h) * 0.08;
    ctx.beginPath();
    const j = () => (rand() - 0.5) * Math.min(w, h) * 0.04;
    ctx.moveTo(x + r + j(), y + j()); ctx.lineTo(x + w - r + j(), y + j()); ctx.quadraticCurveTo(x + w, y, x + w + j(), y + r + j());
    ctx.lineTo(x + w + j(), y + h - r + j()); ctx.quadraticCurveTo(x + w, y + h, x + w - r + j(), y + h + j());
    ctx.lineTo(x + r + j(), y + h + j()); ctx.quadraticCurveTo(x, y + h, x + j(), y + h - r + j()); ctx.lineTo(x + j(), y + r + j()); ctx.quadraticCurveTo(x, y, x + r + j(), y + j());
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.ellipse(x + rand() * w, y + rand() * h, w * (0.05 + rand() * 0.12), h * (0.02 + rand() * 0.05), rand() * 3, 0, 7); ctx.fill(); }
    ctx.fillStyle = 'rgba(60,50,40,0.18)';
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(x + rand() * w, y + rand() * h, Math.max(0.6, ppi * 0.03), 0, 7); ctx.fill(); }
    return;
  }
  if (look === 'cotto') {
    const k = 0.84 + rand() * 0.26, hue = (rand() - 0.5) * 0.1;
    const c = [base[0] * (1 + hue), base[1], base[2] * (1 - hue)];
    ctx.fillStyle = css(c, k); ctx.fillRect(x, y, w, h);
    for (let i = 0; i < 18; i++) { ctx.fillStyle = `rgba(${rand() < 0.5 ? '255,235,210' : '70,30,15'},${0.05 + rand() * 0.08})`; ctx.beginPath(); ctx.ellipse(x + rand() * w, y + rand() * h, w * (0.08 + rand() * 0.2), h * (0.06 + rand() * 0.15), rand() * 3, 0, 7); ctx.fill(); }
    return;
  }
  // gloss / matte / plain: even face, tiny variation, soft bevel highlight
  const k = 0.975 + rand() * 0.05;
  ctx.fillStyle = css(base, k); ctx.fillRect(x, y, w, h);
  if (look === 'gloss') {
    const g = ctx.createLinearGradient(x, y, x, y + h); g.addColorStop(0, 'rgba(255,255,255,0.22)'); g.addColorStop(0.12, 'rgba(255,255,255,0)'); g.addColorStop(0.88, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  } else {
    for (let i = 0; i < Math.min(400, w * h / 40); i++) { ctx.fillStyle = `rgba(${rand() < 0.5 ? '255,255,255' : '0,0,0'},0.04)`; ctx.fillRect(x + rand() * w, y + rand() * h, 1.5, 1.5); }
  }
}

// ---------- sheets drawn in code ----------
function drawKitKat(ctx, m, W, H, ppi, rand) {
  const base = hexRgb(m.color);
  ctx.fillStyle = m.grout_color || '#ddd8cf'; ctx.fillRect(0, 0, W, H);
  const fw = 0.75 * ppi, fl = (m.finger_len_in || 5) * ppi, g = (m.grout_in || 0.0625) * ppi;
  for (let y = 0; y < H - 1; y += fl) for (let x = 0; x < W - 1; x += fw) {
    ctx.fillStyle = css(base, 0.96 + rand() * 0.07);
    const r = fw * 0.35; const xx = x + g / 2, yy = y + g / 2, ww = fw - g, hh = fl - g;
    ctx.beginPath(); ctx.moveTo(xx + r, yy); ctx.lineTo(xx + ww - r, yy); ctx.quadraticCurveTo(xx + ww, yy, xx + ww, yy + r); ctx.lineTo(xx + ww, yy + hh - r); ctx.quadraticCurveTo(xx + ww, yy + hh, xx + ww - r, yy + hh); ctx.lineTo(xx + r, yy + hh); ctx.quadraticCurveTo(xx, yy + hh, xx, yy + hh - r); ctx.lineTo(xx, yy + r); ctx.quadraticCurveTo(xx, yy, xx + r, yy); ctx.fill();
  }
}
// Hexagons at true size: hex_in is corner to corner. A whole number of columns and an even number of
// rows make one seamless repeat; big single hexes and small mosaic hexes use the same honeycomb.
// hex_flat: true turns them flat-side-up.
function hexUnit(id, m) {
  const D = m.hex_in || 2, R = D / 2, g = m.grout_in ?? (D >= 4 ? 0.125 : 0.0625);
  const px = Math.sqrt(3) * R + g, py = 1.5 * R + g * Math.sqrt(3) / 2; // centre spacing, grout included
  const cols = Math.max(2, Math.round(Math.max(12, 2 * px) / px)), rows = Math.max(2, 2 * Math.round(Math.max(12, 2 * py) / (2 * py)));
  const W = cols * px, H = rows * py, ppi = Math.min(48, 2048 / Math.max(W, H));
  const c = mkCanvas(W * ppi, H * ppi), ctx = c.getContext('2d'), rand = rng(id + 'hex'), base = hexRgb(m.color);
  const sx = c.width / W, sy = c.height / H; // canvas is rounded to whole pixels; keep the repeat exact
  ctx.fillStyle = m.grout_color || (D >= 4 ? '#d6d1c7' : '#d9d5cd'); ctx.fillRect(0, 0, c.width, c.height);
  const r = R * Math.min(sx, sy), an = photoSurface(m);
  for (let row = -1; row <= rows; row++) for (let col = -1; col <= cols; col++) {
    const cx = (col + (row % 2 ? 0.5 : 0)) * px * sx, cy = row * py * sy;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; ctx[i ? 'lineTo' : 'moveTo'](cx + r * Math.cos(a), cy + r * Math.sin(a)); }
    ctx.closePath();
    if (an) { ctx.save(); ctx.clip(); paintFromPhoto(ctx, an, cx - r, cy - r, 2 * r, 2 * r, rand); ctx.restore(); continue; } // the photo's own surface
    ctx.fillStyle = css(base, 0.955 + rand() * 0.075); ctx.fill();
    if (m.finish !== 'gloss') { ctx.save(); ctx.clip(); for (let k = 0; k < 40 * D; k++) { ctx.fillStyle = `rgba(${rand() < 0.5 ? '255,255,255' : '0,0,0'},0.035)`; ctx.fillRect(cx - r + rand() * 2 * r, cy - r + rand() * 2 * r, 2, 2); } ctx.restore(); }
  }
  let canvas = c, unitW = W, unitH = H;
  if (m.hex_flat) { // rotate the whole repeat a quarter turn
    const rc = mkCanvas(c.height, c.width), rx = rc.getContext('2d');
    rx.translate(rc.width / 2, rc.height / 2); rx.rotate(Math.PI / 2); rx.drawImage(c, -c.width / 2, -c.height / 2);
    canvas = rc; unitW = H; unitH = W;
  }
  return { canvas, bump: groutBump(canvas, m), unitW, unitH, rough: m.finish === 'gloss' ? 0.22 : 0.72 };
}

// ---------- the repeat unit ----------
export function unitFor(id, m) {
  const key = JSON.stringify([id, m.look, m.color, m.tile_w_in, m.tile_h_in, m.orientation, m.pattern, m.grout_in, m.grout_color, m.face_img, m.face_fit, m.sheet_img, m.sheet_w_in, m.sheet_h_in, m.hex_in, m.hex_flat, m.finish, m.photo, m.face_from_photo, !!(m.photo && imgs.get(m.photo)?.__v)]);
  if (units.has(key)) return units.get(key);
  const look = m.look || 'plain';
  let u;
  if (look === 'sheet' && m.sheet_img) {
    const img = imgs.get(m.sheet_img)?.__v; // resolved image if prepare() ran
    const sw = m.sheet_w_in || 12, sh = m.sheet_h_in || 12;
    const c = mkCanvas(1024, 1024 * sh / sw), ctx = c.getContext('2d');
    if (img) ctx.drawImage(img, 0, 0, c.width, c.height); else { ctx.fillStyle = m.color || '#bbb'; ctx.fillRect(0, 0, c.width, c.height); }
    let bump = null;
    const bimg = m.bump_img && imgs.get(m.bump_img)?.__v;
    if (bimg) { bump = mkCanvas(512, 512 * sh / sw); bump.getContext('2d').drawImage(bimg, 0, 0, bump.width, bump.height); }
    u = { canvas: c, bump, unitW: sw, unitH: sh, rough: 0.82 };
  } else if (look === 'hex') {
    u = hexUnit(id, m);
  } else if (look === 'kitkat') {
    const sw = m.sheet_w_in || 12, sh = m.sheet_h_in || 12, ppi = Math.min(48, 1536 / Math.max(sw, sh));
    const c = mkCanvas(sw * ppi, sh * ppi), rand = rng(id);
    drawKitKat(c.getContext('2d'), m, c.width, c.height, ppi, rand);
    u = { canvas: c, bump: groutBump(c, m), unitW: sw, unitH: sh, rough: m.finish === 'gloss' ? 0.22 : 0.7 };
  } else {
    const [tw, th] = laidSize(m), g = m.grout_in ?? 0.125;
    const big = Math.max(tw, th);
    const an = look === 'photo' ? null : photoSurface(m);
    const n = look === 'photo' ? 1 : big >= 24 ? (an ? 2 : 1) : big >= 12 ? 2 : big >= 6 ? 4 : 6;
    const shift = m.pattern === 'offset' ? 0.5 : m.pattern === 'third' ? 1 / 3 : 0;
    const rows = shift === 0.5 ? Math.max(2, n % 2 ? n + 1 : n) : shift ? Math.max(3, Math.ceil(n / 3) * 3) : n;
    const cols = n;
    const unitW = cols * (tw + g), unitH = rows * (th + g);
    const ppi = Math.min(look === 'photo' ? 44 : 40, 2048 / Math.max(unitW, unitH));
    const c = mkCanvas(unitW * ppi, unitH * ppi), ctx = c.getContext('2d'), rand = rng(id + look);
    ctx.fillStyle = m.grout_color || '#d8d2c6'; ctx.fillRect(0, 0, c.width, c.height);
    const img = m.face_img ? imgs.get(m.face_img)?.__v : null;
    for (let r = 0; r < rows; r++) {
      const off = ((r * shift) % 1) * (tw + g);
      for (let k = -1; k <= cols; k++) {
        const x = (k * (tw + g) + off) * ppi, y = r * (th + g) * ppi;
        if (x > c.width || x + tw * ppi < 0) continue;
        drawFace(ctx, m, x, y, tw * ppi, th * ppi, ppi, rand, img, an);
      }
    }
    u = { canvas: c, bump: groutBump(c, m, m.bump_img && imgs.get(m.bump_img)?.__v, { tw, th, g, ppi, rows, cols, shift }), unitW, unitH, rough: m.finish === 'gloss' || look === 'gloss' || look === 'zellige' ? 0.2 : 0.8 };
  }
  units.set(key, u);
  return u;
}

// Bump map: grout recessed (dark), faces raised; photo faces add their own relief.
function groutBump(c, m, faceBump, grid) {
  const b = mkCanvas(Math.min(c.width, 1024), Math.min(c.height, 1024) * (c.height > 1024 ? 1 : 1));
  const sx = b.width / c.width, sy = b.height / c.height, ctx = b.getContext('2d');
  if (!grid) { // sheets drawn in code: derive from luminance against grout
    ctx.drawImage(c, 0, 0, b.width, b.height);
    const d = ctx.getImageData(0, 0, b.width, b.height), gr = hexRgb(m.grout_color || '#d8d2c6'), gl = (gr[0] + gr[1] + gr[2]) / 3;
    for (let i = 0; i < d.data.length; i += 4) { const l = (d.data[i] + d.data[i + 1] + d.data[i + 2]) / 3; const v = Math.abs(l - gl) < 6 ? 30 : 220; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; }
    ctx.putImageData(d, 0, 0); return b;
  }
  ctx.fillStyle = '#1e1e1e'; ctx.fillRect(0, 0, b.width, b.height);
  const { tw, th, g, ppi, rows, cols, shift } = grid;
  for (let r = 0; r < rows; r++) {
    const off = ((r * shift) % 1) * (tw + g);
    for (let k = -1; k <= cols; k++) {
      const x = (k * (tw + g) + off) * ppi * sx, y = r * (th + g) * ppi * sy, w = tw * ppi * sx, h = th * ppi * sy;
      if (faceBump) {
        const s = (m.face_img_in || 12) * ppi * sx;
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
        for (let yy = y; yy < y + h; yy += s) for (let xx = x; xx < x + w; xx += s) ctx.drawImage(faceBump, xx, yy, s, s);
        ctx.restore();
      } else { ctx.fillStyle = '#d8d8d8'; ctx.fillRect(x, y, w, h); }
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = Math.max(1, ppi * sx * 0.06); ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
  }
  return b;
}

// Resolve image promises so unitFor can stay synchronous.
export async function ready(materials) {
  await prepare(materials);
  for (const [src, p] of imgs) { const v = await p; p.__v = v; imgs.set(src, Object.assign(p, { __v: v })); }
}

const urls = new Map();
// Blob URL of a material's unit for SVG patterns (short href, no giant data strings).
export async function urlFor(id, m) {
  const u = unitFor(id, m);
  if (urls.has(u)) return urls.get(u);
  const p = new Promise(res => u.canvas.toBlob(b => res(b ? URL.createObjectURL(b) : null), 'image/jpeg', 0.86));
  urls.set(u, p);
  return p;
}
export async function svgTextures(materials) {
  await ready(materials);
  const out = {};
  for (const [id, m] of Object.entries(materials || {})) {
    if (m.kind !== 'tile') continue;
    const u = unitFor(id, m), url = await urlFor(id, m);
    if (url) out[id] = { url, unitW: u.unitW, unitH: u.unitH };
  }
  return out;
}
