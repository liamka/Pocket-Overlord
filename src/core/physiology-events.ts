import type { World } from './world';
import type { Entity } from './types';
import { hasPhysiology } from './physiology';
import { applyStatus } from './status-effects';
import { canUseEquipment, equippedItems, itemValue, relocateItem } from './equipment';
import { EQUIPMENT } from './equipment-catalog';
import { plantProblem } from './biome-ecology';

export function physiologyBirth(world: World, child: Entity, hatching = false): void {
  const p = child.components.position;
  const state = child.components.physiology;
  if (world.entities.get(child.id) !== child || !state || (hatching ? state.hatchApplied : state.birthApplied) || !p || world.paused || (child.components.health?.current ?? 0) <= 0) return;
  if (hatching) state.hatchApplied = true; else state.birthApplied = true;
  if (!hatching && child.components.reproduction?.egg) return;
  if (hasPhysiology(child, 'parental-care')) applyStatus(world, child, 'invincible', { seconds: 90 });
  if (hasPhysiology(child, 'spicy-kids') || hatching && hasPhysiology(child, 'flames-egg')) {
    const count = Math.floor(world.rng.next() * 6);
    for (let i = 0; i < count; i++) {
      const angle = world.rng.range(0, Math.PI * 2), q = { x: p.x + Math.cos(angle), y: p.y + Math.sin(angle) };
      world.events.push({ kind: 'tile-heat', ...q, radius: 0.5, amount: 80, sourceId: child.id, cause: 'fire' });
    }
  }
  if (hatching && hasPhysiology(child, 'ice-egg')) {
    const count = Math.floor(world.rng.next() * 21);
    for (let i = 0; i < count; i++) { const x = p.x + world.rng.range(-2, 2), y = p.y + world.rng.range(-2, 2); if (world.terrain.cell(x, y).land) world.terrain.setLayers(x, y, { frost: 'snow' }); }
  }
  if (hasPhysiology(child, 'gift-of-water')) applyStatus(world, child, 'shield', { seconds: 30 });
  if (hasPhysiology(child, 'gift-of-fire')) world.events.push({ kind: 'tile-heat', ...p, radius: 2, amount: 90, sourceId: child.id, cause: 'fire' });
  for (const [id, type] of [['gift-of-life', 'life'], ['gift-of-thunder', 'lightning']] as const) if (hasPhysiology(child, id))
    world.events.push({ kind: 'precipitation', ...p, type, seed: Math.floor(world.rng.next() * 0x100000000), player: false });
  if (hasPhysiology(child, 'gift-of-the-void')) for (let i = 0; i < 8; i++) {
    const q = { x: p.x + world.rng.range(-8, 8), y: p.y + world.rng.range(-8, 8) };
    if (world.safeLand(q, 0.3) && world.canStand(q, 0.3)) { p.x = q.x; p.y = q.y; world.spatial.update(child); break; }
  }
}
function growAfterDeath(world: World, dead: Entity, tree: boolean): boolean {
  const p = dead.components.position!;
  for (let i = 0; i < 8; i++) {
    const q = { x: p.x + Math.cos(i * Math.PI / 4) * 1.8, y: p.y + Math.sin(i * Math.PI / 4) * 1.8 };
    if (plantProblem(world, q) || !world.canStand(q, 0.7) || world.nearby(q, 1.5).some(e => e.components.building || e.components.farm || e.components.tree)) continue;
    if (tree) return !!world.spawn('core:tree', q, 'natural');
    if (!world.terrain.cell(q.x, q.y).top) return world.terrain.setLayers(q.x, q.y, { top: 'flower-light' });
  }
  return false;
}
/** World.die owns the once-only receipt. No handler calls die or transforms recursively. */
export function physiologyDeath(world: World, dead: Entity): void {
  if (hasPhysiology(dead, 'tree-growth')) growAfterDeath(world, dead, true);
  else if (hasPhysiology(dead, 'plant-growth')) growAfterDeath(world, dead, false);
  const p = dead.components.position;
  if (!p) return;
  // Gaia Roots is handled by the cloud owner in the same death transaction.
  if (hasPhysiology(dead, 'annoying-fireworks')) world.visual({ kind: 'fireworks', ...p, radius: 3 });
  if (hasPhysiology(dead, 'antimatter-essence')) world.events.push({ kind: 'blast', ...p, radius: 6, power: 250, heat: 0, cause: 'explosion', sourceId: dead.id });
}
export function nimbleHit(world: World, thief: Entity, victim: Entity): void {
  if (!hasPhysiology(thief, 'nimble') || !canUseEquipment(thief, world.registry) || !canUseEquipment(victim, world.registry)
    || !thief.components.position || !victim.components.position || Math.hypot(thief.components.position.x - victim.components.position.x, thief.components.position.y - victim.components.position.y) > 2.1) return;
  const own = equippedItems(world, thief.id).find(i => EQUIPMENT[i.definition].slot === 'weapon');
  if (own && EQUIPMENT[own.definition].attack?.projectile) return;
  const target = equippedItems(world, victim.id).filter(i => EQUIPMENT[i.definition].slot === 'weapon' && (!own || itemValue(i) > itemValue(own))).sort((a, b) => itemValue(b) - itemValue(a))[0];
  if (!target || world.rng.next() >= 0.5) return;
  // Our inventory retains the replaced weapon on the ground; no item silently disappears.
  if (own) relocateItem(world, own, { kind: 'ground', ...thief.components.position }, 'replaced');
  relocateItem(world, target, { kind: 'equipped', entityId: thief.id }, 'equipped');
  applyStatus(world, victim, 'stunned', { seconds: 1, source: thief });
}
