import { setRebirth } from '../src/core/metamorphosis';
import { describe, expect, it } from 'vitest';
import { editorWorld as flatWorld } from './helpers';
import { World } from '../src/core/world';
import { TRAIT_DEFINITIONS, traitDefinitions } from '../src/content/traits';
import { acquireTraits, editTrait, hasTrait, inheritTraits, removeTrait, traitEvent, traitOpinion } from '../src/core/traits';
import { reconcileStats, unitStats } from '../src/core/unit-stats';
import { applyStatus, hasStatus } from '../src/core/status-effects';
import { infect, enrage } from '../src/systems/afflictions';
import { applyEvent, processEvents } from '../src/systems/effects';
import { equipmentHit } from '../src/systems/equipment';
import { traitsSystem } from '../src/systems/traits';
import { decodeSave } from '../src/persistence/schema';
import { traitsInspector } from '../src/ui/traits';

function person(w: World, x = 10) {
  const e = w.spawn('core:person',{x,y:10})!;
  e.components.traits!.entries = [];
  reconcileStats(w,e);
  return e;
}
describe('personal traits', () => {
  it('resolves an editor conflict before calculating modifiers, independent of batch order', () => {
    const w = flatWorld(), a = person(w), b = person(w,12);
    acquireTraits(w,a,['strong','weak'],'editor'); acquireTraits(w,b,['weak','strong'],'editor');
    expect(a.components.traits!.entries.map(t => t.id)).toEqual(b.components.traits!.entries.map(t => t.id));
    expect(hasTrait(a,'strong')).toBe(true); expect(hasTrait(a,'weak')).toBe(false);
    const strongDamage = unitStats(w,a).values.damage;
    editTrait(w,a,'weak',true);
    expect(hasTrait(a,'strong')).toBe(false); expect(unitStats(w,a).values.damage).toBeLessThan(strongDamage);
  });
  it('never inherits opposing traits, and repeated birth callbacks consume no RNG', () => {
    const w = flatWorld(), a = person(w), b = person(w,12), child = person(w,14);
    editTrait(w,a,'strong',true); editTrait(w,b,'weak',true);
    child.components.traits!.inherited = false; child.components.traits!.born = false;
    inheritTraits(w,child,[b,a]); const rng = w.rng.state, entries = structuredClone(child.components.traits!.entries);
    inheritTraits(w,child,[a,b]);
    expect(hasTrait(child,'strong') && hasTrait(child,'weak')).toBe(false);
    expect(w.rng.state).toBe(rng); expect(child.components.traits!.entries).toEqual(entries);
    applyEvent(w,{kind:'damage',target:b.id,amount:1e6,cause:'age'});
    const orphan = person(w,16); orphan.components.citizen!.parents = [b.id]; orphan.components.traits!.inherited = false;
    inheritTraits(w,orphan,[]);
    expect(hasTrait(orphan,'weak')).toBe(true);
    expect(orphan.components.traits!.entries.find(t => t.id === 'weak')?.subject).toBeDefined();
    expect(decodeSave(w.snapshot(),w.registry).unitHistory!.find(m => m.id === b.id)!.traitIds).toContain('weak');
  });
  it('awards a zero-birth-weight veteran through a confirmed eleventh kill exactly once', () => {
    const w = flatWorld(), a = person(w), b = person(w,11); a.components.traits!.kills = 10;
    editTrait(w,b,'the-chosen-one',true);
    const kill = {kind:'damage' as const,target:b.id,amount:1e6,sourceId:a.id,cause:'conflict' as const};
    applyEvent(w,kill); const experience = structuredClone(a.components.stats!.experience); applyEvent(w,kill);
    expect(traitDefinitions.veteran.birth).toBe(0); expect(hasTrait(a,'veteran')).toBe(true);
    expect(hasTrait(a,'mageslayer')).toBe(false);
    expect(a.components.traits!.kills).toBe(11); expect(a.components.stats!.experience).toEqual(experience);
  });
  it('blocks real disease producers before they change clocks or jobs', () => {
    const w = flatWorld(), a = person(w);
    editTrait(w,a,'immune',true); editTrait(w,a,'strong-minded',true);
    infect(a); infect(a,w); enrage(w,a);
    expect(a.components.person!.plague).toBeUndefined(); expect(a.components.person!.madness).toBeUndefined();
    expect(applyStatus(w,a,'coughing')).toBe(false); expect(applyStatus(w,a,'rage')).toBe(false);
  });
  it('cures only the chosen injury and keeps plague timers intact', () => {
    const w = flatWorld(), a = person(w);
    acquireTraits(w,a,['plague','one-eyed','crippled'],'event');
    const disease = structuredClone(a.components.person!.plague), clock = structuredClone(a.components.statuses!.active.find(s => s.id === 'plague'));
    removeTrait(w,a,'one-eyed','cure');
    expect(hasTrait(a,'one-eyed')).toBe(false); expect(hasTrait(a,'crippled')).toBe(true);
    expect(a.components.person!.plague).toEqual(disease); expect(a.components.statuses!.active.find(s => s.id === 'plague')).toEqual(clock);
    editTrait(w,a,'immune',true);
    expect(hasTrait(a,'plague')).toBe(false); expect(hasStatus(a,'plague')).toBe(false);
  });
  it('keeps one death explosion pending through a save without repeating a kill reward', () => {
    const w = flatWorld(), a = person(w,20), b = person(w,10);
    editTrait(w,b,'death-bomb',true);
    applyEvent(w,{kind:'damage',target:b.id,amount:1e6,sourceId:a.id,cause:'conflict'});
    expect(w.events.filter(e => e.kind === 'blast')).toHaveLength(1);
    const loaded = new World(w.seed,w.registry,decodeSave(w.snapshot(),w.registry));
    processEvents(w); processEvents(loaded);
    w.die(b.id,{cause:'conflict',sourceId:a.id});
    expect(loaded.deaths).toEqual(w.deaths); expect(a.components.traits!.kills).toBe(1);
    expect(w.events.filter(e => e.kind === 'blast')).toHaveLength(0);
  });
  it('preserves active periodic deadlines, RNG and pause after loading', () => {
    const w = flatWorld(), a = person(w);
    editTrait(w,a,'regeneration',true); editTrait(w,a,'unlucky',true);
    const loaded = new World(w.seed,w.registry,decodeSave(w.snapshot(),w.registry));
    for (let i=0;i<100;i++) { w.step(); loaded.step(); }
    expect(loaded.snapshot()).toEqual(w.snapshot());
    w.paused = true; const saved = w.snapshot(); traitsSystem(w); w.step();
    expect(w.snapshot()).toEqual(saved);
  });
  it('rejects duplicate event receipts after loading', () => {
    const w = flatWorld(), a = person(w);
    expect(traitEvent(w,a,1,['veteran'],'A battle')).toBe(true);
    const loaded = new World(w.seed,w.registry,decodeSave(w.snapshot(),w.registry)), b = loaded.entities.get(a.id)!;
    const rng = loaded.rng.state;
    expect(traitEvent(loaded,b,1,['strong'],'A battle')).toBe(false);
    expect(loaded.rng.state).toBe(rng); expect(hasTrait(b,'strong')).toBe(false);
  });
  it('restricts ships and special creatures without changing random state', () => {
    const w = flatWorld(), boat = w.spawn('core:ship',{x:10,y:10})!, ufo = w.spawn('core:ufo',{x:15,y:10})!;
    const rng = w.rng.state;
    expect(editTrait(w,boat,'immune',true)).toBe(false); expect(editTrait(w,boat,'its-a-boat',false)).toBe(false);
    expect(editTrait(w,ufo,'plague',true)).toBe(false); expect(w.rng.state).toBe(rng);
  });
  it('does not reflect reflection or give removed recipients new effects', () => {
    const w = flatWorld(), a = person(w), b = person(w,11);
    editTrait(w,a,'thorns',true); editTrait(w,b,'thorns',true);
    equipmentHit(w,a.id,b,1,[]); processEvents(w);
    expect(w.events.filter(e => e.kind === 'damage')).toHaveLength(0);
    w.remove(b.id); const rng = w.rng.state;
    expect(traitEvent(w,b,b.components.traits!.nextEventId,['strong'])).toBe(false);
    expect(w.rng.state).toBe(rng);
  });
  it('validates conflicts and impossible deadlines and adopts legacy saves without rerolling', () => {
    const w = flatWorld(), a = person(w); editTrait(w,a,'regeneration',true);
    const bad = w.snapshot(), entry = bad.entities.find(e => e.id === a.id)!.components.traits!.entries.find(t => t.id === 'regeneration')!;
    entry.nextAt = w.tick+100000; expect(() => decodeSave(bad,w.registry)).toThrow();
    const old = w.snapshot(); for (const e of old.entities) delete e.components.traits;
    const loaded = new World(w.seed,w.registry,decodeSave(old,w.registry));
    expect(loaded.rng.state).toBe(old.rngState); expect(loaded.entities.get(a.id)!.components.traits!.entries).toHaveLength(0);
  });
  it('saves a transformed body after removing an incompatible personal trait', () => {
    const w = flatWorld(), a = person(w);
    acquireTraits(w,a,['wise'],'event'); a.components.person!.age = 80;
    setRebirth(w,a,'wolf');
    applyEvent(w,{kind:'damage',target:a.id,amount:1e6,cause:'age'});
    const wolf = [...w.query('animal')].find(e => e.components.unit?.previousBodyId === a.id)!;
    expect(hasTrait(wolf,'wise')).toBe(false); expect(hasTrait(wolf,'metamorphed')).toBe(true);
    expect(wolf.components.metamorphosis!.history.at(-1)!.removed).toContain('Wise');
    expect(() => decodeSave(w.snapshot(),w.registry)).not.toThrow();
  });
  it('uses the actual pair for opinion and escapes the displayed acquisition source', () => {
    const w = flatWorld(), a = person(w), b = person(w,12), c = person(w,14);
    acquireTraits(w,a,['strong'],'event','<img src=x>'); acquireTraits(w,b,['strong'],'event'); acquireTraits(w,c,['weak'],'event');
    expect(traitOpinion(a,b)).toBe(5); expect(traitOpinion(a,c)).toBe(-10);
    const html = traitsInspector(w,a,'ru',true,false);
    expect(html).toContain('&lt;img src=x&gt;'); expect(html).not.toContain('<img src=x>');
    expect(TRAIT_DEFINITIONS).toHaveLength(116);
    expect(TRAIT_DEFINITIONS.filter(d => d.randomBirth).some(d => ['wise','veteran','madness','plague','death-nuke'].includes(d.id))).toBe(false);
  });
});
