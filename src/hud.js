import { STAGES, TOTAL, PER_WAVE } from './sim.js';
import { rampCss } from './palette.js';

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const index = $('stage-index');
  const name = $('stage-name');
  const copy = $('stage-copy');
  const count = $('count');
  const depth = $('depth');
  const meter = $('meter');

  // One square per signal, grouped by wave, coloured along the same ramp as the form.
  const cells = [];
  for (let w = 0; w < TOTAL / PER_WAVE; w++) {
    const group = document.createElement('span');
    group.className = 'meter-wave';
    for (let i = 0; i < PER_WAVE; i++) {
      const cell = document.createElement('i');
      cell.style.setProperty('--fill', rampCss(((w * PER_WAVE + i) / (TOTAL - 1)) * 4));
      group.append(cell);
      cells.push(cell);
    }
    meter.append(group);
  }

  let shownStage = -1;
  let shownFill = -1;
  let shownDepth = -1;

  function update(sim) {
    const stage = sim.stage;
    if (stage !== shownStage) {
      shownStage = stage;
      index.textContent = String(stage).padStart(2, '0');
      name.textContent = STAGES[stage].name;
      copy.textContent = STAGES[stage].copy;
    }
    const fill = sim.filled;
    if (fill !== shownFill) {
      shownFill = fill;
      cells.forEach((c, i) => c.classList.toggle('on', i < fill));
      count.textContent = fill;
      meter.setAttribute('aria-valuenow', fill);
    }
    if (sim.depth !== shownDepth) {
      shownDepth = sim.depth;
      depth.textContent = `Recursion depth ${sim.depth}`;
    }
  }

  return { update };
}
