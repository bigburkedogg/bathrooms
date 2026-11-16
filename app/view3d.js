// 3D preview: walls with their openings, tile on the right surfaces, fixtures, orbit camera.
// Walls between the camera and the room drop to a low stub so you can always see in.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/RoomEnvironment.js';
import { unitFor } from './tiles.js';
import { sqft, fmtIn } from './model.js';

const T = 4.5; // wall thickness, inches

function basisFor(W) {
  return new THREE.Matrix4().makeBasis(
    new THREE.Vector3(W.dir[0], 0, W.dir[1]),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(W.normal[0], 0, W.normal[1]),
  );
}
function frameAt(W, u) { // matrix for local coords (u along wall, y up, z into room) starting at u
  const m = basisFor(W);
  m.setPosition(W.start[0] + W.dir[0] * u, 0, W.start[1] + W.dir[1] * u);
  return m;
}

// ---------- small canvas helper (labels) ----------
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function textSprite(txt, size, color = '#f3eee4', bg = 'rgba(0,0,0,0)') {
  const c = canvas(256, 128), ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 256, 128);
  ctx.font = '600 72px "Iowan Old Style", Georgia, serif'; ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(txt, 128, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: true, transparent: true }));
  s.scale.set(size * 2, size, 1); s.renderOrder = 10;
  return s;
}

// ---------- mount ----------
export function mount3D(host, M0, opts, tipEl, cam, handlers = {}) {
  let M = M0, lastOpts = opts, selId = opts.sel || null;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    if (!renderer.getContext()) throw new Error('no context');
  } catch (e) {
    host.innerHTML = '<div class="no3d"><b>3D view unavailable.</b><br>WebGL could not start in this browser. Every other view works.</div>';
    return { update() {}, dispose() {}, ok: false };
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1c1b19');
  const b = M.bbox, cx = (b.x0 + b.x1) / 2, cz = (b.y0 + b.y1) / 2, S = Math.max(b.w, b.h, M.H);
  const camera = new THREE.PerspectiveCamera(36, 1, 1, 6000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.497; controls.minDistance = S * 0.35; controls.maxDistance = S * 6;
  const home = () => { camera.position.set(cx + S * 1.3, M.H * 1.6 + S * 0.85, cz + S * 1.62); controls.target.set(cx, M.H * 0.36, cz); controls.update(); };
  if (cam && cam.p && cam.t) { if (cam.fov) { camera.fov = cam.fov; camera.updateProjectionMatrix(); } camera.position.fromArray(cam.p); controls.target.fromArray(cam.t); controls.update(); } else home();

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.55;
  scene.add(new THREE.HemisphereLight(0xfff8ee, 0x4a443c, 0.75));
  const sun = new THREE.DirectionalLight(0xfff6e8, 1.7);
  sun.position.set(cx + S * 0.7, M.H * 3.2, cz + S * 0.9); sun.target.position.set(cx, 0, cz);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 10, far: M.H * 6 + S * 3 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);
  const lamp = new THREE.PointLight(0xffe9cc, 0.55, 0, 0); lamp.position.set(cx, M.H - 8, cz); scene.add(lamp);
  const grid = new THREE.GridHelper(Math.ceil((S * 4) / 12) * 12, Math.ceil((S * 4) / 12), 0x3b3934, 0x2b2a27);
  grid.position.set(cx, -0.8, cz); scene.add(grid);

  let mats = M.room.materials || {};
  const paint = (mats[M.room.paint?.material] || {}).color || '#ece5d4';
  const M_PAINT = new THREE.MeshStandardMaterial({ color: paint, roughness: 0.93 });
  const M_CUT = new THREE.MeshStandardMaterial({ color: '#8f877b', roughness: 1 });
  const M_WHITE = new THREE.MeshStandardMaterial({ color: '#f6f5f1', roughness: 0.28 });
  const M_WHITE_IN = new THREE.MeshStandardMaterial({ color: '#e4e2dc', roughness: 0.35 });
  const M_BLACK = new THREE.MeshStandardMaterial({ color: '#1d1c1b', roughness: 0.55, metalness: 0.25 });
  const M_WALNUT = new THREE.MeshStandardMaterial({ color: '#6a4830', roughness: 0.62 });
  const M_TOP = new THREE.MeshStandardMaterial({ color: '#efebe2', roughness: 0.4 });
  const M_TRIMPAINT = new THREE.MeshStandardMaterial({ color: '#f3f2ec', roughness: 0.6 });
  const M_MIRROR = new THREE.MeshStandardMaterial({ color: '#e3eaec', roughness: 0.04, metalness: 1.0, envMapIntensity: 1.6 });
  const M_GLASS = new THREE.MeshStandardMaterial({ color: '#d8ecf1', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.2, depthWrite: false });
  const M_BULB = new THREE.MeshStandardMaterial({ color: '#fff4dc', emissive: '#ffe3b0', emissiveIntensity: 1.2 });
  const M_DRAIN = new THREE.MeshStandardMaterial({ color: '#2a2928', roughness: 0.4, metalness: 0.5 });

  const baseDisp = [M_PAINT, M_CUT, M_WHITE, M_WHITE_IN, M_BLACK, M_WALNUT, M_TOP, M_TRIMPAINT, M_MIRROR, M_GLASS, M_BULB, M_DRAIN];
  let disposables = []; // everything one build() makes; freed on the next build
  const pickables = [];
  let texCache = {};
  const texFor = id => {
    if (texCache[id]) return texCache[id];
    const u = unitFor(id, mats[id] || {});
    const mk = c => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t; };
    const tex = mk(u.canvas); tex.colorSpace = THREE.SRGBColorSpace;
    return (texCache[id] = { tex, bump: u.bump ? mk(u.bump) : null, unitW: u.unitW, unitH: u.unitH, rough: u.rough });
  };
  // A tile material laid from (x0, y0) on its surface, in inches, with the grout recessed by a bump map.
  const tiledMat = (id, courses, x0, y0) => {
    const m = mats[id];
    if (!m || m.kind !== 'tile') return M_TOP;
    const T0 = texFor(id);
    const t = T0.tex.clone(); t.needsUpdate = true;
    t.repeat.set(1 / T0.unitW, 1 / T0.unitH); t.offset.set(-x0 / T0.unitW, -y0 / T0.unitH);
    let b = null;
    if (T0.bump) { b = T0.bump.clone(); b.needsUpdate = true; b.repeat.copy(t.repeat); b.offset.copy(t.offset); }
    const mm = new THREE.MeshStandardMaterial({ map: t, bumpMap: b, bumpScale: 1.4, roughness: T0.rough, envMapIntensity: T0.rough < 0.4 ? 1.1 : 0.5 });
    disposables.push(mm, t); if (b) disposables.push(b);
    return mm;
  };
  // A plane w × h whose UVs run in inches, so tiled materials land at true size.
  const plane = (w, h, mat) => {
    const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h);
    disposables.push(g);
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; return m;
  };
  const box = (w, h, d, mat, x, y, z, parent) => {
    const g = new THREE.BoxGeometry(w, h, d); const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); disposables.push(g); return m;
  };

  const root = new THREE.Group(); scene.add(root);
  let wallSets = [];

  // every mesh of an object answers to its id: clicking any part selects it, dragging moves it
  const tag = (grp, id, tip) => { grp.traverse(c => { if (c.isMesh) { c.userData.oid = id; if (!c.userData.tip && tip) c.userData.tip = tip; if (!pickables.includes(c)) pickables.push(c); } }); return grp; };

  function build(o) {
    lastOpts = o;
    root.clear(); wallSets = []; pickables.length = 0;
    for (const d of disposables) d.dispose && d.dispose();
    disposables = [];

    // floor
    const fShape = new THREE.Shape(M.poly.map(p => new THREE.Vector2(p[0], -p[1])));
    const fGeo = new THREE.ShapeGeometry(fShape); fGeo.rotateX(-Math.PI / 2); disposables.push(fGeo);
    const fm = M.room.floor?.material;
    const floor = new THREE.Mesh(fGeo, fm ? tiledMat(fm, o.courses, 0, 0) : M_TOP);
    floor.receiveShadow = true;
    floor.userData.tip = `Floor · ${(mats[fm] || {}).name || 'not set'} · ${sqft(M.floorNet).toFixed(1)} sq ft`;
    root.add(floor); pickables.push(floor);

    // fixtures
    for (const f of M.fixtures) root.add(tag(buildFixture(f, o), f.id, `${f.label} · ${fmtIn(f.w)} × ${fmtIn(f.depth)} · ${f.conf}`));

    // walls
    for (const W of M.walls) {
      const set = { W, full: new THREE.Group(), stub: new THREE.Group() };
      const shape = new THREE.Shape();
      const doors = W.openings.filter(q => q.type === 'door').sort((a, c) => a.x - c.x);
      shape.moveTo(-T, 0);
      for (const d of doors) { shape.lineTo(Math.max(-T, d.x), 0); shape.lineTo(Math.max(-T, d.x), d.y + d.h); shape.lineTo(Math.min(W.len, d.x + d.w), d.y + d.h); shape.lineTo(Math.min(W.len, d.x + d.w), 0); }
      shape.lineTo(W.len, 0); shape.lineTo(W.len, W.height); shape.lineTo(-T, W.height); shape.closePath();
      const niches = W.objects.filter(q => q.type === 'niche');
      for (const wn of W.openings.filter(q => q.type !== 'door').concat(niches)) {
        const h = new THREE.Path(); h.moveTo(wn.x, wn.y); h.lineTo(wn.x + wn.w, wn.y); h.lineTo(wn.x + wn.w, wn.y + wn.h); h.lineTo(wn.x, wn.y + wn.h); h.closePath(); shape.holes.push(h);
      }
      const g = new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: false });
      g.translate(0, 0, -T); g.applyMatrix4(frameAt(W, 0)); disposables.push(g);
      const wall = new THREE.Mesh(g, M_PAINT); wall.castShadow = true; wall.receiveShadow = true;
      wall.userData.tip = `Wall ${W.id} · paint ${sqft(W.paint).toFixed(1)} sq ft · ${fmtIn(W.len)} long`;
      set.full.add(wall); pickables.push(wall);

      // tile zones
      for (const z of W.zones) {
        const zs = new THREE.Shape();
        zs.moveTo(z.x0, z.y0); zs.lineTo(z.x1, z.y0); zs.lineTo(z.x1, z.y1); zs.lineTo(z.x0, z.y1); zs.closePath();
        for (const op of W.openings.concat(niches)) {
          if (op.x > z.x0 && op.x + op.w < z.x1 && op.y > z.y0 && op.y + op.h < z.y1) { const h = new THREE.Path(); h.moveTo(op.x, op.y); h.lineTo(op.x + op.w, op.y); h.lineTo(op.x + op.w, op.y + op.h); h.lineTo(op.x, op.y + op.h); h.closePath(); zs.holes.push(h); }
        }
        const zg = new THREE.ShapeGeometry(zs); zg.translate(0, 0, 0.3); zg.applyMatrix4(frameAt(W, 0)); disposables.push(zg);
        const zm = new THREE.Mesh(zg, tiledMat(z.material, o.courses, z.x0, z.y0)); zm.receiveShadow = true;
        zm.userData.tip = `${(mats[z.material] || {}).name || z.material} · wall ${W.id} · ${sqft(z.net).toFixed(1)} sq ft`;
        set.full.add(zm); pickables.push(zm);
      }
      // soap niches: a box recessed into the wall, lined with the tile around it
      for (const n of niches) {
        const z = W.zones.find(q => n.x >= q.x0 - 0.01 && n.x + n.w <= q.x1 + 0.01 && n.y >= q.y0 - 0.01 && n.y + n.h <= q.y1 + 0.01);
        const mat = z ? tiledMat(z.material, o.courses, 0, 0) : M_PAINT;
        const backMat = n.back_material && mats[n.back_material] ? tiledMat(n.back_material, o.courses, 0, 0) : mat;
        const grp = new THREE.Group(); grp.matrixAutoUpdate = false; grp.matrix.copy(frameAt(W, 0));
        const D = Math.min(n.depth || 3.5, T - 0.5), cx = n.x + n.w / 2, cy = n.y + n.h / 2, e = 0.04;
        const back = plane(n.w, n.h, backMat); back.position.set(cx, cy, -D); grp.add(back);
        const bot = plane(n.w, D, mat); bot.rotation.x = -Math.PI / 2; bot.position.set(cx, n.y + e, -D / 2); grp.add(bot);
        const top = plane(n.w, D, mat); top.rotation.x = Math.PI / 2; top.position.set(cx, n.y + n.h - e, -D / 2); grp.add(top);
        const lft = plane(D, n.h, mat); lft.rotation.y = Math.PI / 2; lft.position.set(n.x + e, cy, -D / 2); grp.add(lft);
        const rgt = plane(D, n.h, mat); rgt.rotation.y = -Math.PI / 2; rgt.position.set(n.x + n.w - e, cy, -D / 2); grp.add(rgt);
        set.full.add(tag(grp, n.id, `${n.label} · ${fmtIn(n.w)} × ${fmtIn(n.h)} × ${fmtIn(D)} deep`));
      }
      // edge trim
      if (o.trim) for (const e of M.trim.edges.filter(q => q.wall === W.id)) {
        const grp = new THREE.Group(); grp.matrixAutoUpdate = false; grp.matrix.copy(frameAt(W, 0));
        if (e.kind === 'top') box(e.x1 - e.x0, 0.45, 0.55, M_BLACK, (e.x0 + e.x1) / 2, e.y0, 0.45, grp);
        else if (e.kind === 'niche') {
          const w = e.x1 - e.x0, h = e.y1 - e.y0;
          box(w + 0.9, 0.45, 0.55, M_BLACK, e.x0 + w / 2, e.y0, 0.45, grp); box(w + 0.9, 0.45, 0.55, M_BLACK, e.x0 + w / 2, e.y1, 0.45, grp);
          box(0.45, h, 0.55, M_BLACK, e.x0, e.y0 + h / 2, 0.45, grp); box(0.45, h, 0.55, M_BLACK, e.x1, e.y0 + h / 2, 0.45, grp);
        } else box(0.45, e.y1 - e.y0, 0.55, M_BLACK, e.x0, (e.y0 + e.y1) / 2, 0.45, grp);
        set.full.add(grp);
      }
      // wall-mounted things
      for (const ob of W.objects) if (ob.kind !== 'fixture') set.full.add(tag(buildWallObject(W, ob), ob.id, `${ob.label} · ${fmtIn(ob.w)} × ${fmtIn(ob.h)} · ${ob.conf}`));
      // stub shown when the wall is cut away
      const sg = new THREE.BoxGeometry(W.len + T, 3, T); disposables.push(sg);
      const stub = new THREE.Mesh(sg, M_CUT);
      const mid = [W.start[0] + W.dir[0] * (W.len - T) / 2 - W.normal[0] * T / 2, W.start[1] + W.dir[1] * (W.len - T) / 2 - W.normal[1] * T / 2];
      stub.position.set(mid[0], 1.5, mid[1]); stub.rotation.y = -Math.atan2(W.dir[1], W.dir[0]); stub.receiveShadow = true;
      set.stub.add(stub);
      if (o.labels) {
        const mx = W.start[0] + W.dir[0] * W.len / 2, mz = W.start[1] + W.dir[1] * W.len / 2;
        const lab = textSprite(W.id, 9);
        lab.position.set(mx + W.normal[0] * 6, W.height + 9, mz + W.normal[1] * 6);
        set.full.add(lab);
        const lab2 = textSprite(W.id, 9);
        const qx = W.start[0] + W.dir[0] * W.len * 0.2, qz = W.start[1] + W.dir[1] * W.len * 0.2;
        lab2.position.set(qx - W.normal[0] * T * 0.5, 10, qz - W.normal[1] * T * 0.5);
        set.stub.add(lab2);
      }
      if (o.dims) {
        const off = -(T + 9);
        const a = [W.start[0] + W.normal[0] * off, W.start[1] + W.normal[1] * off], c = [W.end[0] + W.normal[0] * off, W.end[1] + W.normal[1] * off];
        const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a[0], 0.5, a[1]), new THREE.Vector3(c[0], 0.5, c[1])]);
        const lm = new THREE.LineBasicMaterial({ color: '#d9cfbd' }); disposables.push(lg, lm);
        const line = new THREE.Line(lg, lm); root.add(line);
        const lab = textSprite(fmtIn(W.len), 7, '#e9e1d2');
        lab.position.set((a[0] + c[0]) / 2 + W.normal[0] * -6, 4, (a[1] + c[1]) / 2 + W.normal[1] * -6); root.add(lab);
      }
      root.add(set.full, set.stub);
      wallSets.push(set);
    }
    cutaway();
    markSelected();
  }

  // a box around whatever is selected
  let selHelper = null;
  function markSelected() {
    if (selHelper) { root.remove(selHelper); selHelper.geometry.dispose(); selHelper.material.dispose(); selHelper = null; }
    if (!selId) return;
    root.updateMatrixWorld(true);
    const bx = new THREE.Box3(); let any = false;
    root.traverse(c => { if (c.isMesh && c.userData.oid === selId) { bx.expandByObject(c); any = true; } });
    if (!any) return;
    selHelper = new THREE.Box3Helper(bx.expandByScalar(0.8), 0x5fae6e);
    selHelper.material.depthTest = false; selHelper.renderOrder = 20;
    root.add(selHelper);
  }

  function buildWallObject(W, ob) {
    const g = new THREE.Group(); g.matrixAutoUpdate = false; g.matrix.copy(frameAt(W, 0));
    const cxo = ob.x + ob.w / 2, cyo = ob.y + ob.h / 2;
    const tip = `${ob.label} · ${fmtIn(ob.w)} × ${fmtIn(ob.h)} · ${ob.conf}`;
    let m;
    switch (ob.type) {
      case 'door': {
        const c = ob.casing_in ?? 2.5;
        box(c, ob.h + c, 0.75, M_TRIMPAINT, ob.x - c / 2, (ob.h + c) / 2, 0.38, g);
        box(c, ob.h + c, 0.75, M_TRIMPAINT, ob.x + ob.w + c / 2, (ob.h + c) / 2, 0.38, g);
        box(ob.w + 2 * c, c, 0.75, M_TRIMPAINT, cxo, ob.h + c / 2, 0.38, g);
        const pivot = new THREE.Group(); const hingeX = ob.hinge === 'right' ? ob.x + ob.w : ob.x;
        pivot.position.set(hingeX, 0, 0.5); pivot.rotation.y = (ob.hinge === 'right' ? 1 : -1) * 0.5 * (ob.swing === 'out' ? -1 : 1);
        const slab = box(ob.w - 0.25, ob.h - 0.5, 1.375, M_TRIMPAINT, (ob.hinge === 'right' ? -1 : 1) * (ob.w / 2), ob.h / 2, 0.7, pivot);
        slab.userData.tip = tip; pickables.push(slab);
        const knob = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8), M_BLACK); knob.position.set((ob.hinge === 'right' ? -1 : 1) * (ob.w - 2.6), 36, 1.9); pivot.add(knob);
        g.add(pivot); break;
      }
      case 'window':
        box(ob.w, ob.h, 0.3, M_GLASS, cxo, cyo, -T / 2, g);
        box(ob.w + 2, 1, 2.5, M_TRIMPAINT, cxo, ob.y - 0.5, 1, g); break;
      case 'mirror':
        m = box(ob.w, ob.h, 0.6, M_MIRROR, cxo, cyo, 0.5, g); m.userData.tip = tip; pickables.push(m); break;
      case 'light': {
        box(ob.w, 1.6, 2.4, M_BLACK, cxo, cyo, 1.4, g);
        for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 10), M_BULB); s.position.set(ob.x + (ob.w * (i + 0.5)) / 3, cyo - 2.2, 2.6); g.add(s); }
        break;
      }
      case 'valve': {
        const d = new THREE.Mesh(new THREE.CylinderGeometry(ob.w / 2, ob.w / 2, 0.5, 32), M_BLACK); d.rotation.x = Math.PI / 2; d.position.set(cxo, cyo, 0.55); g.add(d);
        box(0.8, 0.8, 3.2, M_BLACK, cxo, cyo, 2.2, g);
        box(4.2, 0.7, 0.7, M_BLACK, cxo + 1.6, cyo, 3.8, g);
        d.userData.tip = tip; pickables.push(d); break;
      }
      case 'showerhead': {
        box(0.7, 0.7, 7, M_BLACK, cxo, ob.y + ob.h + 2, 3.5, g);
        const hd = new THREE.Mesh(new THREE.CylinderGeometry(ob.w / 2, ob.w / 2, 0.8, 28), M_BLACK); hd.position.set(cxo, ob.y + ob.h + 1.4, 7.2); g.add(hd); break;
      }
      case 'spout': box(ob.w, ob.h * 0.7, 6, M_BLACK, cxo, cyo, 3, g); break;
      case 'niche': break; // built with the wall (recess + tile lining)
      case 'shelf': box(ob.w, Math.max(ob.h, 1.5), ob.depth || 6, M_WALNUT, cxo, cyo, (ob.depth || 6) / 2, g); break;
      case 'towel_bar': box(ob.w, 0.8, 0.8, M_BLACK, cxo, cyo, 3, g); break;
      default: box(ob.w, ob.h, 0.4, M_TRIMPAINT, cxo, cyo, 0.3, g);
    }
    return g;
  }

  function buildFixture(f, o) {
    const W = f.W, g = new THREE.Group(); g.matrixAutoUpdate = false; g.matrix.copy(frameAt(W, f.x));
    const w = f.w, d = f.depth, tip = `${f.label} · ${fmtIn(w)} × ${fmtIn(d)} · ${f.conf}`;
    const mark = m => { m.userData.tip = tip; pickables.push(m); return m; };
    if (f.type === 'shower') {
      const sh = new THREE.Shape([[0, 0], [w, 0], [w, -d], [0, -d]].map(p => new THREE.Vector2(p[0], p[1])));
      const sg = new THREE.ShapeGeometry(sh); sg.rotateX(-Math.PI / 2); sg.translate(0, 0.15, 0); disposables.push(sg);
      const pan = new THREE.Mesh(sg, f.floor_material ? tiledMat(f.floor_material, o.courses, 0, 0) : M_TOP);
      pan.receiveShadow = true; pan.userData.tip = `Shower floor · ${(mats[f.floor_material] || {}).name || ''} · ${sqft(f.panArea ?? f.area).toFixed(1)} sq ft`; pickables.push(pan); g.add(pan);
      const dr = f.drain || {};
      if (dr.type === 'linear') box(24, 0.2, 2, M_DRAIN, dr.u_in ?? w / 2, 0.25, dr.v_in ?? d - 3, g);
      else { const c = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 0.2, 24), M_DRAIN); c.position.set(dr.u_in ?? w / 2, 0.25, dr.v_in ?? d / 2); g.add(c); }
      const loc = p => { const v = [p[0] - f.p0[0], p[1] - f.p0[1]]; return [v[0] * W.dir[0] + v[1] * W.dir[1], v[0] * W.normal[0] + v[1] * W.normal[1]]; };
      // curb: top and both faces, tiled, along each open side
      const curbH = f.curbs?.length ? f.curbs[0].h : 0, curbW = f.curbs?.length ? f.curbs[0].w : 0;
      if (f.curbs?.length) {
        const cm = tiledMat(f.curb?.material || f.walls_material, o.courses, 0, 0);
        for (const cb of f.curbs) {
          const A = loc(cb.a), B = loc(cb.b), inl = [cb.inward[0] * W.dir[0] + cb.inward[1] * W.dir[1], cb.inward[0] * W.normal[0] + cb.inward[1] * W.normal[1]];
          const ang = Math.atan2(B[1] - A[1], B[0] - A[0]);
          const grp = new THREE.Group(); grp.position.set(A[0], 0, A[1]); grp.rotation.y = -ang;
          const zdir = [Math.sin(-ang), Math.cos(-ang)]; // where the group's +z points, in fixture coords
          const sgn = zdir[0] * inl[0] + zdir[1] * inl[1] >= 0 ? 1 : -1;
          const top = plane(cb.len, cb.w, cm); top.rotation.x = -Math.PI / 2; top.position.set(cb.len / 2, cb.h, sgn * cb.w / 2); grp.add(top);
          const outer = plane(cb.len, cb.h, cm); outer.position.set(cb.len / 2, cb.h / 2, 0); if (sgn > 0) outer.rotation.y = Math.PI; grp.add(outer);
          const inner = plane(cb.len, cb.h, cm); inner.position.set(cb.len / 2, cb.h / 2, sgn * cb.w); if (sgn < 0) inner.rotation.y = Math.PI; grp.add(inner);
          top.userData.tip = `Curb · ${fmtIn(cb.w)} wide × ${fmtIn(cb.h)} tall · ${(mats[f.curb?.material || f.walls_material] || {}).name || ''}`; pickables.push(top);
          g.add(grp);
        }
      }
      const ent = f.entry || { type: 'panel', panel_w_in: Math.min(34, w), side: 'start' };
      const glassH = Math.min(76, M.H - 4 - curbH);
      for (const e of f.open || []) {
        let A = loc(e.a), B = loc(e.b);
        if (ent.type === 'open') continue;
        if (e.edge === 2 && ent.type === 'panel') {
          const pw = Math.min(ent.panel_w_in ?? 34, w); const u0 = ent.side === 'end' ? w - pw : 0;
          A = [u0, d - curbW / 2]; B = [u0 + pw, d - curbW / 2];
        }
        const len = Math.hypot(B[0] - A[0], B[1] - A[1]); if (len < 1) continue;
        const ang = Math.atan2(B[1] - A[1], B[0] - A[0]);
        if (ent.type === 'curtain') {
          const rod = box(len, 0.8, 0.8, M_BLACK, (A[0] + B[0]) / 2, curbH + glassH + 2, (A[1] + B[1]) / 2, g); rod.rotation.y = -ang;
          continue;
        }
        const pane = box(len, glassH, 0.375, M_GLASS, (A[0] + B[0]) / 2, curbH + glassH / 2 + 0.3, (A[1] + B[1]) / 2, g); pane.rotation.y = -ang; pane.castShadow = false; pane.renderOrder = 5;
        const ch = box(len, 0.9, 0.9, M_BLACK, (A[0] + B[0]) / 2, curbH + 0.75, (A[1] + B[1]) / 2, g); ch.rotation.y = -ang;
      }
      return g;
    }
    if (f.type === 'tub') {
      const h = f.h, rim = 3;
      const outer = new THREE.Shape([[0, 0], [w, 0], [w, -d], [0, -d]].map(p => new THREE.Vector2(p[0], p[1])));
      const hole = new THREE.Path(); const rr = 6, x0 = rim, x1 = w - rim, y0 = -rim, y1 = -(d - rim);
      hole.moveTo(x0 + rr, y0); hole.lineTo(x1 - rr, y0); hole.quadraticCurveTo(x1, y0, x1, y0 - rr); hole.lineTo(x1, y1 + rr); hole.quadraticCurveTo(x1, y1, x1 - rr, y1); hole.lineTo(x0 + rr, y1); hole.quadraticCurveTo(x0, y1, x0, y1 + rr); hole.lineTo(x0, y0 - rr); hole.quadraticCurveTo(x0, y0, x0 + rr, y0);
      outer.holes.push(hole);
      const tg = new THREE.ExtrudeGeometry(outer, { depth: h, bevelEnabled: false }); tg.rotateX(-Math.PI / 2); disposables.push(tg);
      const tub = new THREE.Mesh(tg, M_WHITE); tub.castShadow = true; tub.receiveShadow = true; g.add(tub); mark(tub);
      box(w - rim * 2, 2, d - rim * 2, M_WHITE_IN, w / 2, 1, d / 2, g);
      return g;
    }
    if (f.type === 'toilet') {
      const cxw = w / 2, tw = Math.min(19, w - 1), bowlD = d - 8.6;
      mark(box(tw, 14.5, 7.5, M_WHITE, cxw, 15 + 7.25, 4.4, g));
      box(tw + 0.6, 1, 8.3, M_WHITE, cxw, 30, 4.4, g);
      box(3, 0.8, 0.8, M_BLACK, cxw + tw / 2 - 3, 27.2, 8.5, g);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(7.3, 4.6, 15, 36), M_WHITE); bowl.scale.z = bowlD / 2 / 7.3; bowl.position.set(cxw, 7.5, 8.6 + bowlD / 2); bowl.castShadow = true; g.add(bowl); mark(bowl);
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(7.6, 7.6, 1, 36), M_WHITE); seat.scale.z = bowlD / 2 / 7.6; seat.position.set(cxw, 15.5, 8.6 + bowlD / 2); g.add(seat);
      const water = new THREE.Mesh(new THREE.CircleGeometry(5.4, 32), M_WHITE_IN); water.rotation.x = -Math.PI / 2; water.scale.y = (bowlD / 2 - 2.2) / 5.4; water.position.set(cxw, 16.05, 8.6 + bowlD / 2 + 0.6); g.add(water);
      return g;
    }
    if (f.type === 'vanity') {
      const h = f.h, top = 1.5, kick = 3.5;
      const cab = box(w, h - top - kick, d - 0.75, M_WALNUT, w / 2, kick + (h - top - kick) / 2, (d - 0.75) / 2, g); mark(cab);
      box(w - 3, kick, d - 3.5, M_BLACK, w / 2, kick / 2, (d - 3.5) / 2, g);
      box(w + 0.5, top, d + 0.25, M_TOP, w / 2, h - top / 2, (d + 0.25) / 2, g);
      const basin = new THREE.Mesh(new THREE.CircleGeometry(1, 40), M_WHITE_IN); basin.rotation.x = -Math.PI / 2; basin.scale.set(Math.min(8.5, w * 0.3), 6.2, 1); basin.position.set(w / 2, h + 0.03, d / 2 + 0.8); g.add(basin);
      box(1.2, 7, 1.2, M_BLACK, w / 2, h + 3.5, 2.4, g); box(1, 1, 5, M_BLACK, w / 2, h + 6.6, 4.6, g);
      const doors = w >= 36 ? 2 : 1, ih = h - top - kick;
      box(w - 1, 0.25, 0.25, M_BLACK, w / 2, kick + ih - 6, d - 0.6, g);
      for (let i = 1; i < doors; i++) box(0.25, ih - 7, 0.25, M_BLACK, (w * i) / doors, kick + (ih - 6) / 2, d - 0.6, g);
      box(6, 0.8, 0.8, M_BLACK, w / 2, kick + ih - 2.6, d - 0.2, g);
      return g;
    }
    mark(box(w, Math.max(f.h, 1), d, M_WHITE, w / 2, Math.max(f.h, 1) / 2, d / 2, g));
    return g;
  }

  // cut away walls between camera and room
  function cutaway() {
    for (const s of wallSets) {
      const W = s.W, mx = (W.start[0] + W.end[0]) / 2, mz = (W.start[1] + W.end[1]) / 2;
      const outside = (camera.position.x - mx) * W.normal[0] + (camera.position.z - mz) * W.normal[1] < -1;
      s.full.visible = !outside; s.stub.visible = outside;
    }
  }

  // hover take-offs, click to select, drag to move
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  const visible = m => { let p = m; while (p) { if (!p.visible) return false; p = p.parent; } return true; };
  const aim = ev => { const rect = renderer.domElement.getBoundingClientRect(); mouse.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1); ray.setFromCamera(mouse, camera); };
  const pick = () => ray.intersectObjects(pickables.filter(visible), false)[0];
  const half = v => Math.round(v * 2) / 2, clamp = (v, a, c) => Math.max(a, Math.min(c, v));
  let drag = null, downAt = null;
  function showTip(ev, hit) {
    if (!tipEl) return;
    if (hit && hit.object.userData.tip) {
      tipEl.textContent = hit.object.userData.tip; tipEl.style.display = 'block';
      tipEl.style.left = ev.clientX - host.getBoundingClientRect().left + 14 + 'px'; tipEl.style.top = ev.clientY - host.getBoundingClientRect().top + 14 + 'px';
    } else tipEl.style.display = 'none';
  }
  function onDown(ev) {
    if (ev.button !== 0) return;
    downAt = [ev.clientX, ev.clientY];
    aim(ev);
    const hit = pick(), oid = hit?.object.userData.oid, ob = oid && M.byId[oid];
    if (!ob || !ob.W) return; // empty space or a wall: orbit as usual
    controls.enabled = false;
    if (ob.kind === 'fixture') {
      const P = new THREE.Vector3();
      if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), P)) { controls.enabled = true; return; }
      drag = { oid, mode: 'floor', moved: false, start: [P.x, P.z] };
      handlers.onDragStart && handlers.onDragStart(oid, [P.x, P.z]);
    } else {
      const W = ob.W, nrm = new THREE.Vector3(W.normal[0], 0, W.normal[1]);
      const plane = new THREE.Plane(nrm, -(W.normal[0] * W.start[0] + W.normal[1] * W.start[1]));
      const P = new THREE.Vector3(); if (!ray.ray.intersectPlane(plane, P)) { controls.enabled = true; return; }
      const u = (P.x - W.start[0]) * W.dir[0] + (P.z - W.start[1]) * W.dir[1], v = P.y;
      drag = { oid, mode: 'wall', W, plane, grabU: u - ob.x, grabV: v - ob.y, w: ob.w, h: ob.h, slide: ob.type === 'door', moved: false, start: [u, v], last: null };
    }
    renderer.domElement.setPointerCapture(ev.pointerId);
    if (selId !== oid) { selId = oid; markSelected(); handlers.onSelect && handlers.onSelect(oid); }
  }
  let pending = null;
  function onMove(ev) {
    if (!drag) { aim(ev); showTip(ev, pick()); return; }
    if (tipEl) tipEl.style.display = 'none';
    aim(ev);
    const P = new THREE.Vector3();
    if (drag.mode === 'wall') {
      if (!ray.ray.intersectPlane(drag.plane, P)) return;
      const W = drag.W, u = (P.x - W.start[0]) * W.dir[0] + (P.z - W.start[1]) * W.dir[1], v = P.y;
      if (!drag.moved && Math.hypot(u - drag.start[0], v - drag.start[1]) < 0.75) return;
      drag.moved = true;
      let x = clamp(half(u - drag.grabU), 0, Math.max(0, W.len - drag.w));
      const y = drag.slide ? null : clamp(half(v - drag.grabV), 0, Math.max(0, W.height - drag.h));
      pending = () => handlers.onDragWall && handlers.onDragWall(drag.oid, W.id, x, y);
    } else {
      if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), P)) return;
      if (!drag.moved && Math.hypot(P.x - drag.start[0], P.z - drag.start[1]) < 0.75) return;
      drag.moved = true;
      const p = [P.x, P.z];
      pending = () => handlers.onDragFloor && handlers.onDragFloor(drag.oid, p);
    }
  }
  function onUp(ev) {
    const was = drag; drag = null; controls.enabled = true;
    if (was) { if (was.moved) handlers.onDragEnd && handlers.onDragEnd(was.oid); return; }
    if (downAt && Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) < 4 && selId) { selId = null; markSelected(); handlers.onSelect && handlers.onSelect(null); }
    downAt = null;
  }
  renderer.domElement.addEventListener('pointerdown', onDown, true);
  renderer.domElement.addEventListener('pointermove', onMove);
  renderer.domElement.addEventListener('pointerup', onUp);
  renderer.domElement.addEventListener('pointerleave', () => { if (tipEl) tipEl.style.display = 'none'; });

  function resize() {
    const w = host.clientWidth || 800, h = host.clientHeight || 600;
    renderer.setSize(w, h, false); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(host); resize();

  let raf = 0, alive = true;
  const tick = () => {
    if (!alive) return;
    if (pending) { const p = pending; pending = null; p(); }
    controls.update(); cutaway(); renderer.render(scene, camera); raf = requestAnimationFrame(tick);
  };
  build(opts); tick();

  const setFov = f => { if (camera.fov !== f) { camera.fov = f; camera.updateProjectionMatrix(); } };
  return {
    ok: true,
    update(o) { for (const k in texCache) { texCache[k].tex.dispose(); texCache[k].bump?.dispose(); } texCache = {}; build(o); },
    setModel(M2) { M = M2; mats = M.room.materials || {}; build(lastOpts); },
    setSel(id) { selId = id || null; markSelected(); },
    getCam() { return { p: camera.position.toArray(), t: controls.target.toArray(), fov: camera.fov }; },
    screenOf(oid) { // where an item sits on screen (used by the browser tests)
      root.updateMatrixWorld(true);
      const bx = new THREE.Box3(); root.traverse(c => { if (c.isMesh && c.userData.oid === oid && visible(c)) bx.expandByObject(c); });
      if (bx.isEmpty()) return null;
      const v = bx.getCenter(new THREE.Vector3()).project(camera), rect = renderer.domElement.getBoundingClientRect();
      return [rect.left + (v.x + 1) / 2 * rect.width, rect.top + (1 - v.y) / 2 * rect.height];
    },
    view(name) {
      setFov(name === 'eye' ? 68 : 36);
      if (name === 'top') { camera.position.set(cx + 0.01, S * 2.6, cz + 0.01); controls.target.set(cx, 0, cz); }
      else if (name === 'eye') {
        const door = M.objects.find(q => q.type === 'door' && q.W);
        if (door) {
          const W = door.W, c = [W.start[0] + W.dir[0] * (door.x + door.w / 2), W.start[1] + W.dir[1] * (door.x + door.w / 2)];
          const inset = Math.min(door.w * 0.6 + 4, 24); // stand just past the door's swing so it doesn't block the view
          camera.position.set(c[0] + W.normal[0] * inset, 60, c[1] + W.normal[1] * inset);
          controls.target.set(c[0] + W.normal[0] * (inset + 60), 46, c[1] + W.normal[1] * (inset + 60));
        } else { camera.position.set(cx, 60, b.y1 - 4); controls.target.set(cx, 46, b.y0 + 10); }
      } else home();
      controls.update();
    },
    snapshot() { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); },
    dispose() {
      alive = false; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerdown', onDown, true);
      renderer.domElement.removeEventListener('pointerup', onUp);
      for (const k in texCache) { texCache[k].tex.dispose(); texCache[k].bump?.dispose(); }
      envTex.dispose(); pmrem.dispose();
      root.traverse(o2 => { if (o2.geometry) o2.geometry.dispose(); });
      for (const d of disposables.concat(baseDisp)) d.dispose && d.dispose();
      renderer.dispose(); renderer.domElement.remove();
    },
  };
}
