import { speciesComparison } from '../core/species-profiles';
import { STAT_RULES, type StatId } from '../core/unit-stats';
import { GENOME_BUDGET_KEYS, type GenomeBudgetKey } from '../content/species-reference';
import { resourceText } from '../render/resources';
import { translate, type Language } from '../i18n';
import type { World } from '../core/world';
import type { Entity } from '../core/types';

const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const names: Partial<Record<GenomeBudgetKey, string>> = { offspring: 'Offspring capacity', 'birth-rate': 'Birth rate', 'random-sex': 'Random sex genes', mutagenic: 'Mutagenic', harmful: 'Harmful gene' };
export function speciesParametersInspector(world: World, speciesId: string, language: Language, individual?: Entity, open = false): string {
  const comparison = speciesComparison(world, speciesId, individual);
  if (!comparison) return '';
  const tr = (s: string): string => escape(translate(s, language));
  const number = (n: number | null | undefined): string => n == null ? '—' : String(Math.round(n * 1000) / 1000);
  const { local, reference, individual: actual } = comparison;
  let html = `<details data-species-parameters${open ? ' open' : ''}><summary>${tr('Parameter origins and comparison')}</summary>`;
  html += `<p>${tr('The game keeps its own balance. WorldBox values use the source’s units and are shown for comparison.')}</p>`;
  if (local && !local.genomeBudget) html += `<p>${tr('This species uses direct parameters and has no gene editor.')}</p>`;
  if (actual?.legacyGenes) html += `<p>${tr('Inherited bonuses from the saved world are preserved.')}</p>`;
  html += `<div class="species-comparison"><table><thead><tr><th>${tr('Parameter')}</th><th>Pocket Overlord</th><th>WorldBox</th></tr></thead><tbody>`;
  for (const key of [...GENOME_BUDGET_KEYS, 'attackSpeed', 'accuracy', 'targets', 'mass', 'scale'] as const) {
    const label = names[key as GenomeBudgetKey] ?? STAT_RULES[key as StatId]?.label ?? key;
    const base = local?.baseStats[key as StatId], budget = local?.genomeBudget?.[key as GenomeBudgetKey];
    const sourceBase = reference?.bases.map(b => b.stats[key === 'mass' ? 'baseMass' : key as StatId]).filter(n => n !== undefined && n !== null) ?? [];
    const source = [...new Set(sourceBase)].map(number).join(' / ') || number(reference?.common[key as keyof typeof reference.common]);
    const explanation = actual && key in STAT_RULES ? actual.stats.explanations[key as StatId] : undefined;
    const contributions = explanation?.contributions.map(c => `${tr(c.source)}: ${c.flat ? (c.flat > 0 ? '+' : '') + number(c.flat) : ''}${c.flat && c.percent ? ', ' : ''}${c.percent ? (c.percent > 0 ? '+' : '') + number(c.percent) + '%' : ''}`).join('<br>');
    html += `<tr><th>${tr(label)}</th><td>${tr('Base')}: ${number(base)}<br>${tr('Gene budget')}: ${number(budget)}${contributions ? `<br>${contributions}` : ''}${explanation ? `<br>${tr('Individual result')}: ${number(explanation.value)}` : ''}</td><td>${tr('Base')}: ${source}<br>${tr('Gene budget')}: ${number(reference?.effectiveBudget?.[key as GenomeBudgetKey])}</td></tr>`;
  }
  html += `</tbody></table></div><p>${tr('A dash means no contribution, not zero. Gene budgets are placed into chromosomes and are not added again to the result.')}</p>`;
  if (reference?.inheritance) html += `<p>${tr('The reference budget includes the inherited tumor-creature foundation once.')}</p>`;
  if (world.registry.species.get(speciesId)?.form === 'ascended') html += `<p>${tr('The reference budget includes three inherited points in each civil skill.')}</p>`;
  if (reference?.notes.includes('mass-conflict')) html += `<p>${tr('The source lists mass as both 0 and 300. Neither value is selected automatically.')}</p>`;
  if (reference?.notes.includes('inherits-body')) html += `<p>${tr('An absent genome does not erase parameters inherited from the original body.')}</p>`;
  if (local?.roads) html += `<p>${tr('This people builds roads and bridges, including routes to ports. Construction uses labour; walking routes are not chosen by speed.')}</p>`;
  const drops = local?.drops;
  if (drops) html += `<p>${tr('Body mass')}: ${number(drops.baseMass)} ${tr('stats:unit:kg')} · ${tr('Base drops')}: ${escape(resourceText(drops.base, language))}</p><p>${tr('Drops use mass and size. Child mass is 40%; the multiplier rounds down; each resource is capped at 30. Overflow stays on the ground.')}</p>`;
  html += `<button type="button" data-export-species>${tr('Export profile comparison')}</button><p data-species-export-status role="status"></p></details>`;
  return html;
}
export function exportSpeciesComparison(world: World, speciesId: string, individual?: Entity): void {
  const comparison = speciesComparison(world, speciesId, individual);
  if (!comparison) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(comparison, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `species-${speciesId}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
