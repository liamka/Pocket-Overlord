import { hasPhysiology } from './physiology';
import { cancelJob } from './jobs';
import { aboardFerry, releaseUnavailableFerries } from './ferries';
import type { World } from './world';
import type { Entity, Vec2 } from './types';
import { canMove } from './creatures';
import { touchesGround } from './capabilities';
import { geohazards, poolRadius, VOLCANO } from './geohazards';
import { hasTrait } from './traits';
import { reconcileStats } from './unit-stats';
import { destroyHome } from '../systems/recovery';

/** Reads existing object/resource/hazard owners; a tile never owns a second food or lava stock. */
export function worldCell(world: World, point: Vec2, actor?: Entity) {
  const mode = actor && canMove(world.registry, actor, 'fly') ? 'fly' : actor?.components.ship ? 'sail'
    : actor && world.terrain.isOpenWater(point.x, point.y) && canMove(world.registry, actor, 'swim') ? 'swim' : 'walk';
  const cell = world.terrain.cell(point.x, point.y, { mode, swampAdapted: !!actor && hasPhysiology(actor, 'swamp-adaptation'), desertAdapted: !!actor && hasPhysiology(actor, 'desert-adaptation'), frostAdapted: !!actor && hasPhysiology(actor, 'permafrost-adaptation') });
  const poolLava = (geohazards(world)?.lava ?? []).some(pool => pool.remaining >= 2
    && Math.hypot(pool.x - point.x, pool.y - point.y) < poolRadius(pool));
  const lava = !!cell.lavaStage || poolLava;
  const objects = world.nearby(point, 2).filter(e => {
    const p = e.components.position!; return world.terrain.index(p.x, p.y) === world.terrain.index(point.x, point.y);
  });
  const field = objects.find(e => e.components.farm), solid = objects.find(e => e.components.solid);
  return { ...cell, lava, objects, field,
    movement: { ...cell.movement, speed: lava && mode !== 'fly' ? Math.min(cell.movement.speed, 0.2) : cell.movement.speed * (mode === 'swim' && actor && hasPhysiology(actor, 'fins') ? 1.6 : 1) },
    damagePerSecond: mode === 'fly' ? 0 : poolLava ? VOLCANO.damage : cell.lavaStage ? VOLCANO.damage * cell.lavaStage / 4 : cell.damagePerSecond,
    buildable: cell.buildable && !solid && !lava,
    buildReason: lava ? 'Dangerous ground.' : solid ? 'An object occupies this cell.' : cell.buildReason,
    harvest: field ? { entityId: field.id, amount: field.components.farm!.grain ?? 0 } : null,
  };
}

/** Called synchronously after a completed terrain edit, before commands, saves or paths can observe it. */
export function reconcileTileChanges(world: World, indices: ReadonlySet<number>): void {
  releaseUnavailableFerries(world);
  const map = world.terrain, affected = (p: Vec2) => indices.has(map.index(p.x, p.y));
  const routeAffected = (start: Vec2, path: Vec2[]): boolean => {
    if (affected(start) || path.some(affected)) return true;
    // Ferry paths contain the banks, not the intervening water cells.
    let from = start;
    for (const to of path) {
      const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) * 2);
      for (let i = 1; i < steps; i++) if (affected({ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps })) return true;
      from = to;
    }
    return false;
  };
  for (const e of [...world.query('position')]) {
    const c = e.components, p = c.position!;
    if (affected(p)) {
      const cell = map.cell(p.x, p.y);
      if ((c.dwelling || c.temple) && !cell.buildable) { destroyHome(world, e); continue; }
      if ((c.tree || c.farm) && (!cell.land || cell.elevation >= 3 || cell.top?.startsWith('wall-') || cell.top === 'grey-goo')
        || (c.ruin || c.harbor || c.workplace || c.stockpile) && !cell.buildable) { world.remove(e.id); continue; }
    }
    if (c.citizen?.repair && c.citizen.repair.remaining > 0 && indices.has(c.citizen.repair.tile)) cancelJob(world, e, 'Target is no longer available');
    if (c.citizen && routeAffected(p, c.citizen.path) && !aboardFerry(world, e.id)) { c.citizen.path = []; c.citizen.reconsiderIn = 0; }
    if (c.citizen?.emergency?.path.some(affected)) { c.citizen.emergency.path = []; c.citizen.emergency.reconsiderIn = 0; }
    if (c.animal?.path.some(affected)) { c.animal.path = []; c.animal.decisionIn = 0; }
    // Empty transport routes mean arrival to their owners. Retain the destination and cargo;
    // their next movement validates the changed surface and replans through the same pathfinder.
    if (c.caravan && routeAffected(p, c.caravan.path.slice(c.caravan.next))) { c.caravan.retryIn = 0; c.caravan.reroute = true; }
    if (c.ship?.path.some(affected) || affected(p) && c.ship) { c.ship!.speed = 0; c.ship!.wait = 0; }
  }
}

/** Exactly one roll per crossed cell, never for standing still, UI repaint, or load. */
export function enterTile(world: World, e: Entity, previous: Vec2): void {
  const p = e.components.position, age = e.components.stats;
  if (world.paused || !p || !age || !touchesGround(world.registry, e)
    || world.terrain.index(previous.x, previous.y) === world.terrain.index(p.x, p.y)) return;
  const action = world.terrain.cell(p.x, p.y).entry;
  if (action && !hasTrait(e, 'immortal') && world.rng.next() < action.chance) {
    age.ageOvergrowth = Math.min(1e6, age.ageOvergrowth + action.years); reconcileStats(world, e);
  }
}
