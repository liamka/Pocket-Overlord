import { NaturalBiome, NATURAL_BIOMES } from './natural-biomes';
import { Random } from './random';
import { availableStock, cargoContents } from './resource-ledger';
import { SOURCE_PROFILES, type ResourceBundle } from './resources';
import type { Entity, Vec2, Village } from './types';
import type { World } from './world';

// Selected policy: the newer Biome Ores table, not the older Candy entry in Gems.
// https://the-official-worldbox-wiki.fandom.com/wiki/Category:Biomes
// https://the-official-worldbox-wiki.fandom.com/wiki/Gems?oldid=22288
// Clover/Rocklands have no biome IDs yet. Crystal supplies flora, never natural ore.
export const GEM_BIOMES: readonly NaturalBiome[] = NATURAL_BIOMES.filter(b => b.ecology.minerals.gems).map(b => b.id);
// Pocket Overlord balance: ten times fewer placement attempts than stone, three batches per ore.
export const GEMS = { spacing: 2400, batches: SOURCE_PROFILES.gemOre.capacity.gems!, orders: 2, shipment: 4, reservationTicks: 900 } as const;
export interface GemSource { kind: 'ore' | 'plant'; origin: 'natural' | 'mine' | 'biology'; biome: NaturalBiome; remaining: number; createdAt: number }
declare module './types' { interface ComponentMap { gemSource: GemSource } }
export const gemProfile = (s: GemSource) => SOURCE_PROFILES[s.kind === 'ore' ? 'gemOre' : 'crystalPlant'];
export const gemContents = (s: GemSource): ResourceBundle => Object.fromEntries(Object.entries(gemProfile(s).outputs).map(([id, n]) => [id, n * s.remaining]));

/** The mine plan can call this once for each completed production cycle. No mine is built here. */
export function spawnGemSource(world: World, p: Vec2, origin: GemSource['origin'] = 'natural', kind: GemSource['kind'] = 'ore'): Entity | undefined {
  const biome = world.terrain.biomeAt(p.x, p.y).id;
  if (world.paused || kind === 'plant' && (origin !== 'natural' || biome !== NaturalBiome.Crystal)
    || kind === 'ore' && origin === 'natural' && !GEM_BIOMES.includes(biome)
    || !world.safeLand(p, 0.7) || !world.canStand(p, 0.7)
    || world.nearby(p, 2).some(e => e.components.farm || e.components.ruin || e.components.stone || e.components.gemSource)) return;
  const entity = world.spawn(kind === 'ore' ? 'core:gem-ore' : 'core:crystal-plant', p);
  if (entity) Object.assign(entity.components.gemSource!, { origin, biome, createdAt: world.tick });
  return entity;
}
/** Called only for new worlds. Loading an old or depleted world never reseeds resources. */
export function seedGems(world: World): void {
  const random = new Random(world.seed ^ 0x6e3a), { width, height } = world.terrain;
  for (let i = 0; i < Math.floor(width * height / GEMS.spacing); i++) {
    const p = { x: random.range(1, width - 1), y: random.range(1, height - 1) };
    spawnGemSource(world, p, 'natural', world.terrain.biomeAt(p.x, p.y).id === NaturalBiome.Crystal ? 'plant' : 'ore');
  }
}
export function gemOrderDemand(world: World, villageId: number): number {
  return Math.min(GEMS.orders, world.crafting.orders.filter(o => o.villageId === villageId && o.state === 'waiting'
    && (o.slot === 'ring' || o.slot === 'amulet')).reduce((sum, o) => sum + (o.inputs.gems ?? 0), 0));
}
export function incomingGems(world: World, villageId: number): number {
  let amount = 0;
  for (const e of world.query('citizen')) {
    const cargo = e.components.citizen!.work?.cargo;
    if (cargo?.villageId === villageId) amount += cargoContents(cargo).gems ?? 0;
  }
  for (const e of world.query('caravan')) {
    const c = e.components.caravan!;
    if ((c.returning ? c.fromId : c.toId) === villageId) amount += c.gems ?? 0;
  }
  for (const e of world.query('ship')) {
    const s = e.components.shipment;
    if (s && (s.phase === 'returning' ? s.fromId : s.toId) === villageId) amount += s.goods.gems ?? 0;
  }
  return amount;
}
export const missingGems = (world: World, village: Village): number => Math.max(0,
  gemOrderDemand(world, village.id) - availableStock(world, village, 'gems') - incomingGems(world, village.id));
