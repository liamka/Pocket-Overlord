import type { Entity } from '../core/types';
import type { World } from '../core/world';
import { raceOf } from '../core/races';
import { startConstruction } from './construction';
import { unsafe } from './emergencies';

/** Ruins keep the former home's identity even after all residents have left. */
export function destroyHome(world: World, house: Entity): void {
  const p = house.components.position!, home = house.components.dwelling!;
  for (const resident of world.query('person')) if (resident.components.person!.homeId === house.id) {
    resident.components.person!.displaced = { homeId: house.id, since: world.tick };
  }
  world.remove(house.id);
  if (!world.terrain.isLand(p.x, p.y)) return;
  const ruin = world.spawn('core:ruin', p);
  if (!ruin) return;
  Object.assign(ruin.components.ruin!, { homeId: house.id, race: raceOf(house), villageId: home.villageId, capacity: home.capacity, destroyedAt: world.tick });
  ruin.components.appearance!.variant = house.components.appearance?.variant ?? 0;
}

/** Survivors first seek shelter; a safe abandoned plot can then be rebuilt in place. */
export function rebuildHome(world: World, builder: Entity): Entity | undefined {
  const person = builder.components.person!, citizen = builder.components.citizen!, p = builder.components.position!;
  if (person.age < 18 || !person.displaced || world.tick - person.displaced.since < 600 || citizen.emergency) return;
  const ruin = [...world.query('ruin', 'position')].find(e => e.components.ruin!.homeId === person.displaced!.homeId
    && raceOf(builder) === e.components.ruin!.race && Math.hypot(p.x - e.components.position!.x, p.y - e.components.position!.y) < 22);
  if (!ruin) return;
  const q = ruin.components.position!, state = ruin.components.ruin!;
  if (!world.safeLand(q, 1.3) || unsafe(world, q) || !world.canStand(q, 1.3, ruin.id)) return;
  const house = startConstruction(world, q, builder);
  if (!house) return;
  house.components.dwelling!.capacity = state.capacity;
  house.components.dwelling!.villageId = citizen.villageId;
  house.components.appearance!.variant = ruin.components.appearance!.variant;
  world.remove(ruin.id);
  return house;
}
