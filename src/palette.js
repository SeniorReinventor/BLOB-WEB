import { Vector3 } from 'three';

// One warm ramp drives every coloured surface. Index 0 is a highlight, 1–5 are the
// yellow→red stripes, 6–7 are the shade tones used for the far faces and the gaps.
export const RAMP_HEX = [
  '#FFF3C4',
  '#FFD800',
  '#FFAF00',
  '#FF8205',
  '#FA500F',
  '#E10500',
  '#B00B0B',
  '#6A0A0A',
];

const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const RGB = RAMP_HEX.map(toRgb);

// Shaders output these values untouched, so on-screen colours match the CSS hexes.
export const rampUniform = () => RGB.map(([r, g, b]) => new Vector3(r, g, b));

// Same lookup as `ramp()` in GLSL: x runs from -1 (highlight) to 6 (deepest shade).
export function rampCss(x) {
  const t = Math.min(Math.max(x + 1, 0), RGB.length - 1);
  const i = Math.min(Math.floor(t), RGB.length - 2);
  const f = t - i;
  const [r, g, b] = RGB[i].map((c, k) => Math.round((c + (RGB[i + 1][k] - c) * f) * 255));
  return `rgb(${r} ${g} ${b})`;
}
