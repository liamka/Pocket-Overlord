import type { Registry } from './registry';
import { integer, point, record, reference } from '../core/validation';
import { buildingOwner } from '../core/buildings';
import { mineAnchor, MINE_OUTCOMES } from '../core/mines';
import { MINERAL_ENTITIES } from '../core/biome-minerals';
import { NATURAL_BIOMES } from '../core/natural-biomes';
import { territoryOwner } from '../core/territory';
import { planBuilding, placementProblem } from '../systems/construction';

export function registerMines(registry: Registry): void {
  registry.registerEvent({ kind: 'mine-explored', validate: e => integer(e.mineId, 1) && reference(e.villageId)
    && integer(e.tick) && reference(e.depositId) && (MINE_OUTCOMES as readonly unknown[]).includes(e.outcome),
    apply: (world, event) => world.registry.mineExplored(world, event) });
  registry.registerComponent('mine', m => reference(m.villageId) && point(m.anchor)
    && record(m.anchor) && integer(m.anchor.x) && integer(m.anchor.y)
    && (m.lastAttempt === undefined || record(m.lastAttempt) && integer(m.lastAttempt.tick)
      && (MINE_OUTCOMES as readonly unknown[]).includes(m.lastAttempt.outcome)
      && (m.lastAttempt.resource === undefined || typeof m.lastAttempt.resource === 'string' && Object.hasOwn(MINERAL_ENTITIES, m.lastAttempt.resource))));
  registry.registerComponent('mineOrigin', o => integer(o.mineId, 1) && point(o.anchor) && record(o.anchor)
    && integer(o.anchor.x) && integer(o.anchor.y) && integer(o.biome, 0, NATURAL_BIOMES.length - 1) && integer(o.createdAt));
  registry.registerEntity({ id: 'core:mine', sprite: 'house', create: p => ({
    position: { ...p }, health: { current: 300, max: 300 }, solid: { radius: 1.2 },
    thermal: { temperature: 0, wetness: 0, burning: false }, appearance: { variant: 0 },
    mine: { villageId: null, anchor: mineAnchor(p) },
  }) });
  registry.registerTool({ id: 'core:mine', category: 'buildings', label: 'Mine', radius: 2.5, color: '#aa9670',
    icon: { pixels: ['...ssss...', '..ssssss..', '.ssttttss.', 'sstddddtss', 'sstddddtss', 'sstddddtss', 'sstddddtss', 'ssssrrssss'],
      palette: { s: '#818578', t: '#b28a53', d: '#252c2b', r: '#c0bba6' }, anchor: { x: 5, y: 7 } },
    hint: 'Costs 15 gold. Up to five miners expose finite deposits after 2–3 months; other workers mine and deliver them.',
    apply: (world, p) => {
      const owner = territoryOwner(world, p);
      if (!owner) return 'Place a mine within settlement borders';
      const ruin = world.nearby(p, 2).find(e => e.components.ruin && e.components.building?.kind === 'core:mine'
        && buildingOwner(e) === owner.id && !e.components.building.project);
      const position = ruin?.components.position ?? p;
      const problem = placementProblem(world, 'core:mine', position, owner, ruin?.id);
      if (problem) return problem;
      if (!planBuilding(world, 'core:mine', position, owner, undefined, ruin)) return 'Mine needs a reachable entrance and room for deposits';
    },
  });
}
