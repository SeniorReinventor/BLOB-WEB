import * as THREE from 'three';
import { SHADE, EDGE } from './shaders.js';

// Free-moving cubes: the data streams, and the single block that carries the
// finished form into the next cycle.
export const KIND_INK = 0;
export const KIND_BLOCK = 1;

const MAX = 1600;

const vertexShader = /* glsl */ `
attribute vec3 aOffset;
attribute vec4 aQuat;
attribute float aScale;
attribute vec3 aStyle; // kind, tone, edge strength

varying vec3 vFace;
varying vec3 vEdge;
varying vec2 vUv;
varying float vEdgeAmt;

${SHADE}

vec3 qrot(vec4 q, vec3 v) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

void main() {
  vec3 n = qrot(aQuat, normal);
  vec3 nView = normalize(normalMatrix * n);
  float shift = faceShift(n, nView);

  if (aStyle.x < 0.5) {
    float ink = mix(0.24, 0.0, clamp((shift + 0.6) / 1.5, 0.0, 1.0)) + aStyle.y;
    vFace = vec3(ink);
    vEdge = vec3(ink + 0.22);
  } else {
    vFace = ramp(aStyle.y + shift);
    vEdge = ramp(aStyle.y + shift + 0.9);
  }
  vEdgeAmt = aStyle.z;
  vUv = uv;

  vec3 pos = qrot(aQuat, position * aScale) + aOffset;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const fragmentShader = /* glsl */ `
varying vec3 vFace;
varying vec3 vEdge;
varying vec2 vUv;
varying float vEdgeAmt;

${EDGE}

void main() {
  gl_FragColor = vec4(mix(vFace, vEdge, edgeMask(vUv) * vEdgeAmt), 1.0);
}
`;

export function createBlocks(ramp) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = box.index;
  for (const name of ['position', 'normal', 'uv']) geometry.setAttribute(name, box.getAttribute(name));

  const attr = (size) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX * size), size);
    a.setUsage(THREE.DynamicDrawUsage);
    return a;
  };
  const offset = attr(3);
  const quat = attr(4);
  const scale = attr(1);
  const style = attr(3);
  geometry.setAttribute('aOffset', offset);
  geometry.setAttribute('aQuat', quat);
  geometry.setAttribute('aScale', scale);
  geometry.setAttribute('aStyle', style);
  geometry.instanceCount = 0;

  const material = new THREE.ShaderMaterial({ uniforms: { uRamp: { value: ramp } }, vertexShader, fragmentShader });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  let count = 0;
  const push = (pos, q, size, kind, tone, edge) => {
    if (count >= MAX || size <= 0) return;
    const i = count++;
    offset.setXYZ(i, pos.x, pos.y, pos.z);
    quat.setXYZW(i, q.x, q.y, q.z, q.w);
    scale.setX(i, size);
    style.setXYZ(i, kind, tone, edge);
  };

  function apply(sim) {
    count = 0;
    sim.eachBlock(push);
    geometry.instanceCount = count;
    for (const a of [offset, quat, scale, style]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, count * a.itemSize);
      a.needsUpdate = true;
    }
  }

  return { mesh, apply };
}
