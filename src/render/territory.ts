import type { World } from '../core/world';
import type { Village } from '../core/types';
import { TILE } from './camera';
import { ZONE_SIZE, zoneColumns, zoneOrigin } from '../core/territory';
import { housingLimit } from '../core/buildings';
import { villageProfile } from '../core/village-development';
import { residentName } from '../core/village-life';
import { translate, type Language } from '../i18n';
import { villageColor } from './sprites';

export function territoryLines(world: World, village: Village, language: Language): string[] {
  const t = village.territory;
  if (!t) return [];
  const houses = housingLimit(world, village), tr = (s: string) => translate(s, language);
  const status = t.kingdomId === null ? 'Independent village' : t.capital ? 'Capital village' : 'Provincial village';
  return [tr(status), translate('Territory: {zones} zones · Houses: {used}/{limit}', language, { zones: t.zones.length, used: houses.used, limit: houses.limit }),
    t.abandonedAt !== null ? translate('Abandoned · next zone lost in {seconds}s', language, { seconds: Math.max(0, Math.ceil((t.decayAt - world.tick) / 30)) })
      : t.expansion ? translate('{name} is extending the border', language, { name: residentName(t.expansion.actorId, world) }) : tr(t.reason),
    translate('Construction order: {profile}', language, { profile: tr({ advanced: 'Advanced construction', basic1: 'Basic construction I', basic2: 'Basic construction II' }[villageProfile(village)]) })];
}
export function drawTerritories(ctx: CanvasRenderingContext2D, world: World, zoom: number): void {
  const columns = zoneColumns(world), size = ZONE_SIZE * TILE;
  const outline = (zones: number[], color: string, dashed: boolean): void => {
    const set = new Set(zones);
    ctx.strokeStyle = color; ctx.lineWidth = 1.5 / zoom; ctx.setLineDash(dashed ? [5 / zoom, 4 / zoom] : []); ctx.beginPath();
    for (const z of zones) {
      const p = zoneOrigin(world, z), x = p.x * TILE, y = p.y * TILE;
      if (z % columns === 0 || !set.has(z - 1)) { ctx.moveTo(x, y); ctx.lineTo(x, y + size); }
      if (z % columns === columns - 1 || !set.has(z + 1)) { ctx.moveTo(x + size, y); ctx.lineTo(x + size, y + size); }
      if (!set.has(z - columns)) { ctx.moveTo(x, y); ctx.lineTo(x + size, y); }
      if (!set.has(z + columns)) { ctx.moveTo(x, y + size); ctx.lineTo(x + size, y + size); }
    }
    ctx.stroke();
  };
  ctx.save(); ctx.globalAlpha = 0.65;
  for (const v of world.society.villages) if (v.territory) outline(v.territory.zones, villageColor(v.id), v.territory.abandonedAt !== null);
  ctx.globalAlpha = 0.4;
  for (const group of world.society.migrations) if (group.reservedZones) outline(group.reservedZones, villageColor(group.fromId), true);
  ctx.restore();
}
