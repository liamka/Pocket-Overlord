import type { Registry } from '../content/registry';
import { METHOD_TRAITS } from '../content/subspecies-traits';
import { newPhysiology, physiologyDefaults } from '../core/physiology';
import { integer, number, record, type RecordValue } from '../core/validation';
import type { Entity, WorldSnapshot } from '../core/types';
import type { Subspecies } from '../core/subspecies-state';

export function validPhysiologyState(v: RecordValue): boolean {
  return (v.birthApplied === undefined || v.birthApplied === true) && (v.hatchApplied === undefined || v.hatchApplied === true)
    && (v.fleeUntil === undefined || integer(v.fleeUntil)) && ['after', 'photoAfter', 'produceAfter', 'sleepAfter', 'shuffleAfter'].every(key => integer(v[key]))
    && integer(v.pollen, 0, 10) && (v.flower === null || integer(v.flower)) && integer(v.visits, 0, 6) && integer(v.lastMealAt, -1)
    && (v.result === undefined || record(v.result) && integer(v.result.at) && typeof v.result.text === 'string' && v.result.text.length <= 120)
    && (v.action === undefined || record(v.action) && ['mineral', 'wood', 'plant', 'crop', 'prey', 'water', 'soil', 'flower', 'honey', 'fruit', 'meal'].includes(String(v.action.kind))
      && (v.action.targetId === null || integer(v.action.targetId, 1)) && number(v.action.x, 0, 10000) && number(v.action.y, 0, 10000));
}
/** Adopt existing physiology without resources, a mutation draw or a metabolism pulse. */
export function migratePhysiology(save: RecordValue, registry: Registry): RecordValue {
  if (!record(save.subspecies) || !Array.isArray(save.subspecies.records) || !Array.isArray(save.entities) || !integer(save.tick)) throw new Error('Invalid physiology migration');
  for (const s of save.subspecies.records as Subspecies[]) {
    const species = registry.species.get(s.speciesId);
    if (!species) throw new Error('Unknown physiology species');
    const defaults = physiologyDefaults(species).filter(id => !['sapience', 'amygdala', 'genealogy', 'tools', 'governance', 'viviparity', 'sexual', 'hermaphroditic'].includes(id));
    s.traits = [...new Set([...s.traits.filter(id => !(METHOD_TRAITS as readonly string[]).includes(id)), ...defaults,
      ...(s.reproduction?.methods ?? []), ...(s.reproduction?.form === 'direct' ? [] : [s.reproduction?.form ?? 'viviparity'])])] as Subspecies['traits'];
  }
  if (record(save.worldRules) && record(save.worldRules.values)) save.worldRules.values['grin-reaper'] = false;
  for (const e of save.entities as Entity[]) if (e.components.subspecies) e.components.physiology = newPhysiology(save.tick);
  return { ...save, version: 68 };
}
export function validPhysiologySave(save: WorldSnapshot): boolean {
  return save.entities.every(e => {
    const p = e.components.physiology;
    return !e.components.subspecies ? p === undefined : !!p && validPhysiologyState(p as unknown as RecordValue)
      && p.lastMealAt <= save.tick && (!p.result || p.result.at <= save.tick)
      && (p.flower === null || p.flower < save.terrain.width * save.terrain.height)
      && (!p.action || p.action.x < save.terrain.width && p.action.y < save.terrain.height
        && (p.action.targetId === null || save.entities.some(target => target.id === p.action!.targetId)));
  });
}
