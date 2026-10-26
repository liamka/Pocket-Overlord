import { describe, expect, it } from 'vitest';
import { editorWorld as flatWorld } from './helpers';
import { SOURCE_GENOMES, SOURCE_BASES, SOURCE_SPECIALS, referenceGenomeBudget, speciesReference } from '../src/content/species-reference';
import { speciesComparison, validSpeciesParameters } from '../src/core/species-profiles';
import { compatibilityParameters } from '../src/content/species-profiles';
import { calculateGenome, generateGenome, geneticSex, legacyGenome } from '../src/core/genetics';
import { applyGenomeEdit, createGenomeDraft } from '../src/core/gene-editor';
import { bindSubspecies, subspeciesOf } from '../src/core/subspecies-state';
import { Random } from '../src/core/random';
import { calculateStats, reconcileStats, setStatModifier, unitStats } from '../src/core/unit-stats';
import { World } from '../src/core/world';
import { Terrain, type Entity } from '../src/core/types';
import { decodeSave } from '../src/persistence/schema';
import { assignHouse } from '../src/systems/society';
import { cargoContents, makeCargo, stockOf } from '../src/core/resource-ledger';
import { collectKillDrops } from '../src/core/resource-sources';
import { creatureDrops, creatureMass, bundleLoad } from '../src/core/resources';
import { BONE } from '../src/core/bone';

describe('species bases and genome budgets', () => {
  it('keeps all 114 groups and distinguishes absent contributions, zero, conflicts and named resource icons', () => {
    expect(SOURCE_GENOMES).toHaveLength(114); expect(new Set(SOURCE_GENOMES.map(g => g.id)).size).toBe(114);
    expect(referenceGenomeBudget('human')!.health).toBe(100);
    expect(referenceGenomeBudget('ostrich')!.armor).toBe(0);
    expect(referenceGenomeBudget('human')!.armor).toBeNull();
    expect(referenceGenomeBudget('zombie')).toBeNull();
    expect(SOURCE_BASES.find(b => b.id === 'navy-seal')!.stats.baseMass).toBe(300);
    expect(SOURCE_SPECIALS.find(b => b.id === 'navy-seal')!.mass).toBe(0);
    expect(SOURCE_SPECIALS.find(b => b.id === 'dwarf')!.baseDrops).toEqual({ meat: 2, bone: 1, stone: 1 });
    expect(speciesReference('mush-animal')!.bases).toHaveLength(2);
    expect(speciesReference('boat')!.commonExceptions['boat-trading'].attackSpeed).toBe(0.1);
  });

  it('adds tumor and civil inheritance once before placing numeric and special genes', () => {
    expect(referenceGenomeBudget('bioblob')!.health).toBe(300);
    expect(referenceGenomeBudget('baakin', true)!.diplomacy).toBe(7);
    const budget = referenceGenomeBudget('human')!, targets = Object.fromEntries(Object.entries(budget).filter((p): p is [string, number] => p[1] !== null));
    const a = new Random(72), b = new Random(72), genome = generateGenome(a, 12345, 'big', targets);
    expect(generateGenome(b, 12345, 'big', targets)).toEqual(genome); expect(a.state).toBe(b.state);
    const genes = genome.chromosomes.flatMap(c => c.cells.map(l => l.gene));
    expect(genes.filter(g => g === 'female' || g === 'male')).toHaveLength(2);
    expect(genes.filter(g => g === 'mutagenic')).toHaveLength(1);
    expect(genes.filter(g => g === 'harmful').length).toBeGreaterThanOrEqual(2);
  });

  it('does not add the same human budget as both direct stats and chromosomes', () => {
    const w = flatWorld(), e = w.spawn('core:person', { x: 20, y: 20 })!;
    e.components.traits!.entries = [];
    const draft = createGenomeDraft(w, e.id)!;
    for (const c of draft.genome.chromosomes) for (const l of c.cells) if (l.kind === 'open') l.gene = null;
    draft.genome.chromosomes[0].cells.find(l => l.kind === 'open')!.gene = 'health-3';
    expect(applyGenomeEdit(w, draft).ok).toBe(true);
    const value = unitStats(w, e), genes = calculateGenome(subspeciesOf(e)!.genetics!, geneticSex(e));
    expect(value.explanations.health.base).toBe(70);
    expect(value.values.health).toBe(70 + genes.flat.health!);
    expect(speciesComparison(w, 'human', e)!.local!.genomeBudget!.health).toBe(10);
    expect(speciesComparison(w, 'human', e)!.reference!.effectiveBudget!.health).toBe(100);
  });

  it('preserves an inherited body without a zombie budget and clamps a model insect with direct and genetic contributions', () => {
    const w = flatWorld(), original = w.spawn('core:person', { x: 20, y: 20 })!;
    const body = structuredClone(original); body.components.traits!.entries = [];
    body.components.stats!.base.health = 321;
    expect(referenceGenomeBudget('zombie')).toBeNull(); expect(calculateStats(body).values.health).toBe(321);
    const insect = SOURCE_BASES.find(b => b.id === 'beetle')!, budget = referenceGenomeBudget('beetle')!;
    Object.assign(body.components.stats!.base, { health: insect.stats.health, speed: insect.stats.speed, damage: insect.stats.damage, attackSpeed: 70 });
    const genetics = legacyGenome(w.seed); genetics.chromosomes[0].cells[0].gene = 'health-1';
    bindSubspecies(body, { ...subspeciesOf(original)!, genetics });
    expect(budget.health).toBe(1); expect(calculateStats(body).values.health).toBe(2);
    expect(calculateStats(body).values.attackSpeed).toBe(10);
  });

  it('keeps old dragon genes, health, behavior, age and RNG through loading, while new direct species have no editor', () => {
    const w = flatWorld(), dragon = w.spawn('core:dragon', { x: 20, y: 20 })!, shared = subspeciesOf(dragon)!;
    expect(shared.genetics).toBeUndefined(); expect(createGenomeDraft(w, dragon.id)).toBeUndefined();
    // Version 57 before this catalogue generated additive chromosomes even for unique bodies.
    shared.genetics = generateGenome(w.rng, w.seed); reconcileStats(w, dragon);
    dragon.components.health!.current = 17; dragon.components.dragon!.breath = 0.5;
    const saved = w.snapshot(), restored = new World(w.seed, w.registry, decodeSave(saved, w.registry));
    expect(restored.entities.get(dragon.id)!.components).toEqual(dragon.components);
    expect(restored.rng.state).toBe(w.rng.state);
    expect(createGenomeDraft(restored, dragon.id)).toBeUndefined();
    for (let i = 0; i < 15; i++) { w.step(); restored.step(); }
    expect(restored.snapshot()).toEqual(w.snapshot());
  });

  it('exports an independent comparison without spawning, editing, changing RNG or sharing mutable definitions', () => {
    const w = flatWorld(), before = w.snapshot(), comparison = speciesComparison(w, 'human')!;
    expect(comparison.local!.baseStats.health).toBe(70);
    comparison.local!.genomeBudget!.health = 999;
    expect(speciesComparison(w, 'human')!.local!.genomeBudget!.health).toBe(10);
    expect(w.snapshot()).toEqual(before);
    expect(speciesComparison(w, 'zombie')!.local).toBeNull();
    expect(speciesComparison(w, 'ufo')!.local!.genomeEditor).toBe(false);
    expect(validSpeciesParameters(compatibilityParameters('human'))).toBe(true);
    expect(validSpeciesParameters({ ...compatibilityParameters('human'), genomeBudget: { health: -1 } })).toBe(false);
  });
});

function hunt() {
  const w = flatWorld(), home = w.spawn('core:house', { x: 8, y: 20 })!, village = assignHouse(w, home);
  const killer = w.spawn('core:person', { x: 20, y: 20 })!;
  killer.components.citizen!.villageId = village.id;
  return { w, killer, village };
}
function die(w: World, e: Entity, killer?: Entity): void {
  e.components.health!.current = 0; w.die(e.id, { cause: 'conflict', sourceId: killer?.id });
}

describe('mass-based physical drops', () => {
  it('applies child mass before rounding and caps each resource independently', () => {
    const mass = { baseMass: 125, modifier: 0.3, size: 0.2, child: true };
    expect(creatureMass(mass)).toBe(130);
    expect(creatureDrops({ meat: 2, bone: 1 }, mass)).toEqual({ meat: 6, bone: 2 });
    expect(creatureDrops({ meat: 2, bone: 1 }, { ...mass, child: false })).toEqual({ meat: 14, bone: 4 });
    expect(creatureDrops({ meat: 2, bone: 1, stone: 1 }, { ...mass, baseMass: 1e6 })).toEqual({ meat: 30, bone: 30, stone: 30 });
  });

  it('uses the actual size and child age in the death transaction', () => {
    const { w } = hunt(), adult = w.spawn('core:sheep', { x: 30, y: 20 })!, child = w.spawn('core:sheep', { x: 32, y: 20 })!;
    adult.components.animal!.age = 30; child.components.animal!.age = 0;
    for (const e of [adult, child]) setStatModifier(w, e, { id: 'large-body', origin: 'personal', flat: {}, percent: { scale: 100 } });
    die(w, adult); die(w, child);
    const piles = [...w.query('resourcePile')];
    expect(piles.find(p => p.components.resourcePile!.originId === adult.id)!.components.resourcePile!.goods).toEqual({ meat: 3, bone: 2, leather: 4 });
    expect(piles.find(p => p.components.resourcePile!.originId === child.id)!.components.resourcePile!.goods).toEqual({ meat: 1, bone: 1, leather: 2 });
  });

  it('fills only the killer’s remaining capacity, keeps overflow, and neither death nor loading duplicates the reward', () => {
    const { w, killer, village } = hunt(), sheep = w.spawn('core:sheep', { x: 21, y: 20 })!;
    sheep.components.animal!.age = 30;
    killer.components.citizen!.work = { good: 'wood', progress: 0, cargo: makeCargo({ wood: 10 }, village.id) };
    const beforeStock = stockOf(village, 'meat'); die(w, sheep, killer);
    const goods = cargoContents(killer.components.citizen!.work!.cargo!), pile = [...w.query('resourcePile')][0];
    expect(goods).toEqual({ wood: 10, meat: 2, bone: 1, leather: 1 });
    expect(bundleLoad(goods).volume).toBe(24); expect(pile.components.resourcePile!.goods.leather).toBe(1);
    expect(stockOf(village, 'meat')).toBe(beforeStock);
    const saved = w.snapshot(); w.die(sheep.id, { cause: 'conflict', sourceId: killer.id }); expect(w.snapshot()).toEqual(saved);
    const restored = new World(w.seed, w.registry, decodeSave(saved, w.registry));
    expect(restored.snapshot()).toEqual(saved);
    expect(collectKillDrops(w, killer, pile)).toBe(false); expect(w.snapshot()).toEqual(saved);
  });

  it('leaves loot for unsupported carriers, distant killers, blocked approaches, expired piles and missing owners', () => {
    const { w, killer, village } = hunt(), sheep = w.spawn('core:sheep', { x: 23, y: 20 })!; sheep.components.animal!.age = 30;
    die(w, sheep, killer); const pile = [...w.query('resourcePile')][0], original = structuredClone(pile.components.resourcePile!.goods);
    expect(killer.components.citizen!.work?.cargo).toBeFalsy();
    const wolf = w.spawn('core:wolf', { x: 23, y: 20 })!;
    expect(collectKillDrops(w, wolf, pile)).toBe(false);
    Object.assign(killer.components.position!, { x: 21.5, y: 20 }); w.spatial.update(killer);
    w.terrain.tiles[w.terrain.index(22, 20)] = Terrain.Water;
    expect(collectKillDrops(w, killer, pile)).toBe(false);
    w.terrain.tiles[w.terrain.index(22, 20)] = Terrain.Grass;
    killer.components.citizen!.villageId = null; expect(collectKillDrops(w, killer, pile)).toBe(false);
    killer.components.citizen!.villageId = village.id;
    w.tick = pile.components.resourcePile!.createdAt + BONE.remainsTicks; expect(collectKillDrops(w, killer, pile)).toBe(false);
    expect(pile.components.resourcePile!.goods).toEqual(original);
    w.remove(killer.id); expect(collectKillDrops(w, killer, pile)).toBe(false);
  });

  it('pauses and resumes the same physical delivery after a save, without crediting the village early', () => {
    const { w, killer, village } = hunt(), sheep = w.spawn('core:sheep', { x: 21, y: 20 })!; sheep.components.animal!.age = 30;
    const before = stockOf(village, 'meat');
    die(w, sheep, killer);
    expect(stockOf(village, 'meat')).toBe(before);
    const restored = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry));
    w.paused = true; const paused = w.snapshot(); w.step(); expect(w.snapshot()).toEqual(paused); w.paused = false;
    for (let i = 0; i < 300; i++) { w.step(); restored.step(); }
    expect(restored.snapshot()).toEqual(w.snapshot()); expect(restored.rng.state).toBe(w.rng.state);
    expect(stockOf(village, 'meat')).toBeGreaterThan(before);
  });
});
