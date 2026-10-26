import type { Registry } from './registry';
import { RACES, RACE_IDS, type RaceId } from '../core/races';
import { newCitizen, POPULATION_LIMIT, type Components, type Vec2 } from '../core/types';
import type { Random } from '../core/random';

const hints: Record<RaceId, string> = {
  human: 'Создайте человека на суше или в море. Вдали от берега он утонет.',
  elf: 'Spawn an elf. Elves are swift and long-lived, with leaf-roofed homes. They distrust orcs and dwarves.',
  orc: 'Spawn an orc. Orcs are strong, recover quickly and build rugged huts. They are hostile toward other peoples.',
  dwarf: 'Spawn a dwarf. Dwarves are sturdy, slow and long-lived. They build durable stone homes and distrust elves and orcs.',
};

/** Shared settlement body for any sapient species; species identity stays independent of race. */
export function createCivilComponents(race: RaceId, p: Vec2, rng: Random): Components {
  const stats = RACES[race];
  return {
    position: { ...p }, health: { current: stats.health, max: stats.health }, combustible: { fuel: 20, ignition: 35 },
    thermal: { temperature: 0, wetness: 0, burning: false },
    motion: { vx: 0, vy: 0, speed: stats.speed, heading: rng.range(0, Math.PI * 2), decisionIn: 0 },
    person: { race, age: 20, sex: rng.next() < 0.5 ? 'a' : 'b', homeId: null, buildIn: rng.range(5, 10) * stats.construction, reproduceIn: rng.range(20, 30) },
    citizen: newCitizen(), appearance: { variant: Math.floor(rng.range(0, 5)) },
  };
}

export function registerPeoples(registry: Registry): void {
  for (const race of RACE_IDS) {
    const stats = RACES[race];
    registry.registerEntity({ id: stats.entityId, sprite: 'person', create: (p, rng) => createCivilComponents(race, p, rng) });
    registry.registerTool({ id: `core:${race}`, category: 'people', icon: race, label: stats.label, hint: hints[race], radius: 0.6,
      color: { human: '#a4d8ba', elf: '#9acb75', orc: '#7fa54e', dwarf: '#d6a878' }[race],
      creaturePlacement: (world, p) => {
        const point = world.findFreePosition(p, 0.6, !world.terrain.isLand(p.x, p.y));
        return point ? { typeId: stats.entityId, point } : undefined;
      },
      canApply: (world, p) => world.population < POPULATION_LIMIT && !!world.findFreePosition(p, 0.6, !world.terrain.isLand(p.x, p.y)),
      apply: (world, p) => {
        if (world.population >= POPULATION_LIMIT) return `На острове уже ${POPULATION_LIMIT} жителей`;
        const position = world.findFreePosition(p, 0.6, !world.terrain.isLand(p.x, p.y));
        if (!position) return 'Выберите свободное место на карте';
        if (!world.spawn(stats.entityId, position)) return 'В мире слишком много объектов';
      },
    });
  }
}
