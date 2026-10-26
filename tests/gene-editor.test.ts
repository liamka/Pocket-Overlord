import { describe, expect, it, vi } from 'vitest';
import { editorWorld as flatWorld } from './helpers';
import { World } from '../src/core/world';
import type { Entity } from '../src/core/types';
import { applyGenomeEdit, createGenomeDraft, previewGenomeStats, swapGenomeLoci } from '../src/core/gene-editor';
import { legacyGenome } from '../src/core/genetics';
import { subspeciesOf } from '../src/core/subspecies-state';
import * as stats from '../src/core/unit-stats';
import { cloneOffspring, resolveReproduction, setReproductionProfile, startReproduction } from '../src/core/reproduction';
import { decodeSave } from '../src/persistence/schema';

function neutral(world: World, entity: Entity): void {
  subspeciesOf(entity)!.genetics = legacyGenome(world.seed);
  for (const e of world.query('subspecies')) if (e.components.subspecies!.id === entity.components.subspecies!.id) stats.reconcileStats(world, e);
}

describe('shared genome transitions', () => {
  it('previews both sexes privately, including repeated edits to the same draft', () => {
    const w = flatWorld(), e = w.spawn('core:person', { x: 20, y: 20 })!; neutral(w, e);
    const before = w.snapshot(), draft = createGenomeDraft(w, e.id)!;
    const base = previewGenomeStats(w, e, draft.genome, 'a').health;
    draft.genome.chromosomes[0].cells[0].gene = 'health-3'; draft.genome.chromosomes[0].cells[1].gene = 'male';
    expect(previewGenomeStats(w, e, draft.genome, 'a').health).toBe(base + 50);
    expect(previewGenomeStats(w, e, draft.genome, 'b').health).toBe(base + 200);
    draft.genome.chromosomes[0].cells[0].gene = 'health-4';
    expect(previewGenomeStats(w, e, draft.genome, 'b').health).toBe(base + 400);
    expect(w.snapshot()).toEqual(before);
  });

  it('swaps across chromosomes without adding genes and refuses fixed loci', () => {
    const w = flatWorld(), e = w.spawn('core:person', { x: 20, y: 20 })!; neutral(w, e);
    const draft = createGenomeDraft(w, e.id)!;
    draft.genome.chromosomes.push(structuredClone(draft.genome.chromosomes[0]));
    draft.genome.chromosomes[0].cells[0].gene = 'health-3'; draft.genome.chromosomes[1].cells[1].gene = 'male';
    const genes = () => draft.genome.chromosomes.flatMap(c => c.cells.flatMap(l => l.gene ? [l.gene] : [])).sort();
    const before = genes();
    expect(swapGenomeLoci(draft, { chromosome: 0, locus: 0 }, { chromosome: 1, locus: 1 })).toBe(true);
    expect(genes()).toEqual(before); expect(draft.genome.chromosomes[0].cells[0].gene).toBe('male');
    expect(swapGenomeLoci(draft, { chromosome: 0, locus: 0 }, { chromosome: 1, locus: 9 })).toBe(false);
    expect(genes()).toEqual(before);
  });

  it('recalculates every living member once under load without healing, energy, RNG or changes to another group', () => {
    const w = flatWorld(), members = Array.from({ length: 180 }, () => w.spawn('core:person', { x: 10, y: 20 })!);
    const other = w.spawn('core:person', { x: 40, y: 20 })!; neutral(w, members[0]);
    for (const e of members) { e.components.health!.current = 14; e.components.stats!.stamina = 7; }
    const draft = createGenomeDraft(w, members[0].id)!, rng = w.rng.state, otherBefore = structuredClone(other);
    draft.genome.chromosomes[0].cells[0].gene = 'health-5';
    w.paused = true;
    const reconcile = vi.spyOn(stats, 'reconcileStats');
    try {
      expect(applyGenomeEdit(w, draft)).toEqual({ ok: true, affected: members.length });
      expect(reconcile.mock.calls.map(([, e]) => e.id)).toEqual(members.map(e => e.id));
      expect(members.every(e => e.components.health!.current === 14 && e.components.stats!.stamina === 7)).toBe(true);
      expect(other).toEqual(otherBefore); expect(w.rng.state).toBe(rng);
      expect(subspeciesOf(members[0])!.genetics!.gmo).toBe(true);
      expect(applyGenomeEdit(w, draft)).toEqual({ ok: false, reason: 'Genome changed while editing' });
      expect(reconcile).toHaveBeenCalledTimes(members.length);
    } finally { reconcile.mockRestore(); }
    const reduced = createGenomeDraft(w, members[0].id)!;
    members[0].components.health!.current = members[0].components.health!.max;
    reduced.genome.chromosomes[0].cells[0].gene = null;
    expect(applyGenomeEdit(w, reduced).ok).toBe(true);
    expect(members[0].components.health!.current).toBe(members[0].components.health!.max);
    expect(() => decodeSave(w.snapshot(), w.registry)).not.toThrow();
  });

  it('rejects stale, dead, unknown-gene and topology-changing drafts without partial application', () => {
    const w = flatWorld(), e = w.spawn('core:person', { x: 20, y: 20 })!; neutral(w, e);
    const draft = createGenomeDraft(w, e.id)!, before = w.snapshot();
    draft.genome.chromosomes[0].cells[9] = { kind: 'open', gene: 'health-5' };
    expect(applyGenomeEdit(w, draft).ok).toBe(false); expect(w.snapshot()).toEqual(before);
    const unknown = createGenomeDraft(w, e.id)!; unknown.genome.chromosomes[0].cells[0].gene = 'missing';
    expect(applyGenomeEdit(w, unknown).ok).toBe(false); expect(w.snapshot()).toEqual(before);
    const deleted = createGenomeDraft(w, e.id)!; w.remove(e.id);
    const afterDeath = w.snapshot();
    expect(applyGenomeEdit(w, deleted)).toEqual({ ok: false, reason: 'Genome owner is gone' });
    expect(w.snapshot()).toEqual(afterDeath); expect(() => decodeSave(afterDeath, w.registry)).not.toThrow();
  });

  it('migrates 56 to neutral chromosomes without changing old stats, age, health or randomness', () => {
    const w = flatWorld(), e = w.spawn('core:person', { x: 20, y: 20 })!; neutral(w, e);
    subspeciesOf(e)!.genome.health = 17; e.components.health!.current = 14; e.components.stats!.stamina = 7;
    const raw = w.snapshot(); raw.version = 56;
    for (const s of raw.subspecies!.records) delete s.genetics;
    const before = structuredClone(raw), migrated = decodeSave(raw, w.registry);
    expect(migrated.version).toBe(w.snapshot().version); expect(migrated.entities).toEqual(before.entities);
    expect(migrated.rngState).toBe(before.rngState); expect(raw).toEqual(before);
    const loaded = new World(w.seed, w.registry, migrated);
    expect(loaded.entities.get(e.id)!.components.health).toEqual(e.components.health);
    expect(loaded.entities.get(e.id)!.components.person).toEqual(e.components.person);
  });

  it('rejects forged DNA seeds, unknown genes, malformed grids and broken lineage in saves', () => {
    const w = flatWorld(), e = w.spawn('core:person', { x: 20, y: 20 })!; neutral(w, e);
    const corrupt = [
      (s: ReturnType<World['snapshot']>) => { s.subspecies!.records[0].genetics!.dnaSeed++; },
      (s: ReturnType<World['snapshot']>) => { s.subspecies!.records[0].genetics!.chromosomes[0].cells[0].gene = '__proto__'; },
      (s: ReturnType<World['snapshot']>) => { s.subspecies!.records[0].genetics!.chromosomes[0].cells.pop(); },
      (s: ReturnType<World['snapshot']>) => { s.subspecies!.records[0].genetics!.lineage = { parentId: 999, at: 0, reason: 'birth-mutation', geneChanges: 2, traitChanges: 0 }; },
    ];
    for (const edit of corrupt) { const save = w.snapshot(); edit(save); expect(() => decodeSave(save, w.registry)).toThrow(); }
  });

  it('replays a mutagenic pregnancy across loading, freezing on pause and isolating the parent and sibling branch', () => {
    const w = flatWorld(), mother = w.spawn('core:person', { x: 20, y: 20 })!; neutral(w, mother);
    mother.components.person!.sex = 'a'; mother.components.reproduction!.cooldowns = {}; mother.components.citizen!.hunger = 0;
    const draft = createGenomeDraft(w, mother.id)!;
    for (const c of draft.genome.chromosomes[0].cells) if (c.kind === 'open') c.gene = 'mutagenic';
    applyGenomeEdit(w, draft);
    const shared = subspeciesOf(mother)!, parentGenome = structuredClone(shared.genetics), sibling = w.spawn('core:person', { x: 22, y: 20 })!;
    setReproductionProfile(w, shared.id, { ...shared.reproduction!, methods: ['parthenogenesis'], form: 'viviparity' });
    expect(startReproduction(w, mother, 'parthenogenesis')).toBe(true);
    w.rng.state = 1; // Saved regression seed whose pending birth creates a mutated branch.
    const mid = w.snapshot(), loaded = new World(w.seed, w.registry, decodeSave(mid, w.registry));
    w.paused = true; const paused = w.snapshot(); w.step(); resolveReproduction(w, mother); expect(w.snapshot()).toEqual(paused); w.paused = false;
    w.tick = loaded.tick = mother.components.reproduction!.pending!.dueAt;
    resolveReproduction(w, mother); resolveReproduction(loaded, loaded.entities.get(mother.id)!);
    expect(loaded.snapshot()).toEqual(w.snapshot()); expect(loaded.rng.state).toBe(w.rng.state);
    expect(shared.genetics).toEqual(parentGenome); expect(subspeciesOf(sibling)).toBe(shared);
    const child = [...w.query('person')].find(e => e.components.citizen!.parents.includes(mother.id))!;
    expect(child).toBeDefined();
    const branch = subspeciesOf(child)!;
    expect(branch).not.toBe(shared);
    expect(branch.genetics!.lineage).toMatchObject({ parentId: shared.id, reason: 'birth-mutation', traitChanges: 0 });
    expect(branch.traits).toEqual(shared.traits); expect(branch.traits).not.toBe(shared.traits);
    expect(branch.genetics!.chromosomes).not.toBe(shared.genetics!.chromosomes);
    expect(() => decodeSave(w.snapshot(), w.registry)).not.toThrow();
  });

  it('clones the original branch without invoking birth mutation and cancels a pregnancy when its mother disappears', () => {
    const w = flatWorld(), mother = w.spawn('core:person', { x: 20, y: 20 })!; neutral(w, mother);
    const draft = createGenomeDraft(w, mother.id)!;
    for (const cell of draft.genome.chromosomes[0].cells) if (cell.kind === 'open') cell.gene = 'mutagenic';
    applyGenomeEdit(w, draft);
    const shared = subspeciesOf(mother)!, before = structuredClone(shared.genetics), clone = cloneOffspring(w, mother)!;
    expect(subspeciesOf(clone)).toBe(shared); expect(shared.genetics).toEqual(before);
    expect(clone.components.creature!.origin).toBe('cloned'); expect(() => decodeSave(w.snapshot(), w.registry)).not.toThrow();
    const other = w.spawn('core:person', { x: 40, y: 20 })!; neutral(w, other);
    other.components.person!.sex = 'a'; other.components.reproduction!.cooldowns = {}; other.components.citizen!.hunger = 0;
    const profile = subspeciesOf(other)!; setReproductionProfile(w, profile.id, { ...profile.reproduction!, methods: ['parthenogenesis'], form: 'viviparity' });
    expect(startReproduction(w, other, 'parthenogenesis')).toBe(true);
    w.remove(other.id); const count = w.entities.size; resolveReproduction(w, other);
    expect(w.entities.size).toBe(count); expect(() => decodeSave(w.snapshot(), w.registry)).not.toThrow();
  });
});
