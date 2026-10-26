import { describe, expect, it } from 'vitest';
import { editorWorld as flatWorld } from './helpers';
import { PHENOTYPE_PALETTES, PALETTE_ROLES } from '../src/content/phenotypes';
import { applyPhenotype, createPhenotypeDraft, permittedPalettes, phenotypeColors } from '../src/core/phenotypes';
import { subspeciesOf } from '../src/core/subspecies-state';
import { World } from '../src/core/world';
import { NaturalBiome } from '../src/core/natural-biomes';
import { unitStats } from '../src/core/unit-stats';
import { decodeSave } from '../src/persistence/schema';
import { drawResidentSprite } from '../src/render/residents';
import { drawAnimal } from '../src/render/village-life';
import { translate } from '../src/i18n';
import { applyStatus, removeStatus } from '../src/core/status-effects';
import { drawAppearanceOverlay, resolveBodyColors } from '../src/render/appearance';
import { applyEvent } from '../src/systems/effects';

describe('phenotypes owned by subspecies', () => {
  it('preserves all source endpoints and restricts the species/biome alternatives', () => {
    const w = flatWorld(), profile = (id: string) => w.registry.species.get(id)!;
    expect(PHENOTYPE_PALETTES).toHaveLength(52);
    expect(PHENOTYPE_PALETTES.find(p => p.id === 'skin-light')).toMatchObject({ from: '#F5D6BA', to: '#F3C6BE' });
    expect(permittedPalettes(profile('human'), NaturalBiome.Infernal)).toEqual(['skin-dark', 'skin-light', 'skin-mixed']);
    expect(permittedPalettes(profile('orc'), NaturalBiome.Permafrost)).toEqual(['skin-pale']);
    expect(permittedPalettes(profile('wolf'), NaturalBiome.Crystal)).toEqual(['dark-blue', 'dark-teal']);
    expect(permittedPalettes(profile('dog'), NaturalBiome.Infernal)).toEqual(['gray-black', 'white-gray', 'wood']);
    expect(permittedPalettes(profile('sheep'), NaturalBiome.Enchanted)).toEqual(['polar', 'skin-mixed', 'white-gray']);
    expect(permittedPalettes(profile('bandit'))).toContain('skin-mixed');
    for (const p of PHENOTYPE_PALETTES) for (const language of ['en', 'ru', 'zh-CN', 'ja', 'es'] as const) expect(translate(`palette:${p.id}`, language)).not.toContain('palette:');
  });

  it('reproduces founder choices with the same RNG and never chooses again when moving or growing', () => {
    const a = flatWorld(), b = flatWorld();
    for (const w of [a, b]) for (const [x, y] of [[5, 5], [28, 5], [5, 28], [28, 28]]) w.spawn('core:person', { x, y });
    expect(a.snapshot()).toEqual(b.snapshot()); expect(a.rng.state).toBe(b.rng.state);
    const e = [...a.query('person')][0], before = structuredClone(subspeciesOf(e)!.phenotype), rng = a.rng.state;
    a.terrain.setBiome(10, 10, NaturalBiome.Infernal); e.components.position = { x: 10, y: 10 };
    e.components.person!.age = 2; const child = phenotypeColors(e); e.components.person!.age = 80;
    expect(phenotypeColors(e)).toEqual(child); expect(subspeciesOf(e)!.phenotype).toEqual(before); expect(a.rng.state).toBe(rng);
  });

  it('inherits the maternal palette even when born far away in another biome', () => {
    const w = flatWorld(), mother = w.spawn('core:orc', { x: 5, y: 5 })!;
    mother.components.person!.sex = 'a';
    const draft = createPhenotypeDraft(w, mother.id)!; draft.paletteId = 'skin-red'; expect(applyPhenotype(w, draft).ok).toBe(true);
    w.terrain.setBiome(30, 30, NaturalBiome.Permafrost);
    const child = w.spawn('core:orc', { x: 30, y: 30 }, undefined, 'born', [mother.id])!;
    expect(subspeciesOf(child)!.phenotype).toEqual(subspeciesOf(mother)!.phenotype);
  });

  it('updates every member atomically on pause, without changing other subspecies, genes, stats, equipment or RNG', () => {
    const w = flatWorld(), a = w.spawn('core:person', { x: 5, y: 5 })!, b = w.spawn('core:person', { x: 6, y: 5 })!, other = w.spawn('core:person', { x: 30, y: 30 })!;
    const shared = subspeciesOf(a)!, unaffected = structuredClone(subspeciesOf(other)), genes = structuredClone(shared.genetics);
    const stats = [a, b].map(e => unitStats(w, e)), equipment = structuredClone(w.equipment), rng = w.rng.state;
    const draft = createPhenotypeDraft(w, a.id)!; draft.paletteId = shared.phenotype!.paletteId === 'skin-dark' ? 'skin-light' : 'skin-dark';
    w.paused = true; expect(applyPhenotype(w, draft)).toEqual({ ok: true, affected: 2 });
    expect(phenotypeColors(a)).toEqual(phenotypeColors(b)); expect(subspeciesOf(other)).toEqual(unaffected);
    expect(shared.genetics).toEqual(genes); expect([a, b].map(e => unitStats(w, e))).toEqual(stats);
    expect(w.equipment).toEqual(equipment); expect(w.rng.state).toBe(rng);
    const paused = w.snapshot(); w.step(); expect(w.snapshot()).toEqual(paused);
  });

  it('rejects unknown or incompatible choices, stale drafts and removed owners without side effects', () => {
    const w = flatWorld(), e = w.spawn('core:person', { x: 20, y: 20 })!;
    for (const paletteId of ['unknown-future-color', 'infernal', '__proto__']) {
      const draft = { ...createPhenotypeDraft(w, e.id)!, paletteId }, before = w.snapshot();
      expect(applyPhenotype(w, draft).ok).toBe(false); expect(w.snapshot()).toEqual(before);
    }
    const draft = createPhenotypeDraft(w, e.id)!; subspeciesOf(e)!.revision++;
    expect(applyPhenotype(w, draft).reason).toContain('changed');
    w.remove(e.id); const removed = w.snapshot();
    expect(applyPhenotype(w, draft).reason).toContain('no longer present'); expect(w.snapshot()).toEqual(removed);
  });

  it('migrates the exact old body colors without touching entities or consuming RNG, and safely resolves unknown future palette IDs', () => {
    const w = flatWorld(); for (const id of ['person', 'elf', 'orc', 'dwarf', 'dog', 'wolf', 'sheep']) w.spawn(`core:${id}`, { x: 20, y: 20 });
    const raw = w.snapshot(); raw.version = 57; for (const s of raw.subspecies!.records) delete s.phenotype;
    const original = structuredClone(raw), migrated = decodeSave(raw, w.registry), loaded = new World(w.seed, w.registry, migrated);
    expect(migrated.entities).toEqual(raw.entities); expect(migrated.rngState).toBe(raw.rngState); expect(raw).toEqual(original);
    for (const e of loaded.query('subspecies')) { expect(phenotypeColors(e)).toBeUndefined(); expect(subspeciesOf(e)!.phenotype!.origin).toBe('legacy'); }
    const unknown = loaded.snapshot(); unknown.subspecies!.records[0].phenotype!.paletteId = 'future-hologram';
    const fixed = decodeSave(unknown, w.registry);
    expect(fixed.subspecies!.records[0].phenotype).toMatchObject({ paletteId: 'legacy-human', origin: 'fallback' });
    expect(fixed.rngState).toBe(unknown.rngState);
    const invalid = loaded.snapshot(); invalid.subspecies!.records[0].phenotype!.paletteId = 'skin-green';
    expect(() => decodeSave(invalid, w.registry)).toThrow();
    delete invalid.subspecies!.records[0].phenotype; expect(() => decodeSave(invalid, w.registry)).toThrow();
  });

  it('keeps movement and palette editing deterministic across a save; a draft is never part of the save', () => {
    const w = flatWorld(), e = w.spawn('core:person', { x: 20, y: 20 })!;
    const draft = createPhenotypeDraft(w, e.id)!, saved = w.snapshot(); draft.paletteId = 'skin-light';
    expect(w.snapshot()).toEqual(saved);
    const loaded = new World(w.seed, w.registry, decodeSave(saved, w.registry));
    for (let i = 0; i < 120; i++) { w.step(); loaded.step(); }
    expect(loaded.snapshot()).toEqual(w.snapshot()); expect(loaded.rng.state).toBe(w.rng.state);
  });
});

/** Record actual paint operations: protected layers must keep their colors and geometry. */
function paint(draw: (ctx: CanvasRenderingContext2D) => void) {
  const pixels: { color: string; rect: number[] }[] = [];
  const ctx = { fillStyle: '', save() {}, restore() {}, scale() {}, fillRect(...rect: number[]) { pixels.push({ color: this.fillStyle, rect }); } };
  draw(ctx as unknown as CanvasRenderingContext2D); return pixels;
}
describe('independent body color masks', () => {
  it('preserves sleeves, hair and weapons while recoloring the skin of the same pose', () => {
    const pose = { race: 'human' as const, action: 'fight' as const, tool: 'sword' as const, work: 0.6, color: '#a7cad1' };
    const original = paint(ctx => drawResidentSprite(ctx, pose));
    const colored = paint(ctx => drawResidentSprite(ctx, { ...pose, body: PALETTE_ROLES['skin-dark'] }));
    expect(colored).not.toEqual(original);
    for (const color of ['#a7cad1', '#4d635f', '#8b6844', '#d3ded7', '#c6a76a']) {
      expect(original.some(p => p.color === color)).toBe(true);
      expect(colored.filter(p => p.color === color)).toEqual(original.filter(p => p.color === color));
    }
    expect(colored.some(p => p.color === PALETTE_ROLES['skin-dark'].middle)).toBe(true);
  });
  it('changes fur without recoloring the collar, eyes or hunger marker', () => {
    const animal = { kind: 'dog' as const, age: 20, heading: 0, stride: 0, moving: false, hunger: 80 };
    const original = paint(ctx => drawAnimal(ctx, animal, '#7ab9c0'));
    const colored = paint(ctx => drawAnimal(ctx, animal, '#7ab9c0', true, PALETTE_ROLES['wood']));
    expect(colored).not.toEqual(original);
    for (const color of ['#7ab9c0', '#152425', '#f5bd69', '#efcf77']) expect(colored.filter(p => p.color === color)).toEqual(original.filter(p => p.color === color));
  });
});

describe('legacy appearance and temporary layers', () => {
  it('keeps distinct saved clothing and hair variants across migration and repeated loading', () => {
    const w = flatWorld();
    for (let variant = 0; variant < 5; variant++) {
      const e = w.spawn('core:person', { x: 5 + variant, y: 5 })!;
      e.components.appearance!.variant = variant;
    }
    const raw = w.snapshot(); raw.version = 57;
    for (const s of raw.subspecies!.records) delete s.phenotype;
    const draw = (variant: number) => paint(ctx => drawResidentSprite(ctx, { variant }));
    const before = raw.entities.map(e => draw(e.components.appearance!.variant));
    expect(new Set(before.map(p => JSON.stringify(p))).size).toBe(5);
    let saved = decodeSave(raw, w.registry);
    for (let i = 0; i < 3; i++) {
      const loaded = new World(w.seed, w.registry, saved);
      expect([...loaded.query('person')].map(e => draw(e.components.appearance!.variant))).toEqual(before);
      expect(loaded.snapshot().entities).toEqual(raw.entities);
      expect(loaded.rng.state).toBe(raw.rngState);
      saved = decodeSave(loaded.snapshot(), w.registry);
    }
  });

  it('gives unknown legacy-prefixed colors the same stable fallback without regenerating inheritance', () => {
    const w = flatWorld(); w.spawn('core:person', { x: 20, y: 20 });
    const raw = w.snapshot(); raw.subspecies!.records[0].phenotype!.paletteId = 'legacy-unknown-shade';
    const saved = decodeSave(raw, w.registry);
    expect(saved.subspecies!.records[0].phenotype).toMatchObject({ paletteId: 'legacy-human', origin: 'fallback' });
    const loaded = new World(w.seed, w.registry, saved);
    expect(decodeSave(loaded.snapshot(), w.registry)).toEqual(saved);
    expect(saved.entities).toEqual(raw.entities); expect(saved.rngState).toBe(raw.rngState);
    expect(saved.subspecies!.records[0].genetics).toEqual(raw.subspecies!.records[0].genetics);
  });

  it('restores the exact paint after removing ice or curse, without mutating shared appearance while drawing', () => {
    for (const type of ['person', 'sheep', 'dog', 'wolf']) for (const status of ['frozen', 'cursed'] as const) {
      const w = flatWorld(), e = w.spawn(`core:${type}`, { x: 20, y: 20 })!;
      const phenotype = structuredClone(subspeciesOf(e)!.phenotype);
      const draw = () => paint(ctx => {
        if (e.components.animal) drawAnimal(ctx, e.components.animal, undefined, true, phenotypeColors(e));
        else drawResidentSprite(ctx, { body: phenotypeColors(e) });
        drawAppearanceOverlay(ctx, e, 0);
      });
      const before = draw();
      expect(applyStatus(w, e, status)).toBe(true);
      const active = w.snapshot(); expect(draw()).not.toEqual(before); expect(w.snapshot()).toEqual(active);
      removeStatus(w, e, status, 'removed');
      expect(draw()).toEqual(before); expect(subspeciesOf(e)!.phenotype).toEqual(phenotype);
    }
    const palette = PALETTE_ROLES['skin-dark'], before = resolveBodyColors('human', palette);
    expect(resolveBodyColors('human', palette, true)).not.toEqual(before);
    expect(resolveBodyColors('human', palette)).toEqual(before);
  });

  it('keeps a dead member’s palette separate from remains and a newly raised body', () => {
    const w = flatWorld(), e = w.spawn('core:person', { x: 20, y: 20 })!;
    const sibling = w.spawn('core:person', { x: 21, y: 20 })!;
    const phenotype = structuredClone(subspeciesOf(sibling)!.phenotype);
    applyEvent(w, { kind: 'damage', target: e.id, amount: 100000, cause: 'age' });
    const remains = [...w.query('resourcePile')].find(p => p.components.resourcePile!.originId === e.id)!;
    expect(phenotypeColors(remains)).toBeUndefined();
    const raised = w.raiseRemains(remains.id, 'core:wolf')!;
    expect(raised.components.creature!.speciesId).toBe('wolf');
    expect(subspeciesOf(raised)!.id).not.toBe(subspeciesOf(sibling)!.id);
    expect(subspeciesOf(sibling)!.phenotype).toEqual(phenotype);
  });
});
