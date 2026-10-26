import type { WorldSnapshot } from '../core/types';
import { bool, integer, number, record, reference } from '../core/validation';
import { DEVELOPMENT_GRAPHS } from '../core/village-development';
import { EXPANSION_REASONS, ZONE_SIZE } from '../core/territory';

/** Optional additions migrate on world construction without resource grants or RNG draws. */
export function validTerritories(save: WorldSnapshot): boolean {
  const columns = Math.ceil(save.terrain.width / ZONE_SIZE), rows = Math.ceil(save.terrain.height / ZONE_SIZE);
  const claimed = new Set<number>(), reserved = new Set<number>(), capitals = new Set<number>(), actors = new Set<number>();
  const zoneList = (zones: unknown): zones is number[] => Array.isArray(zones) && zones.length <= columns * rows
    && zones.every(z => integer(z, 0, columns * rows - 1)) && new Set(zones).size === zones.length;
  const adjacent = (a: number, b: number): boolean => Math.abs(a % columns - b % columns) + Math.abs(Math.floor(a / columns) - Math.floor(b / columns)) === 1;
  for (const village of save.society.villages) {
    if (village.constructionProfile !== undefined && !Object.hasOwn(DEVELOPMENT_GRAPHS, village.constructionProfile)) return false;
    const t = village.territory;
    if (t === undefined) continue;
    if (!record(t) || !zoneList(t.zones) || !record(t.foundation) || !number(t.foundation.x, 0, save.terrain.width - 0.001)
      || !number(t.foundation.y, 0, save.terrain.height - 0.001) || !reference(t.founderId)
      || t.founderId !== null && !integer(t.founderId, 1, save.nextEntityId - 1)
      || !reference(t.kingdomId) || !bool(t.capital) || t.capital && t.kingdomId === null
      || t.abandonedAt !== null && !integer(t.abandonedAt, village.founded, save.tick)
      || !integer(t.decayAt) || !integer(t.expandAt) || !EXPANSION_REASONS.includes(t.reason)) return false;
    if (t.capital && t.kingdomId !== null) { if (capitals.has(t.kingdomId)) return false; capitals.add(t.kingdomId); }
    for (const z of t.zones) { if (claimed.has(z)) return false; claimed.add(z); }
    if (t.expansion !== undefined) {
      const e = t.expansion;
      if (!record(e)) return false;
      const actor = save.entities.find(a => a.id === e.actorId);
      if (!integer(e.zone, 0, columns * rows - 1) || !integer(e.started, 0, save.tick) || !integer(e.actorId, 1)
        || actors.has(e.actorId) || !actor?.components.person || !actor.components.position || !actor.components.citizen
        || actor.components.citizen.villageId !== village.id || village.government?.leaderId !== e.actorId
        || t.abandonedAt !== null || !t.zones.some(z => adjacent(z, e.zone))) return false;
      actors.add(e.actorId);
    }
  }
  for (const group of save.society.migrations) {
    if (group.reservedZones === undefined) continue;
    if (group.toId !== null || !zoneList(group.reservedZones) || group.reservedZones.length > 9) return false;
    const center = Math.floor(group.destination.y / 8) * columns + Math.floor(group.destination.x / 8);
    if (group.reservedZones.length && !group.reservedZones.includes(center)) return false;
    for (const z of group.reservedZones) {
      if (Math.abs(z % columns - center % columns) > 1 || Math.abs(Math.floor(z / columns) - Math.floor(center / columns)) > 1 || claimed.has(z) || reserved.has(z)) return false;
      reserved.add(z);
    }
  }
  return true;
}
