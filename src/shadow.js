import * as THREE from 'three';

// A dithered, cell-aligned floor shadow that goes from round to square with the form.
const vertexShader = /* glsl */ `
varying vec2 vPos;
void main() {
  vPos = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform float uSize;
uniform float uSquare;
uniform float uStrength;
uniform vec3 uLight;
uniform vec3 uDark;
varying vec2 vPos;

float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

void main() {
  vec2 cell = floor(vPos) + 0.5;
  float m = mix(length(cell), max(abs(cell.x), abs(cell.y)), uSquare) / uSize;
  float a = (1.0 - smoothstep(0.3, 1.08, m)) * uStrength;
  float level = floor(a * 2.0 + bayer4(floor(vPos)));
  if (level < 1.0) discard;
  gl_FragColor = vec4(level >= 2.0 ? uDark : uLight, 1.0);
}
`;

const rgb = (hex) => new THREE.Vector3(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255));

export function createShadow() {
  const uniforms = {
    uSize: { value: 12.5 },
    uSquare: { value: 0 },
    uStrength: { value: 1 },
    uLight: { value: rgb('#F7EAC4') },
    uDark: { value: rgb('#EFDCA8') },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(64, 64), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -21;
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;

  function apply(sim) {
    uniforms.uSize.value = sim.shadowSize;
    uniforms.uSquare.value = sim.L * sim.L;
    uniforms.uStrength.value = 1 - sim.bob * 0.12;
  }

  return { mesh, apply };
}
