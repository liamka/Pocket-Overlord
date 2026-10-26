import { describe, expect, it } from 'vitest';
import { flatWorld } from './helpers';
import { World } from '../src/core/world';
import { Terrain, STEP, POPULATION_LIMIT } from '../src/core/types';
import { WORLD_LAWS } from '../src/content/world-laws';
import { canEarnWorldProgress, canJoinSettlement, canUseWorldEditors, protectedCivilian, setArchitect, setForbiddenKnowledge, setWorldLaw, settlementRoom, terrainChangeAllowed } from '../src/core/world-rules';
import { resolveReproduction, startReproduction } from '../src/core/reproduction';
import { runWorldProcesses, setWorldProcessEnabled } from '../src/core/world-processes';
import { applyGenomeEdit, createGenomeDraft } from '../src/core/gene-editor';
import { subspeciesOf } from '../src/core/subspecies-state';
import { applyEvent, fire, processEvents } from '../src/systems/effects';
import { equipmentSpeed, performAttack } from '../src/systems/equipment';
import { assignHouse } from '../src/systems/society';
import { decodeSave } from '../src/persistence/schema';
import { GEOHAZARDS, geohazards } from '../src/core/geohazards';
import { FixedClock } from '../src/core/clock';
import { languages, translate } from '../src/i18n';

describe('world laws and their transitions', () => {
  it('finishes a paid pregnancy once after disabling births and reloading, but rejects a new conception', () => {
    const w = flatWorld(), a = w.spawn('core:person', { x: 20, y: 20 })!, b = w.spawn('core:person', { x: 21, y: 20 })!;
    for (const e of [a, b]) { e.components.person!.age = 25; e.components.traits!.entries = []; e.components.citizen!.hunger = 0; e.components.reproduction!.cooldowns = {}; }
    a.components.person!.sex = 'a'; b.components.person!.sex = 'b';
    a.components.citizen!.partnerId = b.id; b.components.citizen!.partnerId = a.id;
    expect(startReproduction(w, a, 'sexual', b)).toBe(true);
    const due = a.components.reproduction!.pending!.dueAt;
    setWorldLaw(w, 'civ-babies', false);
    const loaded = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry));
    w.tick = loaded.tick = due;
    resolveReproduction(w, a); resolveReproduction(loaded, loaded.entities.get(a.id)!);
    expect(loaded.snapshot()).toEqual(w.snapshot());
    const children = [...w.query('person')].filter(e => e.components.citizen!.parents.includes(a.id));
    expect(children).toHaveLength(1); expect(children[0].components.person!.age).toBe(0);
    const before = w.snapshot(); resolveReproduction(w, a); expect(w.snapshot()).toEqual(before);
    const rng = w.rng.state, food = a.components.citizen!.hunger;
    expect(startReproduction(w, a, 'sexual', b)).toBe(false);
    expect(a.components.reproduction!.last!.reason).toBe('Births disabled by world law');
    expect(w.rng.state).toBe(rng); expect(a.components.citizen!.hunger).toBe(food);
  });

  it('cancels a growth portion, saves its cancellation, and enables only a fresh interval', () => {
    const w = flatWorld(); for (let i = 0; i < 300; i++) w.spawn('core:tree', { x: 5 + i % 20, y: 5 + Math.floor(i / 20) }, 'planted');
    w.tick = 30; runWorldProcesses(w, 'resources');
    const task = w.processes.tasks.find(t => t.id === 'core:tree-growth')!;
    expect(task.pending!.cursor).toBe(256);
    w.paused = true; setWorldLaw(w, 'trees-growth', false); setWorldLaw(w, 'random-seeds', false);
    const loaded = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry));
    expect(loaded.processes).toEqual(w.processes); expect(task.pending).toBeNull();
    const ages = [...loaded.query('tree')].map(e => e.components.tree!.age);
    loaded.tick = 60000; loaded.paused = false; runWorldProcesses(loaded, 'resources');
    expect([...loaded.query('tree')].map(e => e.components.tree!.age)).toEqual(ages);
    setWorldLaw(loaded, 'trees-growth', true);
    expect(loaded.processes.tasks.find(t => t.id === task.id)!.nextAt).toBe(60030);
    expect(loaded.processes.tasks.find(t => t.id === 'core:spread-vegetation')!.enabled).toBe(false);
    setWorldProcessEnabled(loaded, 'core:burned-tiles', false);
    setWorldLaw(loaded, 'armies', false);
    expect(loaded.processes.tasks.find(t => t.id === 'core:burned-tiles')!.enabled).toBe(false);
  });

  it('protects soil and stops fire spread while preserving blast damage and explicit exceptions', () => {
    const w = flatWorld(), victim = w.spawn('core:person', { x: 20, y: 20 })!, tree = w.spawn('core:tree', { x: 22, y: 20 })!;
    setWorldLaw(w, 'gaia', true);
    const soil = w.terrain.snapshot(), health = victim.components.health!.current;
    applyEvent(w, { kind: 'blast', x: 20, y: 20, radius: 4, power: 10, heat: 0 }); processEvents(w);
    expect(victim.components.health!.current).toBeLessThan(health); expect(w.terrain.snapshot()).toEqual(soil);
    tree.components.thermal!.burning = true; w.tick = 15; w.events.length = 0;
    fire(w, STEP);
    expect(w.events.some(e => e.kind === 'heat')).toBe(false); expect(w.terrain.snapshot()).toEqual(soil);
    for (const action of ['fire', 'heat-ray', 'antimatter', 'goo', 'conway', 'civ-seeds'] as const) expect(terrainChangeAllowed(w, action)).toBe(false);
    for (const action of ['manual', 'acid', 'volcano', 'stomp', 'evil-wall'] as const) expect(terrainChangeAllowed(w, action)).toBe(true);
    applyEvent(w, { kind: 'surface', x: 8, y: 8, radius: 1, terrain: Terrain.Crater, origin: 'acid' });
    expect(w.terrain.at(8, 8)).toBe(Terrain.Crater);
  });

  it('separates settlement admissions from the global population cap without evicting anybody', () => {
    const w = flatWorld(), home = w.spawn('core:house', { x: 20, y: 20 })!, village = assignHouse(w, home);
    for (let i = 0; i < 100; i++) w.spawn('core:person', { x: 10, y: 10 })!.components.citizen!.villageId = village.id;
    setWorldLaw(w, 'population-100', true);
    const newcomer = w.spawn('core:person', { x: 40, y: 40 })!;
    expect(w.population).toBe(101); expect(settlementRoom(w, village.id)).toBe(0);
    expect(canJoinSettlement(w, newcomer, village.id)).toBe(false);
    expect(canJoinSettlement(w, [...w.query('citizen')][0], village.id)).toBe(true);
    setWorldLaw(w, 'population-100', false); expect(canJoinSettlement(w, newcomer, village.id)).toBe(true);
    while (w.population < POPULATION_LIMIT) w.spawn('core:person', { x: 40, y: 40 });
    expect(w.spawn('core:person', { x: 40, y: 40 })).toBeUndefined();
  });

  it('reserves incoming pregnancies once and releases cancelled travel reservations', () => {
    const w = flatWorld(), home = w.spawn('core:house', { x: 20, y: 20 })!, village = assignHouse(w, home);
    for (let i = 0; i < 98; i++) w.spawn('core:person', { x: 10, y: 10 })!.components.citizen!.villageId = village.id;
    const a = w.spawn('core:person', { x: 40, y: 40 })!, b = w.spawn('core:person', { x: 41, y: 40 })!;
    for (const e of [a, b]) { e.components.person!.age = 25; e.components.traits!.entries = []; e.components.citizen!.hunger = 0; e.components.reproduction!.cooldowns = {}; }
    a.components.person!.sex = 'a'; b.components.person!.sex = 'b';
    a.components.citizen!.partnerId = b.id; b.components.citizen!.partnerId = a.id;
    expect(startReproduction(w, a, 'sexual', b)).toBe(true);
    setWorldLaw(w, 'population-100', true);
    b.components.citizen!.villageId = village.id;
    expect(settlementRoom(w, village.id)).toBe(1); expect(canJoinSettlement(w, a, village.id)).toBe(false);
    b.components.citizen!.villageId = null;
    expect(canJoinSettlement(w, a, village.id)).toBe(true);
    w.society.migrations.push({ id: w.society.nextMigrationId++, fromId: village.id, toId: village.id,
      destination: { x: 20, y: 20 }, members: [a.id], homeIds: [home.id], food: 0, started: w.tick });
    expect(settlementRoom(w, village.id)).toBe(0);
    expect(canJoinSettlement(w, a, village.id)).toBe(true); expect(canJoinSettlement(w, b, village.id)).toBe(false);
    w.society.migrations.pop(); expect(settlementRoom(w, village.id)).toBe(2);
    a.components.citizen!.villageId = village.id;
    w.tick = a.components.reproduction!.pending!.dueAt; resolveReproduction(w, a);
    expect([...w.query('citizen')].filter(e => e.components.citizen!.villageId === village.id)).toHaveLength(100);
    expect(settlementRoom(w, village.id)).toBe(0);
  });

  it('does not expand cultural civilian exceptions to unknown cultures', () => {
    const a = { species: 'human', culture: 'one', xenophobic: true, xenophile: false };
    expect(protectedCivilian(false, a, { ...a })).toBe(true); // Same species AND culture wins even with xenophobia.
    expect(protectedCivilian(false, a, { ...a, culture: 'two', xenophile: true })).toBe(false);
    expect(protectedCivilian(false, { ...a, xenophobic: false, xenophile: true }, { ...a, species: 'elf', xenophobic: false })).toBe(true);
    expect(protectedCivilian(false, { ...a, culture: null }, { ...a, culture: null })).toBe(false);
    expect(protectedCivilian(true, a, a)).toBe(false);
    const w = flatWorld(); expect(setWorldLaw(w, 'angry-villagers', true).ok).toBe(false);
    expect(setWorldLaw(w, 'handsome-migrants', true).ok).toBe(false); // No social-owner substitute may create unlinked migrants.
  });

  it('keeps experimental access in one world and blocks an editor draft after revocation', () => {
    const w = flatWorld(), e = w.spawn('core:person', { x: 20, y: 20 })!, draft = createGenomeDraft(w, e.id)!;
    expect(applyGenomeEdit(w, draft).ok).toBe(false);
    setForbiddenKnowledge(w, true); expect(canUseWorldEditors(w)).toBe(true); expect(canEarnWorldProgress(w)).toBe(false);
    expect(canUseWorldEditors(flatWorld())).toBe(false);
    const loaded = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry)); expect(canUseWorldEditors(loaded)).toBe(true);
    setForbiddenKnowledge(w, false); const before = w.snapshot();
    expect(applyGenomeEdit(w, draft).ok).toBe(false); expect(w.snapshot()).toEqual(before);
    expect(w.registry.tools.get('core:human')).toBeDefined();
  });

  it('gates starvation and old-age damage independently of explosions and preserves nutrition', () => {
    const w = flatWorld(), e = w.spawn('core:person', { x: 20, y: 20 })!, before = e.components.health!.current, food = e.components.citizen!.hunger;
    setWorldLaw(w, 'hunger', false); setWorldLaw(w, 'old-age', false);
    for (const cause of ['hunger', 'age'] as const) applyEvent(w, { kind: 'damage', target: e.id, amount: before, cause });
    expect(e.components.health!.current).toBe(before); expect(e.components.citizen!.hunger).toBe(food);
    applyEvent(w, { kind: 'damage', target: e.id, amount: 1, cause: 'explosion' }); expect(e.components.health!.current).toBe(before - 1);
  });

  it('keeps manual biome painting available when natural recovery and seeding are disabled', () => {
    const w = flatWorld(); setWorldLaw(w, 'grow-grass', false); setWorldLaw(w, 'random-seeds', false); setWorldLaw(w, 'gaia', true);
    const before = w.terrain.biomeAt(20, 20).id;
    w.registry.tools.get('core:biome-desert')!.apply(w, { x: 20, y: 20 });
    expect(w.terrain.biomeAt(20, 20).id).not.toBe(before);
    expect(w.processes.tasks.find(t => t.id === 'core:burned-tiles')!.enabled).toBe(false);
  });

  it('stops ongoing monster attacks while leaving their movement and lifetimes active', () => {
    const w = flatWorld(), wolf = w.spawn('core:wolf', { x: 20, y: 20 })!, sheep = w.spawn('core:sheep', { x: 21, y: 20 })!;
    const dragon = w.spawn('core:dragon', { x: 30, y: 20 })!, ufo = w.spawn('core:ufo', { x: 40, y: 20 })!;
    wolf.components.animal!.targetId = sheep.id; dragon.components.dragon!.breath = 1; ufo.components.ufo!.phase = 'beam';
    setWorldLaw(w, 'peaceful-monsters', true);
    const before = { ...dragon.components.position! };
    w.step();
    expect(performAttack(w, wolf, sheep)).toBe(false);
    expect(wolf.components.animal!.targetId).toBeNull(); expect(dragon.components.dragon!.breath).toBe(0);
    expect(ufo.components.ufo!.phase).toBe('cruise'); expect(dragon.components.position).not.toEqual(before);
    expect(() => decodeSave(w.snapshot(), w.registry)).not.toThrow();
  });

  it('preserves ordinary lava lifetime when enabled but still accepts rain cooling', () => {
    const w = flatWorld(); w.startScenario(GEOHAZARDS.id);
    const lava = { x: 20, y: 20, radius: 1.6, age: 2, remaining: 10, seed: 1, etched: true };
    geohazards(w)!.lava.push(lava); setWorldLaw(w, 'eternal-lava', true);
    const update = w.systems.find(s => s.id === GEOHAZARDS.id)!.update;
    update(w, STEP); expect(lava.remaining).toBe(10);
    w.effects.push({ kind: 'rain', x: 20, y: 20, radius: 3, remaining: 1 }); update(w, STEP); expect(lava.remaining).toBeCloseTo(10 - STEP * 4);
    w.effects.length = 0; setWorldLaw(w, 'eternal-lava', false); const prior = lava.remaining; update(w, STEP); expect(lava.remaining).toBeCloseTo(prior - STEP);
  });

  it('applies creation-only genes without rewriting existing subspecies and changes walking speed reversibly', () => {
    const w = flatWorld(), old = w.spawn('core:person', { x: 5, y: 5 })!, genome = structuredClone(subspeciesOf(old)!.genetics);
    setWorldLaw(w, 'gene-spaghetti', true); const fresh = w.spawn('core:person', { x: 40, y: 40 })!;
    expect(subspeciesOf(old)!.genetics).toEqual(genome); expect(subspeciesOf(fresh)!.genetics!.generation.spaghetti).toBe(true);
    w.spawn('core:tree', { x: 6, y: 5 }); const slowed = equipmentSpeed(w, old);
    setWorldLaw(w, 'entanglewood', false); expect(slowed / equipmentSpeed(w, old)).toBeCloseTo(0.8);
  });

  it('migrates v61 without generating resources, rejects corrupt rules, and keeps metadata out of RNG', () => {
    const w = flatWorld(), raw = w.snapshot(); raw.version = 61; delete raw.worldRules;
    const migrated = decodeSave(raw, w.registry);
    expect(migrated.entities).toEqual(raw.entities); expect(migrated.terrain).toEqual(raw.terrain); expect(migrated.rngState).toBe(raw.rngState);
    expect(migrated.worldRules!.forbiddenKnowledge).toBe(false); expect(Object.keys(migrated.worldRules!.values)).toHaveLength(48);
    const rng = w.rng.state; expect(setArchitect(w, '<creator>', 'chaotic')).toBe(true); expect(w.rng.state).toBe(rng);
    for (const corrupt of [(s: typeof migrated) => { s.worldRules!.values.hunger = 'yes' as never; },
      (s: typeof migrated) => { s.worldRules!.values['rat-king'] = true; },
      (s: typeof migrated) => { s.worldRules!.architect.mood = 'missing' as never; }]) {
      const broken = structuredClone(migrated); corrupt(broken); expect(() => decodeSave(broken, w.registry)).toThrow();
    }
    for (const d of WORLD_LAWS) for (const language of languages.filter(l => l.id !== 'en')) for (const key of [d.label, d.action]) expect(translate(key, language.id)).not.toBe(key);
  });

  it('does not process paused worlds and reaches the same result at 1x and 20x', () => {
    const source = flatWorld(); source.spawn('core:tree', { x: 20, y: 20 }, 'planted'); setWorldLaw(source, 'fast-trees-growth', true);
    source.paused = true; const before = source.snapshot(); source.step(); runWorldProcesses(source, 'resources'); expect(source.snapshot()).toEqual(before);
    source.paused = false; const save = source.snapshot();
    const results = ([1, 20] as const).map(speed => {
      const w = new World(source.seed, source.registry, save), clock = new FixedClock(() => 0); let now = 0;
      clock.advance(now, true, () => w.step(), speed);
      while (w.tick < 300) clock.advance(now += 1000 / 60, true, () => { if (w.tick < 300) w.step(); }, speed);
      return w.snapshot();
    });
    expect(results[0]).toEqual(results[1]);
  });
});
