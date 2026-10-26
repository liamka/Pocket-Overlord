import type { Registry } from './registry';
import { reference } from '../core/validation';
import type { Resistance } from '../core/stockpiles';
import { planBuilding, placementProblem } from '../systems/construction';

declare module '../core/types' {
  interface ComponentMap { stockpile: { villageId: number | null; resistance: Resistance } }
}
export function registerStockpiles(registry: Registry): void {
  registry.registerComponent('stockpile', s => reference(s.villageId) && ['ordinary', 'fireproof', 'acidproof'].includes(String(s.resistance)));
  for (const resistance of ['ordinary', 'fireproof', 'acidproof'] as const) {
    const id = resistance === 'ordinary' ? 'core:stockpile' : `core:stockpile-${resistance}`;
    const label = resistance === 'ordinary' ? 'Stockpile' : resistance === 'fireproof' ? 'Fireproof stockpile' : 'Acidproof stockpile';
    registry.registerEntity({ id, sprite: 'crate', create: p => ({ position: { ...p }, health: { current: 180, max: 180 },
      solid: { radius: 1.1 }, combustible: { fuel: 45, ignition: 38 }, thermal: { temperature: 0, wetness: 0, burning: false },
      stockpile: { villageId: null, resistance } }) });
    registry.registerTool({ id, label, category: 'buildings', icon: { pixels: ['...rrr...', '..rrrrr..', '.rrrrrrr.', 'wwwwwwwww', 'wbbbwbbbw', 'wbbbwbbbw', 'wwwwwwwww'],
      palette: { r: resistance === 'fireproof' ? '#c67b55' : resistance === 'acidproof' ? '#71ac91' : '#8c785d', w: '#c5a16b', b: '#66513c' }, anchor: { x: 4, y: 5 } }, radius: 1.5, color: '#c5a16b',
      hint: 'Stores delivered goods. Destruction loses all contents. Protection does not stop explosions.',
      apply: (world, p) => {
        const village = world.society.villages.filter(v => Math.hypot(v.x - p.x, v.y - p.y) <= 24)
          .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
        if (!village) return 'Place a stockpile near a settlement';
        const problem = placementProblem(world, id, p, village);
        if (problem) return problem;
        if (!planBuilding(world, id, p, village)) return 'В мире слишком много объектов';
      } });
  }
}
