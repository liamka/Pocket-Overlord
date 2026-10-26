import { isAdult } from '../core/unit-stats';
import type { Entity } from '../core/types';
import type { World } from '../core/world';
import { raceOf } from '../core/races';
import { startConstruction } from './construction';
import { unsafe } from './emergencies';

/** Ruins keep the former home's identity even after all residents have left. */
export { destroyBuilding as destroyHome } from '../core/buildings';

/** Survivors first seek shelter; a safe abandoned plot can then be rebuilt in place. */
export function rebuildHome(world: World, builder: Entity): Entity | undefined {
  const person = builder.components.person!, citizen = builder.components.citizen!, p = builder.components.position!;
  if (!isAdult(builder) || !person.displaced || world.tick - person.displaced.since < 600 || citizen.emergency) return;
  const ruin = [...world.query('ruin', 'position')].find(e => e.components.ruin!.homeId === person.displaced!.homeId
    && raceOf(builder) === e.components.ruin!.race && Math.hypot(p.x - e.components.position!.x, p.y - e.components.position!.y) < 22);
  if (!ruin) return;
  const q = ruin.components.position!, state = ruin.components.ruin!;
  if (!world.safeLand(q, 1.3) || unsafe(world, q) || !world.canStand(q, 1.3, ruin.id)) return;
  const house = startConstruction(world, q, builder, ruin);
  if (!house) return;
  house.components.dwelling!.capacity = state.capacity;
  house.components.dwelling!.villageId = citizen.villageId;
  house.components.appearance!.variant = ruin.components.appearance!.variant;
  world.remove(ruin.id);
  return house;
}
