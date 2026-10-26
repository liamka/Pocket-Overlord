import { record } from '../core/validation';
import { CLOUDS } from '../core/clouds';

/** Preserve old remaining lifetimes and cadence, without RNG, drops or rewards. */
export function migrateClouds(save: Record<string, unknown>): Record<string, unknown> {
  return { ...save, version: 70, scenarios: Array.isArray(save.scenarios) ? save.scenarios.map(s => {
    if (!record(s) || s.id !== CLOUDS.id || !record(s.state) || !Array.isArray(s.state.clouds)) return s;
    if (s.state.nextId !== undefined) return s;
    return { ...s, state: { nextId: s.state.clouds.length + 1, cursor: 0, clouds: s.state.clouds.map((c, index) => {
      if (!record(c)) return c;
      return { id: index + 1, type: 'lightning', size: 'big', x: c.x, y: c.y, remaining: c.remaining,
        dropIn: c.strikeIn, bolt: c.bolt, speed: 0.4, seed: (Number(save.seed) + index + 1) >>> 0,
        origin: 'manual', lastDrop: null, result: 'Waiting for precipitation' };
    }) } };
  }) : save.scenarios };
}
