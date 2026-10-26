import { GENES, GENE_DEFINITIONS } from '../content/genes';
import { calculateGenome, geneNodes } from '../core/genetics';
import { applyGenomeEdit, createGenomeDraft, draftProblem, previewGenomeStats, swapGenomeLoci, type GenomeDraft, type LocusAddress } from '../core/gene-editor';
import { subspeciesOf } from '../core/subspecies-state';
import { STAT_RULES, type StatId } from '../core/unit-stats';
import { unitName } from '../core/units';
import type { World } from '../core/world';
import { translate, type Language } from '../i18n';

const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const colors = ['#d97568', '#d7bd5d', '#83b879', '#81b9d6'];
const special: Record<string, string> = { offspring: 'Offspring capacity', 'birth-rate': 'Birth rate', 'attack-speed': 'Attack speed',
  bigger: 'Bigger size', smaller: 'Smaller size', mutagenic: 'Mutagenic', harmful: 'Harmful gene', male: 'Male bonus', female: 'Female bonus' };
const roman = ['', 'I', 'II', 'III', 'IV', 'V'];
const stateLabels = { normal: 'Normal gene', golden: 'Enhanced gene', harmful: 'Weakened gene', empty: 'Empty locus', locked: 'Closed locus' };
const previewKeys = ['health', 'stamina', 'damage', 'armor', 'speed', 'diplomacy', 'warfare', 'stewardship', 'intelligence', 'lifespan', 'attackSpeed', 'scale', 'offspring', 'birthRate', 'mutation'] as const;

/** This draft belongs to the dialog, not the simulation. Save/reload can only observe committed genomes. */
export class GeneEditor {
  private readonly dialog = document.createElement('dialog');
  private world?: World;
  private language: Language = 'en';
  private draft?: GenomeDraft;
  private chromosome = 0;
  private selected = 0;
  private sex: 'a' | 'b' = 'a';
  private gene = 'health-1';
  private swapping?: LocusAddress;
  private confirming = false;
  private notice = '';
  constructor(root: HTMLElement) {
    this.dialog.className = 'gene-editor'; this.dialog.setAttribute('aria-labelledby', 'gene-editor-title'); root.append(this.dialog);
    this.dialog.addEventListener('close', () => { this.draft = undefined; });
    this.dialog.addEventListener('change', event => {
      const input = event.target as HTMLSelectElement;
      if (input.matches('[data-gene-choice]')) this.gene = input.value;
    });
    this.dialog.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!button || !this.world || !this.draft) return;
      const action = button.dataset.geneAction;
      if (action === 'close') { this.dialog.close(); return; }
      if (action === 'reload') { this.open(this.world, this.draft.entityId, this.language); return; }
      if (button.dataset.chromosome !== undefined) {
        this.chromosome = Number(button.dataset.chromosome);
        this.selected = this.draft.genome.chromosomes[this.chromosome].cells.findIndex(l => l.kind === 'open');
        this.render(); return;
      }
      if (button.dataset.geneSex) { this.sex = button.dataset.geneSex as 'a' | 'b'; this.render(); return; }
      const cells = this.draft.genome.chromosomes[this.chromosome].cells;
      if (button.dataset.locus !== undefined) {
        const index = Number(button.dataset.locus), cell = cells[index];
        if (cell.kind !== 'open') this.notice = cell.kind === 'amplifier' ? 'Amplifier positions are fixed at creation' : 'This locus was closed at creation';
        else {
          this.notice = '';
          if (this.swapping) {
            swapGenomeLoci(this.draft, this.swapping, { chromosome: this.chromosome, locus: index });
            this.swapping = undefined; this.confirming = false;
          }
          this.selected = index;
        }
      } else if (action === 'swap') {
        this.swapping = this.swapping ? undefined : { chromosome: this.chromosome, locus: this.selected };
        this.notice = this.swapping ? 'Choose another open locus to swap' : '';
      }
      else if (action === 'replace' || action === 'clear') {
        if (cells[this.selected].kind === 'open') { cells[this.selected].gene = action === 'clear' ? null : this.gene; this.notice = ''; this.confirming = false; this.swapping = undefined; }
        else this.notice = 'This locus was closed at creation';
      } else if (action === 'review') { this.confirming = true; this.notice = ''; }
      else if (action === 'apply') {
        const result = applyGenomeEdit(this.world, this.draft);
        if (result.ok) {
          this.notice = translate('Genome applied to {count} living members', this.language, { count: result.affected });
          this.draft = createGenomeDraft(this.world, this.draft.entityId); this.confirming = false; this.swapping = undefined;
        } else this.notice = result.reason;
      }
      this.render();
    });
  }
  open(world: World, entityId: number, language: Language): void {
    this.world = world; this.language = language; this.draft = createGenomeDraft(world, entityId);
    if (!this.draft) return;
    this.chromosome = 0; this.selected = Math.max(0, this.draft.genome.chromosomes[0].cells.findIndex(l => l.kind === 'open'));
    this.confirming = false; this.swapping = undefined; this.notice = ''; this.render();
    if (!this.dialog.open) this.dialog.showModal();
  }
  update(world: World, language: Language): void {
    if (this.world && this.world !== world) { this.dialog.close(); this.draft = undefined; }
    this.world = world;
    if (language !== this.language) { this.language = language; this.render(); }
    if (this.dialog.open && this.draft) {
      const problem = draftProblem(world, this.draft);
      if (problem && !problem.ok) {
        this.notice = problem.reason;
        const output = this.dialog.querySelector('[data-gene-notice]'); if (output) output.textContent = this.tr(this.notice);
        for (const button of this.dialog.querySelectorAll<HTMLButtonElement>('[data-gene-action="apply"], [data-gene-action="review"]')) button.disabled = true;
      }
    }
  }
  private tr = (key: string, values?: Record<string, number | string>): string => translate(key, this.language, values);
  private geneLabel(id: string): string {
    const gene = GENE_DEFINITIONS[id], label = special[gene.family] ?? STAT_RULES[gene.stat!].label;
    return `${this.tr(label)}${id.includes('-') && /\d$/.test(id) ? ` ${roman[gene.level]}` : ''}`;
  }
  private render(): void {
    const world = this.world, draft = this.draft;
    if (!world || !draft) return;
    const e = world.entities.get(draft.entityId), shared = subspeciesOf(e), problem = draftProblem(world, draft);
    const tr = (key: string, values?: Record<string, number | string>) => escape(this.tr(key, values));
    const status = problem && !problem.ok ? problem.reason : this.notice;
    const chromosome = draft.genome.chromosomes[this.chromosome], effects = calculateGenome(draft.genome, this.sex);
    let html = `<header><div><h2 id="gene-editor-title">${tr('Gene editor')}</h2><p>${escape(e ? unitName(e) : this.tr('Genome owner is gone'))} · ${tr('Subspecies {id}', { id: draft.subspeciesId })}${shared?.genetics?.gmo ? ' · GMO' : ''}</p></div><button type="button" data-gene-action="close">${tr('Close')}</button></header>`;
    html += `<p>${tr('Changes affect every living member of this subspecies. Current health and energy are not restored.')}</p>`;
    if (draft.genome.lineage) html += `<p>${tr('Inherited branch {id}; {count} gene changes at birth', { id: draft.genome.lineage.parentId, count: draft.genome.lineage.geneChanges })}</p>`;
    html += `<div class="gene-layout"><section><nav aria-label="${tr('Chromosomes')}">${draft.genome.chromosomes.map((c, i) => `<button type="button" data-chromosome="${i}" aria-pressed="${i === this.chromosome}">${tr('Chromosome {number}', { number: i + 1 })} · ${c.cells.length}</button>`).join('')}</nav>`;
    html += `<div class="gene-sex"><span>${tr('Show adjacency for')}</span><button type="button" data-gene-sex="a" aria-pressed="${this.sex === 'a'}">${tr('Female')}</button><button type="button" data-gene-sex="b" aria-pressed="${this.sex === 'b'}">${tr('Male')}</button></div>`;
    html += `<div class="gene-grid" role="group" aria-label="${tr('Chromosome loci')}">`;
    for (const [i, cell] of chromosome.cells.entries()) {
      const gene = cell.gene && GENE_DEFINITIONS[cell.gene], label = cell.kind === 'locked' ? tr('Closed locus') : cell.kind === 'amplifier' ? tr('Amplifier') : gene ? escape(this.geneLabel(gene.id)) : tr('Empty locus');
      const state = effects.states[this.chromosome][i], stateLabel = tr(stateLabels[state]);
      const nodes = gene && !['mutagenic', 'harmful', 'male', 'female'].includes(gene.family) ? geneNodes(draft.genome.dnaSeed, gene.id) : undefined;
      const borders = nodes ? `border-color:${nodes.map(n => colors[n]).join(' ')}` : '';
      html += `<button type="button" data-locus="${i}" class="gene-cell gene-${state}" style="${borders}" aria-pressed="${i === this.selected}" aria-label="${tr('Locus {number}', { number: i + 1 })}: ${label} · ${stateLabel}" title="${label} · ${stateLabel}"><span>${cell.kind === 'locked' ? '×' : cell.kind === 'amplifier' ? '+' : gene ? `${escape(this.geneLabel(gene.id).split(' ')[0].slice(0, 3))}<small>${roman[gene.level]}</small>` : '·'}</span></button>`;
    }
    html += `</div><p class="gene-legend">${tr('Golden: ×2. Harmful: ×0.5 and overrides golden. Only touching sides count.')}</p>`;
    html += `<p class="gene-legend">${tr('Match the colors of every occupied neighboring side. Amplifiers and mutagenic genes match any color.')}</p>`;
    html += `<label for="gene-choice">${tr('Gene to place')}</label><select id="gene-choice" data-gene-choice>${GENES.map(g => `<option value="${g.id}"${g.id === this.gene ? ' selected' : ''}>${escape(this.geneLabel(g.id))}${g.amount ? ` (${g.amount > 0 ? '+' : ''}${g.amount}${g.percent ? '%' : ''})` : ''}</option>`).join('')}</select>`;
    html += `<div class="gene-actions"><button type="button" data-gene-action="replace">${tr('Place gene')}</button><button type="button" data-gene-action="clear">${tr('Clear locus')}</button><button type="button" data-gene-action="swap" aria-pressed="${!!this.swapping}">${tr('Swap loci')}</button></div></section>`;
    if (e && shared) {
      const before = [previewGenomeStats(world, e, shared.genetics!, 'a'), previewGenomeStats(world, e, shared.genetics!, 'b')];
      const after = [previewGenomeStats(world, e, draft.genome, 'a'), previewGenomeStats(world, e, draft.genome, 'b')];
      const n = (value: number): string => String(Math.round(value * 100) / 100);
      html += `<section><h3>${tr('Preview: current → after applying')}</h3><table class="gene-preview"><thead><tr><th>${tr('Parameter')}</th><th>${tr('Female')}</th><th>${tr('Male')}</th></tr></thead><tbody>`;
      for (const key of previewKeys) {
        const label = key === 'offspring' ? 'Additional offspring capacity' : key === 'birthRate' ? 'Additional birth attempts' : key === 'mutation' ? 'Mutation' : STAT_RULES[key as StatId].label;
        html += `<tr data-gene-stat="${key}"><th>${tr(label)}</th>${[0, 1].map(sex => `<td>${n(before[sex][key])} → <strong>${n(after[sex][key])}</strong></td>`).join('')}</tr>`;
      }
      html += `</tbody></table><p>${tr('Preview uses this creature’s age, traits and equipment. Other members keep their own differences.')}</p></section>`;
    }
    html += `</div><footer><p data-gene-notice role="status">${tr(status)}</p>`;
    if (this.confirming) html += `<p>${tr('Apply these genes to the entire subspecies and mark it GMO?')}</p><button type="button" data-gene-action="apply"${problem ? ' disabled' : ''}>${tr('Confirm genome change')}</button>`;
    else html += `<button type="button" data-gene-action="review"${problem ? ' disabled' : ''}>${tr('Review and apply')}</button>`;
    html += `<button type="button" data-gene-action="reload">${tr('Discard draft')}</button></footer>`;
    this.dialog.innerHTML = html;
  }
}
