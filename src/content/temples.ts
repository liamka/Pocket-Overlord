import type { Registry } from './registry';
import { reference } from '../core/validation';
import { buildingOwner } from '../core/buildings';
import { territoryOwner } from '../core/territory';
import { planBuilding, placementProblem } from '../systems/construction';

declare module '../core/types' { interface ComponentMap { temple: { villageId: number | null } } }

/** New optional entity type: older saves gain no temple, supplies or housing awards. */
export function registerTemples(registry: Registry): void {
  registry.registerComponent('temple', c => reference(c.villageId));
  registry.registerEntity({ id: 'core:temple', sprite: 'house', create: p => ({
    position: { ...p }, health: { current: 1500, max: 1500 }, solid: { radius: 1.2 },
    thermal: { temperature: 0, wetness: 0, burning: false }, appearance: { variant: 0 }, temple: { villageId: null },
  }) });
  registry.registerTool({ id: 'core:temple', category: 'buildings', label: 'Temple', radius: 2.5, color: '#d0c6a3',
    icon: { pixels: ['....g....', '...rrr...', '..rrrrr..', '.rrrrrrr.', 'sssssssss', '.s.s.s.s.', '.s.s.s.s.', 'sssssssss'],
      palette: { g: '#edce7b', r: '#677e98', s: '#d0c6a3' }, anchor: { x: 4, y: 7 } },
    hint: 'Costs 10 gold, 10 stone and 2 common metal. Residents build one temple per settlement: +2 house plots. Fireproof.',
    apply: (world, p) => {
      const village = territoryOwner(world, p);
      if (!village) return 'Place a temple within settlement borders';
      const ruin = world.nearby(p, 2).find(e => e.components.ruin && e.components.building?.kind === 'core:temple'
        && buildingOwner(e) === village.id && !e.components.building.project);
      const point = ruin?.components.position ?? p;
      const problem = placementProblem(world, 'core:temple', point, village, ruin?.id);
      if (problem) return problem;
      if (!planBuilding(world, 'core:temple', point, village, undefined, ruin)) return 'No builder can reach this site';
    },
  });
}
