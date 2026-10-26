import type { Entity, Vec2 } from './types';
import type { World } from './world';
import { isUnit, memoryName, unitName } from './units';
import { bool, integer, record } from './validation';

export const DEATH_CAUSES = ['age', 'hunger', 'eaten', 'plague', 'poison', 'zombie', 'tumor', 'acid', 'fire', 'divine', 'conflict', 'gravity', 'drowning', 'water', 'explosion', 'other'] as const;
export type DeathCause = typeof DEATH_CAUSES[number];
export interface DamageContext { cause: DeathCause; sourceId?: number; sourceName?: string; player?: boolean }
export interface DeathRecord {
  victimId: number; typeId: string; name: string; cause: DeathCause;
  initiator: { id: number; name: string } | null; player: boolean; position: Vec2; tick: number;
  villageId: number | null; villageName: string | null; homeId: number | null; partnerId: number | null;
  wars: number[]; favorite: boolean; ruler: boolean;
  successor: { id: number; name: string } | null;
  transformedInto: { id: number; name: string; typeId: string } | null;
  /** Captured before offices are released; used only by transformation eligibility. */
  warrior?: boolean;
}
export interface DeathState { total: number; causes: Record<DeathCause, number>; recent: DeathRecord[]; notable: DeathRecord[] }
export const DEATH_HISTORY_LIMIT = 128;
export const NOTABLE_DEATH_LIMIT = 64;
export const newDeaths = (): DeathState => ({ total: 0, causes: Object.fromEntries(DEATH_CAUSES.map(cause => [cause, 0])) as Record<DeathCause, number>, recent: [], notable: [] });
export const deathCause = (v: unknown): v is DeathCause => DEATH_CAUSES.some(cause => cause === v);
export const validDamageContext = (v: unknown, required = false): boolean => record(v)
  && (v.cause === undefined ? !required : deathCause(v.cause))
  && (v.sourceId === undefined || integer(v.sourceId, 1))
  && (v.sourceName === undefined || v.sourceId !== undefined && typeof v.sourceName === 'string' && [...v.sourceName].length > 0 && [...v.sourceName].length <= 30 && !/[\u0000-\u001f\u007f]/u.test(v.sourceName))
  && (v.player === undefined || bool(v.player));

/** Capture the initiator before a delayed effect outlives its source. No RNG draws. */
export function damageContext(world: World, context: DamageContext): DamageContext {
  let sourceName = context.sourceName;
  if (!sourceName && context.sourceId !== undefined) {
    const source = world.entities.get(context.sourceId);
    if (source && isUnit(source)) sourceName = unitName(source);
    else {
      const memory = world.unitHistory.find(m => m.id === context.sourceId);
      if (memory) sourceName = memoryName(memory);
    }
  }
  return { cause: context.cause, ...(context.sourceId === undefined ? {} : { sourceId: context.sourceId }),
    ...(sourceName ? { sourceName } : {}), ...(context.player ? { player: true } : {}) };
}
export const deathOf = (world: World, id: number): DeathRecord | undefined => world.deaths.recent.find(d => d.victimId === id) ?? world.deaths.notable.find(d => d.victimId === id);

/** Called once before removal, while affiliations still belong to the old form. */
export function recordDeath(world: World, entity: Entity, context: DamageContext): DeathRecord | undefined {
  if (!isUnit(entity) || !entity.components.position) return;
  const c = entity.components, villageId = c.citizen?.villageId ?? c.animal?.villageId
    ?? world.entities.get(c.ship?.homeId ?? -1)?.components.harbor?.villageId ?? null;
  const village = world.society.villages.find(v => v.id === villageId), source = damageContext(world, context);
  const death: DeathRecord = { victimId: entity.id, typeId: entity.typeId, name: unitName(entity), cause: source.cause,
    initiator: source.sourceId !== undefined && source.sourceName ? { id: source.sourceId, name: source.sourceName } : null,
    player: source.player ?? false, position: { ...c.position! }, tick: world.tick,
    villageId, villageName: village?.name ?? null, homeId: c.person?.homeId ?? c.ship?.homeId ?? null,
    partnerId: c.citizen?.partnerId ?? null, wars: world.society.wars.filter(w => villageId !== null && (w.attackers.includes(villageId) || w.defenders.includes(villageId))).map(w => w.id),
    favorite: c.unit?.favorite ?? false, ruler: village?.government?.leaderId === entity.id, successor: null, transformedInto: null,
    warrior: c.citizen?.profession?.service === 'warrior' || c.citizen?.profession?.service === 'captain' };
  world.deaths.total++; world.deaths.causes[death.cause]++;
  world.deaths.recent.push(death);
  if (world.deaths.recent.length > DEATH_HISTORY_LIMIT) world.deaths.recent.shift();
  if (death.favorite || death.ruler) {
    world.deaths.notable.push(death);
    if (world.deaths.notable.length > NOTABLE_DEATH_LIMIT) world.deaths.notable.shift();
  }
  return death;
}

/** The existing remains integration creates a distinct identity; the death stays final. */
export function recordPosthumousForm(world: World, originId: number, entity: Entity): void {
  for (const deaths of [world.deaths.recent, world.deaths.notable]) {
    const death = deaths.find(d => d.victimId === originId);
    if (death) death.transformedInto = { id: entity.id, name: unitName(entity), typeId: entity.typeId };
  }
}

export const DEATH_LABELS: Record<DeathCause, string> = {
  age: 'Old age', hunger: 'Starvation', eaten: 'Eaten', plague: 'Plague', poison: 'Poison', zombie: 'Zombie infection', tumor: 'Tumor',
  acid: 'Acid', fire: 'Fire or lava', divine: 'Divine intervention', conflict: 'Conflict', gravity: 'Gravity', drowning: 'Drowning', water: 'Water damage', explosion: 'Explosion', other: 'Other causes',
};
