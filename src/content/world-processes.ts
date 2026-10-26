import { BIOME_BALANCE } from './biome-profiles';
import { plantProblem } from '../core/biome-ecology';
import { applyBiomeChange, biomeGrowthBlocked, collectBiomeChanges } from '../core/biome-spread';
import { lawEnabled } from '../core/world-rules';
import type { Registry } from './registry';
import { FOREST, treeProblem } from '../core/forestry';
import { isDamagedTerrain, LANDSCAPE_RECOVERY_RATE, recoveryDuration, recoveryStage } from '../core/terrain';
import { Terrain } from '../core/types';

/** Local balance preserves existing road/recovery/growth rates, not the wiki's intervals. */
export function registerWorldProcesses(registry: Registry): void {
  registry.registerWorldProcess({ id: 'core:biome-spread', phase: 'landscape', scope: 'biomes', intervalMonths: [BIOME_BALANCE.spreadMonths, BIOME_BALANCE.spreadMonths], budget: BIOME_BALANCE.spreadBudget,
    dependencies: { laws: ['biomes-overgrowth'], ages: [] },
    collect: (world, random) => collectBiomeChanges(world.terrain, Math.floor(random.next() * 0x100000000), world.registry.biomeClimate(world)),
    visit: applyBiomeChange,
  });
  registry.registerWorldProcess({ id: 'core:biome-fauna', phase: 'resources', scope: 'tiles', intervalMonths: [BIOME_BALANCE.faunaMonths, BIOME_BALANCE.faunaMonths], budget: BIOME_BALANCE.faunaSamples,
    dependencies: { laws: ['animal-spawn'], ages: [] },
    collect: (world, random) => [...new Set(Array.from({ length: BIOME_BALANCE.faunaSamples }, () => Math.floor(random.next() * world.terrain.tiles.length)))],
    visit: (world, index, random) => {
      const p = { x: index % world.terrain.width + 0.5, y: Math.floor(index / world.terrain.width) + 0.5 };
      const choices = world.terrain.biomeAt(p.x, p.y).ecology.creatures;
      if (!choices.length || !world.terrain.cell(p.x, p.y).plantable || !world.safeLand(p, 0.5) || !world.canStand(p, 0.5)
        || world.nearby(p, 10).some(e => e.components.animal || e.components.dwelling)) return;
      const species = choices[Math.floor(random.next() * choices.length)];
      if ([...world.query('animal')].filter(e => e.components.creature?.speciesId === species && e.components.animal!.villageId === null).length >= BIOME_BALANCE.wildSpeciesLimit) return;
      const definition = [...world.registry.entities.values()].find(d => d.speciesId === species);
      if (definition) world.spawn(definition.id, p, undefined, 'natural', [], undefined, random);
    },
  });
  registry.registerWorldProcess({ id: 'core:road-decay', phase: 'landscape', scope: 'tiles', intervalMonths: [0.05, 0.05], budget: 8192,
    dependencies: { laws: [], ages: [] },
    collect: world => [...world.terrain.roadTiles].sort((a, b) => a - b),
    visit: (world, index) => world.terrain.ageRoad(index),
  });
  registry.registerWorldProcess({ id: 'core:burned-tiles', phase: 'landscape', scope: 'tiles', intervalMonths: [0.05 / LANDSCAPE_RECOVERY_RATE, 0.05 / LANDSCAPE_RECOVERY_RATE], budget: 4096,
    dependencies: { laws: ['grow-grass'], ages: [] },
    collect: world => [...world.terrain.recovery.keys()].sort((a, b) => a - b),
    visit: (world, index) => {
      const terrain = world.terrain, state = terrain.recovery.get(index), tile = terrain.tiles[index];
      if (!state || !isDamagedTerrain(tile) || biomeGrowthBlocked(world.registry.biomeClimate(world))) return;
      const x = index % terrain.width, y = Math.floor(index / terrain.width), point = { x: x + 0.5, y: y + 0.5 };
      const burning = world.nearby(point, 1.5).some(entity => entity.components.thermal?.burning);
      const previousStage = recoveryStage(tile, state.age);
      state.age = burning ? 0 : state.age + 1;
      if (state.age >= recoveryDuration(tile, x, y, world.seed)) terrain.set(x, y, tile === Terrain.Crater ? Terrain.Scorched : state.target);
      else if (previousStage !== recoveryStage(tile, state.age)) terrain.dirty.add(index);
    },
  });
  registry.registerWorldProcess({ id: 'core:tree-growth', phase: 'resources', scope: 'entities', intervalMonths: [0.05, 0.05], budget: 256,
    dependencies: { laws: ['trees-growth'], ages: [] },
    collect: world => [...world.query('tree', 'position')].filter(entity => entity.components.tree!.age < FOREST.mature).map(entity => entity.id).sort((a, b) => a - b),
    visit: (world, id) => {
      const entity = world.entities.get(id), c = entity?.components;
      if (entity?.typeId !== 'core:tree' || !c?.tree || !c.position || c.person || c.animal || c.motion || c.thermal?.burning
        || plantProblem(world, c.position, c.tree.profile) || biomeGrowthBlocked(world.registry.biomeClimate(world))) return;
      c.tree.age = Math.min(FOREST.mature, c.tree.age + (lawEnabled(world, 'fast-trees-growth') ? 5 : 1));
    },
  });
  // Four attempts per ~ten seconds, as before; timing and work RNG are now isolated.
  registry.registerWorldProcess({ id: 'core:spread-vegetation', phase: 'resources', scope: 'samples', intervalMonths: [0.45, 0.55], budget: 20,
    dependencies: { laws: ['random-seeds', 'trees-growth'], ages: [] },
    collect: (world, random) => {
      const trees = [...world.query('tree', 'position')].sort((a, b) => a.id - b.id);
      return trees.length ? Array.from({ length: lawEnabled(world, 'fast-trees-growth') ? 20 : 4 }, () => trees[Math.floor(random.next() * trees.length)].id) : [];
    },
    visit: (world, id, random) => {
      const parent = world.entities.get(id);
      if (!parent?.components.position || treeProblem(parent) || plantProblem(world, parent.components.position, parent.components.tree!.profile)
        || biomeGrowthBlocked(world.registry.biomeClimate(world))) return;
      const a = random.range(0, Math.PI * 2), r = random.range(2.5, 6), origin = parent.components.position;
      const p = { x: origin.x + Math.cos(a) * r, y: origin.y + Math.sin(a) * r };
      if (plantProblem(world, p, parent.components.tree!.profile) || !world.canStand(p, 1.2)
        || world.nearby(p, 4).some(e => e.components.building || e.components.person)
        || world.nearby(p, FOREST.densityRadius).filter(e => e.components.tree).length >= Math.floor(FOREST.maxDensity * (lawEnabled(world, 'high-flora-density') ? 1.5 : 1))) return;
      const child = world.spawn('core:tree', p, 'natural', 'natural', [], undefined, random);
      if (child) { child.components.tree!.profile = parent.components.tree!.profile; child.components.tree!.biome = parent.components.tree!.biome; }
    },
  });
}
