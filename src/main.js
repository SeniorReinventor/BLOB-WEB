import * as THREE from 'three';
import { Sim } from './sim.js';
import { createField } from './field.js';
import { createBlocks } from './blocks.js';
import { createShadow } from './shadow.js';
import { createHud } from './hud.js';
import { rampUniform } from './palette.js';

const params = new URLSearchParams(location.search);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = document.getElementById('scene');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch (err) {
  document.body.classList.add('no-webgl');
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);

// Fixed 2:1 pixel-art projection (30° elevation); the form turns, the camera doesn't.
const LOOK = new THREE.Vector3(0, -3, 0);
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 600);
camera.position
  .copy(LOOK)
  .addScaledVector(new THREE.Vector3(1, Math.SQRT2 * Math.tan(Math.PI / 6), 1).normalize(), 220);
camera.lookAt(LOOK);

const ramp = rampUniform();
const field = createField(ramp);
const blocks = createBlocks(ramp);
const shadow = createShadow();
const body = new THREE.Group(); // floats
const root = new THREE.Group(); // turns
body.add(field.mesh, blocks.mesh);
root.add(shadow.mesh, body);
const scene = new THREE.Scene();
scene.add(root);

const sim = new Sim({ camera, look: LOOK, reducedMotion });
const hud = createHud();

// On landscape screens the form keeps clear of the stage text in the lower left,
// sliding right (and shrinking if it must) instead of sitting under it.
const TEXT_COLUMN = 470; // px
const FORM_RADIUS = 17; // world units, widest the form gets on screen

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  const aspect = w / h;
  let halfH = Math.max(27, 23 / aspect);
  let shift = 0;
  if (aspect >= 1 && w > 720) {
    let ppu = h / (2 * halfH);
    if (TEXT_COLUMN + 2 * FORM_RADIUS * ppu > w - 32) {
      ppu = (w - 32 - TEXT_COLUMN) / (2 * FORM_RADIUS);
      halfH = h / (2 * ppu);
    }
    shift = Math.max(0, TEXT_COLUMN + FORM_RADIUS * ppu - w / 2) / ppu;
  }
  const halfW = halfH * aspect;
  camera.left = -halfW - shift;
  camera.right = halfW - shift;
  camera.top = halfH;
  camera.bottom = -halfH;
  camera.updateProjectionMatrix();
  sim.setView(halfW, halfH, -shift);
}
window.addEventListener('resize', resize);
resize();

// ---- controls --------------------------------------------------------------

const pauseButton = document.getElementById('pause');
let paused = false;
function setPaused(value) {
  paused = value;
  pauseButton.textContent = value ? 'Play' : 'Pause';
}

function feed(ndc) {
  const fed = ndc ? sim.feedAt(ndc.x, ndc.y) : sim.feed();
  if (fed) setPaused(false);
}

pauseButton.addEventListener('click', () => setPaused(!paused));
document.getElementById('restart').addEventListener('click', () => sim.reset());
document.getElementById('feed').addEventListener('click', () => feed());

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest('button')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    setPaused(!paused);
  } else if (e.key === 'f' || e.key === 'F') {
    feed();
  } else if (e.key === 'r' || e.key === 'R') {
    sim.reset();
  }
});

// Click to feed a signal at the pointer; drag to turn the form.
let pointer = null;
canvas.addEventListener('pointerdown', (e) => {
  pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastT: e.timeStamp, vel: 0, moved: false };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!pointer || e.pointerId !== pointer.id) return;
  if (Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) > 6) pointer.moved = true;
  if (pointer.moved) {
    const turn = (e.clientX - pointer.lastX) * 0.008;
    const dt = Math.max(e.timeStamp - pointer.lastT, 1) / 1000;
    sim.yaw += turn;
    sim.spin = 0;
    pointer.vel = pointer.vel * 0.6 + (turn / dt) * 0.4;
  }
  pointer.lastX = e.clientX;
  pointer.lastT = e.timeStamp;
});
canvas.addEventListener('pointerup', (e) => {
  if (!pointer || e.pointerId !== pointer.id) return;
  if (pointer.moved) {
    sim.spin = Math.max(-4, Math.min(4, pointer.vel));
  } else {
    const r = canvas.getBoundingClientRect();
    feed({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: 1 - ((e.clientY - r.top) / r.height) * 2 });
  }
  pointer = null;
});
canvas.addEventListener('pointercancel', () => {
  pointer = null;
});

// ?at=<seconds> starts part-way through the cycle; add &freeze to hold that frame.
const startAt = parseFloat(params.get('at'));
if (startAt > 0) for (let t = 0; t < startAt; t += 1 / 60) sim.update(1 / 60);
if (params.has('freeze')) setPaused(true);

// ---- loop ------------------------------------------------------------------

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (!paused) sim.update(dt);

  root.rotation.y = sim.yaw;
  body.position.y = sim.bob;
  field.apply(sim);
  blocks.apply(sim);
  shadow.apply(sim);
  hud.update(sim);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
