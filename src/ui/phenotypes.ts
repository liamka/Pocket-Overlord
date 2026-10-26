import { PALETTE_ROLES } from '../content/phenotypes';
import { applyPhenotype, createPhenotypeDraft, legacyPaletteId, permittedPalettes, phenotypeProblem, type PhenotypeDraft } from '../core/phenotypes';
import { subspeciesOf } from '../core/subspecies-state';
import { unitName } from '../core/units';
import { raceOf } from '../core/races';
import { drawResidentSprite } from '../render/residents';
import { drawAnimal } from '../render/village-life';
import { NATURAL_BIOMES } from '../core/natural-biomes';
import { hasStatus } from '../core/status-effects';
import { plagueSeverity } from '../core/afflictions';
import { translate, type Language } from '../i18n';
import type { World } from '../core/world';
import type { Entity } from '../core/types';

const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const paletteLabel = (id: string, language: Language): string => translate(id.startsWith('legacy-') ? 'Original body colors' : `palette:${id}`, language);
export function phenotypeInspector(entity: Entity, language: Language): string {
  const p = subspeciesOf(entity)?.phenotype;
  if (!p) return '';
  const tr = (s: string): string => escape(translate(s, language));
  const origin = { birth: 'Chosen when this subspecies appeared', edited: 'Changed by you', legacy: 'Original body colors', fallback: 'Unknown saved palette: original body colors are used' }[p.origin];
  const effects = ([['frozen', 'Frozen'], ['burning', 'Burning'], ['cursed', 'Cursed']] as const)
    .filter(([id]) => hasStatus(entity, id)).map(([, label]) => translate(label, language));
  if (plagueSeverity(entity) > 0.15) effects.push(translate('Plague', language));
  return `<p>${tr('Body palette')}: ${escape(paletteLabel(p.paletteId, language))}</p><p>${tr(origin)}${p.biome === null ? '' : ` · ${tr('Origin biome')}: ${tr(NATURAL_BIOMES[p.biome]?.name ?? '')}`}</p>
    ${effects.length ? `<p>${escape(translate('Temporary appearance: {effects}. The body palette is preserved.', language, { effects: effects.join(', ') }))}</p>` : ''}
    <p>${tr('Body colors do not change abilities.')}</p><button type="button" data-edit-phenotype>${tr('Edit subspecies appearance')}</button>`;
}
/** UI-owned draft; only Apply publishes a single shared palette. Preview never consumes simulation RNG. */
export class PhenotypeEditor {
  private readonly dialog = document.createElement('dialog');
  private world?: World;
  private language: Language = 'en';
  private draft?: PhenotypeDraft;
  private problem = '';
  private notice = '';
  constructor(root: HTMLElement) {
    this.dialog.className = 'phenotype-editor'; this.dialog.setAttribute('aria-labelledby', 'phenotype-title'); root.append(this.dialog);
    this.dialog.addEventListener('close', () => { this.draft = undefined; });
    this.dialog.addEventListener('change', event => {
      const input = event.target as HTMLSelectElement;
      if (input.id === 'phenotype-choice' && this.draft) { this.draft.paletteId = input.value; this.notice = ''; this.render(); this.dialog.querySelector<HTMLElement>('#phenotype-choice')?.focus(); }
    });
    this.dialog.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!button || !this.world || !this.draft) return;
      if (button.hasAttribute('data-phenotype-close')) this.dialog.close();
      if (button.hasAttribute('data-phenotype-reload')) this.open(this.world, this.draft.entityId, this.language);
      if (button.hasAttribute('data-phenotype-apply')) {
        const result = applyPhenotype(this.world, this.draft);
        this.notice = result.ok ? translate('Body colors updated for {count} living members.', this.language, { count: result.affected! }) : translate(result.reason!, this.language);
        if (result.ok) this.draft = createPhenotypeDraft(this.world, this.draft.entityId);
        this.render();
      }
    });
  }
  open(world: World, entityId: number, language: Language): void {
    const draft = createPhenotypeDraft(world, entityId);
    if (!draft) return;
    this.world = world; this.language = language; this.draft = draft; this.notice = ''; this.render();
    if (!this.dialog.open) this.dialog.showModal();
  }
  update(world: World, language: Language): void {
    if (!this.dialog.open || !this.draft) return;
    if (this.world !== world) { this.dialog.close(); return; }
    const problem = phenotypeProblem(world, this.draft) ?? '';
    if (problem !== this.problem || language !== this.language) { this.language = language; this.render(); }
  }
  private render(): void {
    const world = this.world!, draft = this.draft;
    if (!draft) return;
    const e = world.entities.get(draft.entityId), s = subspeciesOf(e);
    const tr = (text: string): string => escape(translate(text, this.language));
    this.problem = phenotypeProblem(world, draft) ?? '';
    const choices = s ? [legacyPaletteId(s.speciesId), ...permittedPalettes(world.registry.species.get(s.speciesId)!)] : [];
    const colors = Object.hasOwn(PALETTE_ROLES, draft.paletteId) ? PALETTE_ROLES[draft.paletteId] : undefined;
    this.dialog.innerHTML = `<header><h2 id="phenotype-title">${tr('Subspecies appearance')}</h2><button type="button" data-phenotype-close>${tr('Готово')}</button></header>
      <p>${e ? escape(unitName(e)) : tr('Individual is no longer present')} · ${tr('Living members: {count}').replace('{count}', String(s ? s.created - s.died - s.departed : 0))}</p>
      <p>${tr('The palette changes skin or fur for the whole subspecies. Genes, abilities, clothing and equipment stay the same.')}</p>
      <label for="phenotype-choice">${tr('Body palette')}</label><select id="phenotype-choice"${this.problem ? ' disabled' : ''}>${choices.map(id => `<option value="${id}"${id === draft.paletteId ? ' selected' : ''}>${escape(paletteLabel(id, this.language))}</option>`).join('')}</select>
      ${colors ? `<div class="phenotype-swatches">${(['shadow', 'middle', 'light', 'accent'] as const).map(role => `<span><i style="background:${colors[role]}"></i>${tr(`palette-role:${role}`)}</span>`).join('')}</div>` : `<p>${tr('Original body colors')}</p>`}
      <p>${tr('Preview uses the current body model for both sexes at three ages.')}</p>
      <div class="phenotype-previews">${['Female', 'Male'].flatMap(sex => ['Young body', 'Adult body', 'Older body'].map((age, i) => `<figure><canvas width="144" height="104" data-phenotype-age="${i}" aria-label="${tr(sex)} · ${tr(age)}"></canvas><figcaption>${tr(sex)} · ${tr(age)}</figcaption></figure>`)).join('')}</div>
      <p role="status" data-phenotype-notice>${this.problem ? tr(this.problem) : escape(this.notice)}</p>
      <footer><button type="button" data-phenotype-apply${this.problem || draft.paletteId === s?.phenotype?.paletteId ? ' disabled' : ''}>${tr('Apply body palette')}</button><button type="button" data-phenotype-reload>${tr('Discard draft')}</button></footer>`;
    if (!e) return;
    for (const canvas of this.dialog.querySelectorAll<HTMLCanvasElement>('canvas')) {
      const age = Number(canvas.dataset.phenotypeAge), child = age === 0, ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false; ctx.translate(72, 82); ctx.scale(4, 4);
      if (e.components.person) drawResidentSprite(ctx, { race: raceOf(e), variant: e.components.appearance?.variant, child, body: colors, time: 0, action: 'idle', heading: Math.PI / 2 });
      else if (e.components.animal) drawAnimal(ctx, { ...e.components.animal, age: child ? 0 : age === 1 ? 20 : 100, heading: 0, stride: 0, moving: false, hunger: 0 }, undefined, !child, colors);
    }
  }
}
