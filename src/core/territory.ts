import type { Entity, Migration, Vec2, Village } from './types';
import type { World } from './world';
import { Terrain } from './types';

export const ZONE_SIZE = 8;
export const TERRITORY = { expansionTicks: 900, decayTicks: 900 } as const;
export const EXPANSION_REASONS = ['No elder elected', 'Settlement is empty', 'Kingdom expansion is disabled',
  'No free habitable neighbouring zone', 'No route to the frontier', 'Elder is busy', 'Borders can expand'] as const;
export type ExpansionReason = typeof EXPANSION_REASONS[number];
export interface VillageTerritory {
  zones: number[];
  foundation: Vec2;
  /** Historical identity, not a live entity reference. Never reassigned on death. */
  founderId: number | null;
  /** Reserved for the kingdom system; independent settlements have no kingdom. */
  kingdomId: number | null;
  capital: boolean;
  abandonedAt: number | null;
  decayAt: number;
  expandAt: number;
  reason: ExpansionReason;
  expansion?: { actorId: number; zone: number; started: number };
}
type Geography = Pick<World, 'terrain' | 'society'>;
export const zoneColumns = (world: Pick<World, 'terrain'>): number => Math.ceil(world.terrain.width / ZONE_SIZE);
export const zoneAt = (world: Pick<World, 'terrain'>, p: Vec2): number => Math.floor(p.y / ZONE_SIZE) * zoneColumns(world) + Math.floor(p.x / ZONE_SIZE);
export const zoneOrigin = (world: Pick<World, 'terrain'>, zone: number): Vec2 => ({ x: zone % zoneColumns(world) * ZONE_SIZE, y: Math.floor(zone / zoneColumns(world)) * ZONE_SIZE });
export const zoneCenter = (world: Pick<World, 'terrain'>, zone: number): Vec2 => { const p = zoneOrigin(world, zone); return { x: p.x + 4, y: p.y + 4 }; };
/** Shared edge, never a corner or a wrapped row. */
export function zoneNeighbours(world: Pick<World, 'terrain'>, zone: number): number[] {
  const columns = zoneColumns(world), rows = Math.ceil(world.terrain.height / ZONE_SIZE), x = zone % columns, y = Math.floor(zone / columns);
  return [x > 0 ? zone - 1 : -1, x + 1 < columns ? zone + 1 : -1, y > 0 ? zone - columns : -1, y + 1 < rows ? zone + columns : -1].filter(z => z >= 0);
}
export function habitableTile(world: Pick<World, 'terrain'>, p: Vec2): boolean {
  if (!world.terrain.inside(p.x, p.y)) return false;
  const tile = world.terrain.at(p.x, p.y), cell = world.terrain.cell(p.x, p.y);
  return [Terrain.Sand, Terrain.Grass, Terrain.Road, Terrain.Scorched, Terrain.Crater].includes(tile) && cell.land && !cell.water && !cell.top?.startsWith('wall') && cell.top !== 'grey-goo';
}
/** Shore zones may contain water, but their centre and at least half their cells must be habitable.
 * Ownership never makes the water/mountain cells inside a shore zone buildable. */
export function habitableZone(world: Pick<World, 'terrain'>, zone: number): boolean {
  const p = zoneOrigin(world, zone);
  if (!habitableTile(world, zoneCenter(world, zone))) return false;
  let land = 0;
  for (let y = p.y; y < p.y + 8; y++) for (let x = p.x; x < p.x + 8; x++) if (habitableTile(world, { x, y })) land++;
  return land >= 32;
}
export const zoneOwner = (world: Geography, zone: number): Village | undefined => world.society.villages.find(v => v.territory?.zones.includes(zone));
export function territoryOwner(world: Geography, p: Vec2): Village | undefined {
  return habitableTile(world, p) ? zoneOwner(world, zoneAt(world, p)) : undefined;
}
export const ownsPosition = (world: Geography, villageId: number, p: Vec2): boolean => territoryOwner(world, p)?.id === villageId;
export const reservedZone = (world: Geography, zone: number, except?: number): boolean => world.society.migrations.some(g => g.id !== except && g.toId === null && g.reservedZones?.includes(zone));

export function foundingZones(world: Geography, p: Vec2, migrationId?: number): number[] {
  const center = zoneAt(world, p), origin = zoneOrigin(world, center), candidates = new Set<number>();
  for (let dy = -8; dy <= 8; dy += 8) for (let dx = -8; dx <= 8; dx += 8) {
    const q = { x: origin.x + dx, y: origin.y + dy };
    if (!world.terrain.inside(q.x, q.y)) continue;
    const z = zoneAt(world, q);
    if (!zoneOwner(world, z) && !reservedZone(world, z, migrationId) && habitableZone(world, z)) candidates.add(z);
  }
  if (!habitableTile(world, p) || !candidates.has(center)) return [];
  const connected = [center];
  for (let i = 0; i < connected.length; i++) for (const z of zoneNeighbours(world, connected[i]))
    if (candidates.has(z) && !connected.includes(z)) connected.push(z);
  return connected.sort((a, b) => a - b);
}
export function newTerritory(world: Pick<World, 'tick'>, village: Village, zones: number[], founder?: Entity): VillageTerritory {
  return { zones, foundation: { x: village.x, y: village.y }, founderId: founder?.id ?? null, kingdomId: null, capital: false,
    abandonedAt: null, decayAt: world.tick + TERRITORY.decayTicks, expandAt: world.tick + TERRITORY.expansionTicks, reason: 'No elder elected' };
}
/** Optional-field migration: deterministic and reward-free; a saved empty territory is never regenerated. */
export function initializeTerritories(world: World): void {
  const legacy = world.society.villages.filter(v => !v.territory).sort((a, b) => a.id - b.id);
  for (const v of legacy) v.territory = newTerritory(world, v, []);
  // Established buildings take precedence over formerly approximate circular borders.
  if (legacy.length) for (const e of world.query('position')) {
    const owner = e.components.dwelling?.villageId ?? e.components.workplace?.villageId ?? e.components.farm?.villageId ?? e.components.harbor?.villageId ?? e.components.stockpile?.villageId;
    const village = legacy.find(v => v.id === owner), z = zoneAt(world, e.components.position!);
    if (village && !zoneOwner(world, z) && habitableZone(world, z)) village.territory!.zones.push(z);
  }
  for (const v of legacy) {
    const center = zoneOrigin(world, zoneAt(world, v));
    for (let dy = -8; dy <= 8; dy += 8) for (let dx = -8; dx <= 8; dx += 8) {
      const p = { x: center.x + dx, y: center.y + dy }, z = zoneAt(world, p);
      if (world.terrain.inside(p.x, p.y) && !zoneOwner(world, z) && habitableZone(world, z)) v.territory!.zones.push(z);
    }
    v.territory!.zones.sort((a, b) => a - b);
  }
  for (const group of world.society.migrations) if (group.toId === null && !group.reservedZones)
    group.reservedZones = foundingZones(world, group.destination, group.id);
}
export function colonyReservationValid(world: Geography, group: Migration): boolean {
  const zones = group.reservedZones;
  return !!zones?.length && zones.includes(zoneAt(world, group.destination))
    && zones.every(z => !zoneOwner(world, z) && !reservedZone(world, z, group.id) && habitableZone(world, z));
}

/** Kingdom integration supplies an actual owner; this plan does not invent kingdoms. */
export function setVillageKingdom(world: World, village: Village, kingdomId: number | null, capital: boolean): void {
  initializeTerritories(world);
  if (capital && kingdomId !== null) for (const other of world.society.villages)
    if (other.territory?.kingdomId === kingdomId) other.territory.capital = false;
  Object.assign(village.territory!, { kingdomId, capital: kingdomId !== null && capital });
}
