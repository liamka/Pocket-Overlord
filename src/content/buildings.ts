import type { Registry } from './registry';
import { ARCHITECTURES, BUILDINGS, buildingOwner, cancelBuildingProject, newBuilding, setBuildingOwner, type Building } from '../core/buildings';
import { requestBuildingWork } from '../systems/construction';
import { bool, integer, number, record } from '../core/validation';
import { validBundle } from '../core/resources';

declare module '../core/types' { interface ComponentMap { building: Building } }

export function registerBuildings(registry: Registry): void {
  registry.registerComponent('building', b => typeof b.kind === 'string' && Object.hasOwn(BUILDINGS, b.kind)
    && typeof b.architecture === 'string' && Object.hasOwn(ARCHITECTURES, b.architecture) && integer(b.level, 1, 2)
    && ['planned', 'reserved', 'construction', 'active', 'damaged', 'abandoned', 'ruined'].includes(String(b.state))
    && (b.project === undefined || record(b.project) && ['build', 'upgrade', 'repair', 'clear'].includes(String(b.project.action))
      && number(b.project.progress, 0, 1) && integer(b.project.struckAt, -1) && bool(b.project.paid) && validBundle(b.project.cost)
      && (b.project.legacyGoldCost === undefined || b.project.legacyGoldCost === true)));
  for (const [id, definition] of registry.entities) {
    const profile = BUILDINGS[id];
    if (!profile && id !== 'core:ruin') continue;
    const create = definition.create;
    definition.create = (p, rng) => {
      const c = create(p, rng);
      c.building = newBuilding(id === 'core:ruin' ? 'core:house' : id);
      if (id === 'core:ruin') c.building.state = 'ruined';
      else {
        c.health = { current: profile.health, max: profile.health };
        c.combustible = { fuel: profile.fuel, ignition: profile.ignition };
        if (c.harbor) c.harbor.built = 1;
      }
      return c;
    };
    if (definition.required) definition.required = [...definition.required, 'building'];
  }
  for (const clear of [false, true]) registry.registerTool({
    id: clear ? 'core:clear-ruins' : 'core:cancel-construction', category: 'buildings',
    label: clear ? 'Clear ruins' : 'Cancel construction',
    hint: clear ? 'Residents clear a ruined plot. No materials are recovered.' : 'Cancel unfinished work. Unspent materials are released; paid materials are not refunded.',
    radius: 1.5, color: '#c4a476', icon: { pixels: ['x.....x', '.x...x.', '..x.x..', '...x...', '..x.x..', '.x...x.', 'x.....x'], palette: { x: '#c4a476' }, anchor: { x: 3, y: 3 } },
    apply: (world, p) => {
      const site = world.nearby(p, 1.5).filter(e => e.components.building && (clear ? e.components.ruin : e.components.building.project))
        .sort((a, b) => Math.hypot(a.components.position!.x - p.x, a.components.position!.y - p.y) - Math.hypot(b.components.position!.x - p.x, b.components.position!.y - p.y))[0];
      if (!site) return clear ? 'Choose ruins to clear' : 'Choose unfinished work';
      if (!clear) { cancelBuildingProject(world, site); return; }
      if (!world.society.villages.some(v => v.id === buildingOwner(site))) {
        const owner = world.society.villages.filter(v => Math.hypot(v.x - p.x, v.y - p.y) <= 24)
          .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
        if (!owner) return 'No builder can reach this site';
        setBuildingOwner(site, owner.id);
      }
      requestBuildingWork(world, site, 'clear');
    },
  });
}
