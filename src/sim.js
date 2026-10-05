import * as THREE from 'three';
import { KIND_INK, KIND_BLOCK } from './blocks.js';

export const TOTAL = 48;
export const PER_WAVE = 12;
export const MAX_RIPPLES = 48;
export const MAX_BUMPS = 40;
export const CUBE_HALF = 10;

const SPHERE_R = 12.5; // same volume as the 20×20×20 cube it becomes
const BREATH_PERIOD = 4.6;
const SWAP = 3.1; // seconds into the recursion when the grown block hands over to the field

// Data streams: lines of small cubes that flow along a curve into the form.
// Positions along a stream are counted in elements, SPACING cells apart.
const FLOW_SPEED = 26; // cells per second
const SPACING = 0.35;
const LEAD = 10; // elements from the tip of a stream to its first packet
const TAIL = 14; // elements after the last packet, tapering off
const PACKET_GAP = 2; // elements kept clear ahead of a packet
const PACKET_TRAIL = [1.1, 0, 0.62, 0.46, 0.32]; // the packet, then its colour trail (the first one would sit inside it)
const EDGE_PITCH = 50; // elements between packets on streams from the screen edge
const NEAR_PITCH = 34; // ...and on the short streams drawn from a click
const PACKETS_PER_STREAM = 3;
const SAMPLES = 48;

export const STAGES = [
  { name: 'Latent', copy: 'An unshaped field of meaning. It breathes and waits for input.' },
  { name: 'Ingesting', copy: 'Your data streams in. Every signal that lands leaves a mark.' },
  { name: 'Associating', copy: 'Signals start to echo each other, and the noise settles into a calmer shape.' },
  { name: 'Structuring', copy: 'Echoes turn into symmetry. Faces and edges push out of the field.' },
  { name: 'Crystallizing', copy: 'The last signals sharpen the edges, and color falls into order.' },
  { name: 'Formed', copy: 'A stable structure. Still breathing, still listening.' },
  { name: 'Recursing', copy: 'The whole form becomes one block of the next system, and it starts again.' },
];

const SCRIPT = [
  { type: 'hold', dur: 3.2 },
  { type: 'wave', target: 12 },
  { type: 'hold', dur: 2.2 },
  { type: 'wave', target: 24 },
  { type: 'hold', dur: 2.2 },
  { type: 'wave', target: 36 },
  { type: 'hold', dur: 2.2 },
  { type: 'wave', target: 48 },
  { type: 'formed', dur: 7.5 },
  { type: 'recurse', dur: 5.6 },
  { type: 'melt', dur: 3.8 },
];
const FORMED = SCRIPT.findIndex((p) => p.type === 'formed');

const clamp01 = (x) => Math.min(Math.max(x, 0), 1);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeSine = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t));
const easeCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const hash = (n) => {
  const h = Math.sin(n * 12.9898) * 43758.5453;
  return h - Math.floor(h);
};

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomUnit(rand, out = new THREE.Vector3()) {
  const z = rand() * 2 - 1;
  const a = rand() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return out.set(r * Math.cos(a), r * Math.sin(a), z);
}

function rotY(v, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x = v.x * c + v.z * s;
  v.z = -v.x * s + v.z * c;
  v.x = x;
  return v;
}

function bezier(a, b, c, d, t, out) {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return out.set(
    a.x * w0 + b.x * w1 + c.x * w2 + d.x * w3,
    a.y * w0 + b.y * w1 + c.y * w2 + d.y * w3,
    a.z * w0 + b.z * w1 + c.z * w2 + d.z * w3,
  );
}

// Mirrors sdRoundBox() in the field shader (without the noise).
function sdRoundBox(x, y, z, b, r) {
  const qx = Math.abs(x) - b + r;
  const qy = Math.abs(y) - b + r;
  const qz = Math.abs(z) - b + r;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
  return outside + Math.min(Math.max(qx, qy, qz), 0) - r;
}

function surfaceDistance(dir, size, round) {
  let lo = 0;
  let hi = 24;
  for (let i = 0; i < 22; i++) {
    const m = (lo + hi) / 2;
    if (sdRoundBox(dir.x * m, dir.y * m, dir.z * m, size, round) < 0) lo = m;
    else hi = m;
  }
  return lo;
}

// How much the system has learned (0 → 1) decides everything about its shape.
export function shapeAt(L) {
  const size = lerp(SPHERE_R, CUBE_HALF, smoothstep(0, 1, L));
  const rest = 1 - L;
  return {
    size,
    round: size * rest ** 1.25, // round === size is a sphere, 0 is a sharp cube
    noiseAmp: 3.8 * rest ** 1.7,
    chaos: rest ** 1.3,
    dither: 1 - smoothstep(0.8, 1, L),
    breath: 0.9 * rest,
    flow: lerp(0.22, 0.05, L),
  };
}

const IDENTITY = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c2 = new THREE.Vector3();

export class Sim {
  constructor({ camera, look, reducedMotion }) {
    camera.updateMatrixWorld();
    this.camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    this.camUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    this.camBack = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2);
    this.camera = camera;
    this.look = look.clone();
    this.motion = reducedMotion ? 0.35 : 1;
    this.view = { halfW: 40, halfH: 27, offsetX: 0 };

    this.ripples = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4());
    this.rippleStrength = new Float32Array(MAX_RIPPLES);
    this.bumps = Array.from({ length: MAX_BUMPS }, () => new THREE.Vector4());
    this.bumpStrength = new Float32Array(MAX_BUMPS);
    this.seed = new THREE.Vector3();
    this.hero = { visible: false, cell: new THREE.Vector3(), pos: new THREE.Vector3(), half: 0.46, edge: 1 };
    this.fx = { dissolveOrigin: new THREE.Vector3() };
    this.reset();
  }

  reset() {
    this.rand = mulberry32(20261005);
    this.time = 0;
    this.flow = 0;
    this.breathPhase = 0;
    this.breathWave = 0;
    this.lattice = 1;
    this.bob = 0;
    this.yaw = 0;
    this.spin = 0;
    this.depth = 1;
    this.absorbed = 0;
    this.L = 0;
    this.Lv = 0;
    this.shape = shapeAt(0);
    this.shadowSize = this.shape.size;
    this.streams = [];
    this.echoes = [];
    this.spawned = 0;
    this.emitTimer = 0;
    this.listenTimer = 0;
    this.sources = [0, Math.PI];

    for (const r of this.ripples) r.set(0, 0, 0, -1e4);
    for (const b of this.bumps) b.set(0, 0, 0, -1e4);
    this.rippleStrength.fill(0);
    this.bumpStrength.fill(0);
    this.rippleHead = 0;
    this.bumpHead = 0;

    this.hero.visible = false;
    Object.assign(this.fx, { gap: 0.9, edge: 1, mono: 0, monoTone: 0, sweep: 0, dissolve: 0, interiorCut: 3.2, breathScale: 1 });
    this.reseed();
    this.goto(0);
  }

  reseed() {
    this.seed.set(this.rand() * 100, this.rand() * 100, this.rand() * 100);
  }

  // offsetX: where the viewport centre sits along the camera's right axis.
  setView(halfW, halfH, offsetX) {
    this.view.halfW = halfW;
    this.view.halfH = halfH;
    this.view.offsetX = offsetX;
  }

  get phase() {
    return SCRIPT[this.phaseIndex];
  }

  get learning() {
    const t = this.phase.type;
    return t === 'hold' || t === 'wave';
  }

  // New data is ignored while the form hands itself over to the next cycle.
  get accepting() {
    const t = this.phase.type;
    return t !== 'recurse' && t !== 'melt';
  }

  get stage() {
    const t = this.phase.type;
    if (t === 'recurse' || t === 'melt') return 6;
    if (t === 'formed' || this.absorbed >= TOTAL) return 5;
    if (this.absorbed === 0) return 0;
    return 1 + Math.floor(this.absorbed / PER_WAVE);
  }

  get filled() {
    if (this.phase.type === 'melt') return Math.round(this.L * TOTAL);
    return this.learning ? this.absorbed : TOTAL;
  }

  // Packets already on their way.
  get pending() {
    return this.streams.reduce((n, st) => n + st.packets - st.arrived, 0);
  }

  goto(index) {
    this.phaseIndex = index;
    this.phaseTime = 0;
    const p = this.phase;
    if (p.type === 'wave') {
      const a = this.rand() * Math.PI * 2;
      this.sources = [a, a + Math.PI + (this.rand() - 0.5) * 1.2];
      this.emitTimer = 0.15;
    } else if (p.type === 'recurse') {
      this.startRecursion();
    }
  }

  next() {
    this.goto((this.phaseIndex + 1) % SCRIPT.length);
  }

  update(dt) {
    this.time += dt;
    this.phaseTime += dt;
    const m = this.motion;

    this.spin *= Math.exp(-dt * 2.5);
    this.yaw += (0.14 * m + this.spin) * dt;
    this.breathPhase += dt * ((2 * Math.PI) / BREATH_PERIOD);
    this.breathWave = Math.sin(this.breathPhase) * m;
    this.bob = 0.55 * Math.sin((this.time * 2 * Math.PI) / 7.3) * m;

    if (this.phase.type === 'melt') {
      this.L = 1 - easeSine(this.phaseTime / this.phase.dur);
      this.Lv = 0;
    } else {
      // Critically damped spring: each absorbed signal nudges the shape, never snaps it.
      const target = this.learning ? this.absorbed / TOTAL : 1;
      const w = 2.4;
      this.Lv += (w * w * (target - this.L) - 2 * w * this.Lv) * dt;
      this.L = clamp01(this.L + this.Lv * dt);
    }
    this.shape = shapeAt(this.L);
    this.flow += dt * this.shape.flow * m;

    this.direct(dt);
    this.updateStreams();
    this.updateEchoes();

    this.lattice = 1 + 0.022 * this.fx.breathScale * this.breathWave;
    this.shadowSize = this.hero.visible
      ? Math.max(CUBE_HALF * (1 - this.fx.dissolve), this.hero.half)
      : this.shape.size;
  }

  direct(dt) {
    const p = this.phase;
    switch (p.type) {
      case 'hold':
        if (this.absorbed >= TOTAL) this.goto(FORMED);
        else if (this.phaseTime >= p.dur) this.next();
        break;
      case 'wave': {
        if (this.absorbed >= p.target) {
          this.next();
          break;
        }
        // Two sources per wave, alternating, so the streams arrive as pairs of bundles.
        this.emitTimer -= dt;
        const missing = p.target - this.absorbed - this.pending;
        if (missing > 0 && this.emitTimer <= 0) {
          this.streamFromEdge(this.sources[this.spawned++ % 2], Math.min(PACKETS_PER_STREAM, missing), 0.15);
          this.emitTimer = 0.3 + this.rand() * 0.15;
        }
        break;
      }
      case 'formed':
        this.listenTimer -= dt;
        if (this.listenTimer <= 0 && this.phaseTime > 1.5 && this.phaseTime < p.dur - 1) {
          this.listen();
          this.listenTimer = 1.8 + this.rand() * 1.2;
        }
        if (this.phaseTime >= p.dur) this.next();
        break;
      case 'recurse':
        this.updateRecursion();
        if (this.phaseTime >= p.dur) {
          this.finishRecursion();
          this.next();
        }
        break;
      case 'melt':
        this.fx.breathScale = smoothstep(0, p.dur, this.phaseTime);
        if (this.phaseTime >= p.dur) {
          this.L = 0;
          this.Lv = 0;
          this.next();
        }
        break;
    }
  }

  // ---- streams -----------------------------------------------------------

  toLocal(world, out) {
    out.copy(world);
    out.y -= this.bob;
    return rotY(out, -this.yaw);
  }

  toLocalDir(world, out) {
    return rotY(out.copy(world), -this.yaw);
  }

  streamFromEdge(angle, packets, spread) {
    const a = angle + (this.rand() - 0.5) * 2 * spread;
    const cx = Math.cos(a);
    const cy = Math.sin(a);
    const { halfW, halfH, offsetX } = this.view;
    const reach = 1 / Math.max(Math.abs(cx) / halfW, Math.abs(cy) / halfH) + 5; // just past the viewport edge
    _w.copy(this.look)
      .addScaledVector(this.camRight, offsetX + cx * reach)
      .addScaledVector(this.camUp, cy * reach)
      .addScaledVector(this.camBack, (this.rand() - 0.5) * 16);
    const start = this.toLocal(_w, new THREE.Vector3());
    const camLocal = this.toLocalDir(this.camBack, _v);
    const dir = start
      .clone()
      .normalize()
      .multiplyScalar(0.55)
      .addScaledVector(camLocal, 0.8)
      .add(randomUnit(this.rand, _n).multiplyScalar(0.35))
      .normalize();
    this.openStream(start, dir, packets, false);
  }

  // Click or tap: a short stream is drawn from the pointer into the form.
  feedAt(ndcX, ndcY) {
    if (!this.accepting) return false;
    const point = new THREE.Vector3(ndcX, ndcY, -1).unproject(this.camera);
    _w.set(0, this.bob, 0);
    point.addScaledVector(this.camBack, -_v.copy(point).sub(_w).dot(this.camBack));
    const aim = this.toLocal(point, new THREE.Vector3());
    const start = this.toLocal(point.addScaledVector(this.camBack, 22), new THREE.Vector3());
    const dir = aim.addScaledVector(this.toLocalDir(this.camBack, _v), 14).normalize();
    this.openStream(start, dir, 2, true);
    return true;
  }

  feed() {
    if (!this.accepting) return false;
    this.streamFromEdge(this.rand() * Math.PI * 2, PACKETS_PER_STREAM, 0.35);
    return true;
  }

  openStream(start, dir, packets, near) {
    const pitch = near ? NEAR_PITCH : EDGE_PITCH;
    const st = {
      start,
      c1: start
        .clone()
        .multiplyScalar(0.7)
        .add(randomUnit(this.rand).multiplyScalar(near ? 4 : 9)),
      // the landing point drifts a little while data flows, smearing its mark
      dirA: dir.clone(),
      dirB: dir.clone().add(randomUnit(this.rand).multiplyScalar(0.3)).normalize(),
      dir: dir.clone(),
      target: new THREE.Vector3(),
      t0: this.time,
      near,
      packets,
      pitch,
      count: LEAD + (packets - 1) * pitch + 1 + TAIL,
      arrived: 0,
      connected: false,
      seed: Math.floor(this.rand() * 1000),
      pts: new Float32Array((SAMPLES + 1) * 3),
      lens: new Float32Array(SAMPLES + 1),
      length: 0,
    };
    this.trace(st);
    this.streams.push(st);
  }

  // Re-fit the stream's curve to wherever the surface is now, and measure it.
  trace(st) {
    st.dir.lerpVectors(st.dirA, st.dirB, smoothstep(0, 3, this.time - st.t0)).normalize();
    this.targetFor(st.dir, st.target);
    _c2.copy(st.target).addScaledVector(this.approachNormal(st.dir, _n), st.near ? 7 : 10);
    const { pts, lens } = st;
    let length = 0;
    for (let i = 0; i <= SAMPLES; i++) {
      bezier(st.start, st.c1, _c2, st.target, i / SAMPLES, _v);
      if (i > 0) length += Math.hypot(_v.x - pts[i * 3 - 3], _v.y - pts[i * 3 - 2], _v.z - pts[i * 3 - 1]);
      pts[i * 3] = _v.x;
      pts[i * 3 + 1] = _v.y;
      pts[i * 3 + 2] = _v.z;
      lens[i] = length;
    }
    st.length = length;
  }

  pointAt(st, s, out) {
    const { lens, pts } = st;
    let lo = 0;
    let hi = SAMPLES;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (lens[mid] < s) lo = mid;
      else hi = mid;
    }
    const f = clamp01((s - lens[lo]) / (lens[hi] - lens[lo] || 1));
    return out.set(
      pts[lo * 3] + (pts[hi * 3] - pts[lo * 3]) * f,
      pts[lo * 3 + 1] + (pts[hi * 3 + 1] - pts[lo * 3 + 1]) * f,
      pts[lo * 3 + 2] + (pts[hi * 3 + 2] - pts[lo * 3 + 2]) * f,
    );
  }

  // Arc length of a stream's first element; element j sits j * SPACING behind it.
  headOf(st) {
    return FLOW_SPEED * (this.time - st.t0);
  }

  // Where data enters: just under the surface along `dir`.
  targetFor(dir, out) {
    const sh = this.shape;
    const dist = surfaceDistance(dir, sh.size, sh.round) - (sh.noiseAmp * 0.8 + 0.5);
    return out.copy(dir).multiplyScalar(Math.max(dist, 1));
  }

  // Streams dive straight in while the form is a blob and meet it face-on once it has faces.
  approachNormal(dir, out) {
    const ax = Math.abs(dir.x);
    const ay = Math.abs(dir.y);
    const az = Math.abs(dir.z);
    out.set(0, 0, 0);
    if (ax >= ay && ax >= az) out.x = Math.sign(dir.x);
    else if (ay >= az) out.y = Math.sign(dir.y);
    else out.z = Math.sign(dir.z);
    return out.lerp(dir, 1 - smoothstep(0.35, 0.85, this.L)).normalize();
  }

  updateStreams() {
    for (let i = this.streams.length - 1; i >= 0; i--) {
      const st = this.streams[i];
      this.trace(st);
      const head = this.headOf(st);
      if (!st.connected && head >= st.length) {
        st.connected = true;
        if (this.accepting) this.addRipple(st.target, 0.45);
      }
      while (st.arrived < st.packets && head - (LEAD + st.arrived * st.pitch) * SPACING >= st.length) {
        st.arrived++;
        this.arrive(st);
      }
      if (head - (st.count - 1) * SPACING >= st.length) this.streams.splice(i, 1);
    }
  }

  arrive(st) {
    if (!this.accepting) return;
    this.addRipple(st.target, 0.85);
    this.addBump(st.target, 0.5 * (1 - 0.5 * this.L));

    // Self-recursion: the more it has learned, the more each signal echoes
    // through mirrored copies of itself.
    const depth = this.phase.type === 'formed' ? 1 : Math.min(3, Math.floor(this.L * 3.2));
    const d = st.dir.clone();
    for (let k = 1; k <= depth; k++) {
      if (k % 2) d.x = -d.x;
      else d.z = -d.z;
      this.echoes.push({ at: this.time + 0.28 * k, dir: d.clone(), strength: 0.7 * 0.72 ** (k - 1) });
    }

    if (this.learning && this.absorbed < TOTAL) {
      this.absorbed++;
      if (this.absorbed >= TOTAL) this.goto(FORMED);
    }
  }

  updateEchoes() {
    for (let i = this.echoes.length - 1; i >= 0; i--) {
      const e = this.echoes[i];
      if (this.time < e.at) continue;
      this.echoes.splice(i, 1);
      if (this.accepting) this.addRipple(this.targetFor(e.dir, _w), e.strength);
    }
  }

  // While formed, a faint ripple now and then shows it is still listening.
  listen() {
    const dir = this.toLocalDir(this.camBack, new THREE.Vector3()).add(randomUnit(this.rand, _n).multiplyScalar(0.7)).normalize();
    this.addRipple(this.targetFor(dir, _w), 0.35);
  }

  addRipple(p, strength) {
    this.ripples[this.rippleHead].set(p.x, p.y, p.z, this.time);
    this.rippleStrength[this.rippleHead] = strength;
    this.rippleHead = (this.rippleHead + 1) % MAX_RIPPLES;
  }

  addBump(p, strength) {
    this.bumps[this.bumpHead].set(p.x, p.y, p.z, this.time);
    this.bumpStrength[this.bumpHead] = strength;
    this.bumpHead = (this.bumpHead + 1) % MAX_BUMPS;
  }

  // ---- recursion ---------------------------------------------------------
  // The corner cube nearest the viewer grows into the whole form while everything
  // else dissolves. At SWAP it hands over to a fresh field that looks identical,
  // which then reveals its own grid and melts back into a blob.

  startRecursion() {
    const cam = this.toLocalDir(this.camBack, _v);
    this.hero.cell.set(cam.x < 0 ? -9.5 : 9.5, 9.5, cam.z < 0 ? -9.5 : 9.5);
    this.fx.dissolveOrigin.copy(this.hero.cell);
    this.fx.monoTone = 0;
    this.L = 1;
    this.Lv = 0;
    this.shape = shapeAt(1);
  }

  updateRecursion() {
    const t = this.phaseTime;
    const { fx, hero } = this;
    fx.breathScale = 1 - smoothstep(0, 0.6, t);
    if (t < SWAP) {
      const f = easeCubic(clamp01((t - 0.55) / 2.5));
      fx.dissolve = clamp01((t - 0.3) / 1.8) ** 2 * 1.06;
      fx.interiorCut = 99;
      hero.visible = true;
      hero.half = lerp(0.46, CUBE_HALF, f);
      hero.pos.copy(hero.cell).multiplyScalar(this.lattice * (1 - f));
      hero.edge = 1 - smoothstep(0, 0.25, f);
    } else {
      hero.visible = false;
      fx.dissolve = 0;
      fx.interiorCut = 3.2;
      fx.mono = 1;
      const g = easeCubic(clamp01((t - SWAP - 0.2) / 1.0));
      fx.gap = lerp(1, 0.9, g);
      fx.edge = g;
      fx.sweep = clamp01((t - SWAP - 0.8) / 1.5);
    }
  }

  finishRecursion() {
    Object.assign(this.fx, { mono: 0, sweep: 0, gap: 0.9, edge: 1, dissolve: 0, interiorCut: 3.2, breathScale: 0 });
    this.hero.visible = false;
    this.depth++;
    this.absorbed = 0;
    this.reseed();
  }

  // ---- output ------------------------------------------------------------

  // A stream reads as a black pixel line: thin and thick runs of cubes (the bit
  // pattern) flowing toward the form, with a coloured packet every `pitch` elements.
  eachBlock(push) {
    for (const st of this.streams) {
      const head = this.headOf(st);
      const first = Math.max(0, Math.ceil((head - st.length) / SPACING));
      const last = Math.min(st.count - 1, Math.floor(head / SPACING));
      const tailFrom = st.count - TAIL;
      for (let j = first; j <= last; j++) {
        const s = head - j * SPACING;
        const k = Math.round((j - LEAD) / st.pitch);
        const behind = k >= 0 && k < st.packets ? j - LEAD - k * st.pitch : Infinity; // > 0: trailing the packet
        if (behind < 0 && behind >= -PACKET_GAP) continue; // clear space ahead of each packet

        this.pointAt(st, s, _v);
        const grow = smoothstep(0, 1.2, s); // elements unfold out of the stream's source
        if (behind >= 0 && behind < PACKET_TRAIL.length) {
          // the packet, one of the five stripe colours, with a short trail of the same colour behind it
          const tone = Math.floor(hash(st.seed * 7 + k) * 5);
          push(_v, IDENTITY, PACKET_TRAIL[behind] * grow, KIND_BLOCK, tone - 0.15 * behind, behind === 0 ? 1 : 0);
          continue;
        }
        let size = j < 2 ? 0.6 : hash(st.seed + Math.floor(j / 3)) > 0.6 ? 0.48 : 0.26;
        if (j > tailFrom) size *= (st.count - j) / TAIL;
        push(_v, IDENTITY, size * grow, KIND_INK, 0, 0);
      }
    }
    if (this.hero.visible) {
      push(this.hero.pos, IDENTITY, this.hero.half * 2, KIND_BLOCK, this.fx.monoTone, this.hero.edge);
    }
  }
}
