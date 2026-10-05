import * as THREE from 'three';
import { NOISE, SHADE, EDGE } from './shaders.js';
import { MAX_RIPPLES, MAX_BUMPS } from './sim.js';

// Every cube the system can ever occupy, one cell = one world unit.
const HALF_GRID = 20;
const OUTER = 19.5; // the noisiest blob never reaches past this
const INNER = 5; // ...and never gets thinner than this, so the core can be skipped

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

const vertexShader = /* glsl */ `
#define MAX_RIPPLES ${MAX_RIPPLES}
#define MAX_BUMPS ${MAX_BUMPS}

uniform float uTime;
uniform float uFlow;
uniform vec3 uSeed;
uniform float uSize;
uniform float uRound;
uniform float uNoiseAmp;
uniform float uNoiseFreq;
uniform float uBreath;
uniform float uLattice;
uniform float uChaos;
uniform float uDither;
uniform float uInteriorCut;
uniform float uDissolve;
uniform vec3 uDissolveOrigin;
uniform float uGap;
uniform float uMono;
uniform float uMonoTone;
uniform float uSweep;
uniform vec4 uRipples[MAX_RIPPLES];
uniform float uRippleS[MAX_RIPPLES];
uniform vec4 uBumps[MAX_BUMPS];
uniform float uBumpS[MAX_BUMPS];

attribute vec3 aCell;
attribute float aHash;
attribute float aBayer;

varying vec3 vFace;
varying vec3 vEdge;
varying vec2 vUv;

${NOISE}
${SHADE}

float sdRoundBox(vec3 p, float b, float r) {
  vec3 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

// Outward direction of the same rounded box, so half-grown cubes sit on the surface.
vec3 roundBoxNormal(vec3 p, float b, float r) {
  vec3 q = abs(p) - b + r;
  vec3 outside = max(q, 0.0);
  vec3 n;
  if (dot(outside, outside) > 1e-4) {
    n = normalize(outside);
  } else {
    n = q.x > q.y && q.x > q.z ? vec3(1.0, 0.0, 0.0) : (q.y > q.z ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0));
  }
  return n * sign(p);
}

void main() {
  vec3 p = aCell;
  float d = sdRoundBox(p, uSize, uRound) - uBreath;

  // Far from the surface the answer is known: skip the noise and impact loops.
  float reach = uNoiseAmp + 4.5;
  if (d > reach || d < -(reach + uInteriorCut)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  if (uNoiseAmp > 0.001) {
    vec3 q = p * uNoiseFreq + uSeed;
    float n = snoise(q + vec3(0.0, uFlow, 0.0)) * 0.7
            + snoise(q * 2.1 - vec3(uFlow * 1.3, 0.0, uFlow * 0.7)) * 0.3;
    d -= n * uNoiseAmp;
  }

  // Ripples: a ring of cubes that pushes out and lights up as it travels.
  float flash = 0.0;
  for (int i = 0; i < MAX_RIPPLES; i++) {
    float age = uTime - uRipples[i].w;
    if (age < 0.0 || age > 2.2) continue;
    float s = uRippleS[i];
    float dist = length(p - uRipples[i].xyz);
    float k = (dist - age * 12.0) / 1.5;
    float ring = exp(-k * k) * exp(-age * 1.6) * s;
    float core = exp(-dist * dist / 5.0) * exp(-age * 5.0) * s;
    d -= ring * 0.95;
    flash += ring + core * 1.4;
  }

  // Bumps: the slower mark a signal leaves before the shape absorbs it.
  for (int i = 0; i < MAX_BUMPS; i++) {
    float age = uTime - uBumps[i].w;
    if (age < 0.0 || age > 4.5) continue;
    vec3 off = p - uBumps[i].xyz;
    float env = smoothstep(0.0, 0.35, age) * exp(-age / 1.5);
    d -= uBumpS[i] * 2.4 * env * exp(-dot(off, off) / 18.0);
  }

  float v = smoothstep(0.32, -0.32, d);
  if (d < -uInteriorCut) v = 0.0;

  float thr = 0.12 + 0.6 * clamp(length(p - uDissolveOrigin) / 34.0, 0.0, 1.0) + 0.28 * aHash;
  v *= 1.0 - smoothstep(thr - 0.05, thr + 0.02, uDissolve);

  // Colour: five horizontal stripes that start scrambled and settle into order.
  float h = clamp(0.5 - 0.5 * p.y / uSize, 0.0, 0.999);
  float scramble = snoise(p * 0.11 + uSeed.zxy + vec3(0.0, uFlow * 0.4, 0.0));
  float band = clamp(floor(h * 5.0 + scramble * uChaos * 2.2 + (aBayer - 0.5) * uDither), 0.0, 4.0);
  float mono = uMono * (1.0 - smoothstep(-0.04, 0.04, uSweep * 1.25 - 0.12 - h + (aBayer - 0.5) * 0.1));
  float tone = mix(band, uMonoTone, mono);
  tone += clamp(-d - 0.6, 0.0, 3.0) * 0.55;
  tone -= min(flash, 1.5) * 1.3;

  vec3 nView = normalize(normalMatrix * normal);
  float shift = faceShift(normal, nView);
  vFace = ramp(tone + shift);
  vEdge = ramp(tone + shift + 0.9);
  vUv = uv;

  float size = v * uGap;
  vec3 anchor = roundBoxNormal(p, uSize, uRound) * (uGap - size) * 0.5;
  vec3 world = p * uLattice - anchor + position * size;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform float uEdge;
varying vec3 vFace;
varying vec3 vEdge;
varying vec2 vUv;

${EDGE}

void main() {
  gl_FragColor = vec4(mix(vFace, vEdge, edgeMask(vUv) * uEdge), 1.0);
}
`;

export function createField(ramp) {
  const cells = [];
  const hashes = [];
  const bayer = [];
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const mod4 = (n) => ((n % 4) + 4) % 4;

  for (let x = -HALF_GRID; x < HALF_GRID; x++) {
    for (let y = -HALF_GRID; y < HALF_GRID; y++) {
      for (let z = -HALF_GRID; z < HALF_GRID; z++) {
        const r = Math.hypot(x + 0.5, y + 0.5, z + 0.5);
        if (r > OUTER || r < INNER) continue;
        cells.push(x + 0.5, y + 0.5, z + 0.5);
        hashes.push(rand());
        bayer.push((BAYER4[mod4(x + 2 * z) + 4 * mod4(y + z)] + 0.5) / 16);
      }
    }
  }

  const box = new THREE.BoxGeometry(1, 1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = box.index;
  for (const name of ['position', 'normal', 'uv']) geometry.setAttribute(name, box.getAttribute(name));
  geometry.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(cells), 3));
  geometry.setAttribute('aHash', new THREE.InstancedBufferAttribute(new Float32Array(hashes), 1));
  geometry.setAttribute('aBayer', new THREE.InstancedBufferAttribute(new Float32Array(bayer), 1));
  geometry.instanceCount = hashes.length;

  const uniforms = {
    uRamp: { value: ramp },
    uTime: { value: 0 },
    uFlow: { value: 0 },
    uSeed: { value: new THREE.Vector3() },
    uSize: { value: 12.5 },
    uRound: { value: 12.5 },
    uNoiseAmp: { value: 0 },
    uNoiseFreq: { value: 0.085 },
    uBreath: { value: 0 },
    uLattice: { value: 1 },
    uChaos: { value: 1 },
    uDither: { value: 1 },
    uInteriorCut: { value: 3.2 },
    uDissolve: { value: 0 },
    uDissolveOrigin: { value: new THREE.Vector3() },
    uGap: { value: 0.9 },
    uEdge: { value: 1 },
    uMono: { value: 0 },
    uMonoTone: { value: 0 },
    uSweep: { value: 0 },
    uRipples: { value: [] },
    uRippleS: { value: null },
    uBumps: { value: [] },
    uBumpS: { value: null },
  };

  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  function apply(sim) {
    const u = uniforms;
    const { shape, fx } = sim;
    u.uTime.value = sim.time;
    u.uFlow.value = sim.flow;
    u.uSeed.value.copy(sim.seed);
    u.uSize.value = shape.size;
    u.uRound.value = shape.round;
    u.uNoiseAmp.value = shape.noiseAmp;
    u.uBreath.value = shape.breath * sim.breathWave;
    u.uLattice.value = sim.lattice;
    u.uChaos.value = shape.chaos;
    u.uDither.value = shape.dither;
    u.uInteriorCut.value = fx.interiorCut;
    u.uDissolve.value = fx.dissolve;
    u.uDissolveOrigin.value.copy(fx.dissolveOrigin);
    u.uGap.value = fx.gap;
    u.uEdge.value = fx.edge;
    u.uMono.value = fx.mono;
    u.uMonoTone.value = fx.monoTone;
    u.uSweep.value = fx.sweep;
    u.uRipples.value = sim.ripples;
    u.uRippleS.value = sim.rippleStrength;
    u.uBumps.value = sim.bumps;
    u.uBumpS.value = sim.bumpStrength;
  }

  return { mesh, apply, count: hashes.length };
}
