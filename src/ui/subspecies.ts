import { PHYSIOLOGY } from '../content/subspecies-traits';
import { physiologyDiet, subspeciesRoom } from '../core/physiology';
import { resourceName } from '../render/resources';
import { calendarDate } from './calendar';
import { GENE_KEYS, subspeciesOf } from '../core/subspecies-state';
import { STAT_RULES } from '../core/unit-stats';
import { unitLink, unitName } from '../core/units';
import type { World } from '../core/world';
import type { Entity } from '../core/types';
import { translate, type Language } from '../i18n';
import { CAPABILITY_LABELS } from './capabilities';
import { phenotypeInspector } from './phenotypes';

const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function subspeciesInspector(world: World, entity: Entity, language: Language, open: boolean): string {
  const s = subspeciesOf(entity);
  if (!s) return '';
  const tr = (text: string, values?: Record<string, string | number>): string => escape(translate(text, language, values));
  const origin = { natural: 'Naturally appeared', placed: 'Placed by you', cloned: 'Founded by cloning', born: 'Founded at birth', transformed: 'Founded after transformation', legacy: 'Present in the older world' }[s.origin.kind];
  const founder = world.entities.get(s.origin.founderId), memory = unitLink(world, s.origin.founderId);
  const founderName = founder ? unitName(founder) : memory?.name;
  let html = `<details data-subspecies${open ? ' open' : ''}><summary>${tr('Subspecies {id}', { id: s.id })}</summary>`;
  html += `<p>${tr('Living members: {count}', { count: s.created - s.died - s.departed })}</p>`;
  html += phenotypeInspector(entity, language);
  if (s.genetics && world.registry.species.get(s.speciesId)?.runtime?.genomeEditor) html += `<p>${tr('Chromosomes')}: ${s.genetics.chromosomes.length}${s.genetics.gmo ? ' · GMO' : ''}</p><button type="button" data-edit-genome>${tr('Edit shared genome')}</button>`;
  if (s.genetics?.lineage) html += `<p>${tr('Inherited branch {id}; {count} gene changes at birth', { id: s.genetics.lineage.parentId, count: s.genetics.lineage.geneChanges })}</p>`;
  html += `<p>${tr('Born here: {born}; deaths: {deaths}; departed: {departed}', { born: s.born, deaths: s.died, departed: s.departed })}</p>`;
  html += `<p>${tr(origin)} · ${escape(calendarDate(s.origin.at, language))}</p>`;
  if (founderName) html += `<p>${tr('Founder')}: <button type="button" data-unit="${s.origin.founderId}">${escape(founderName)}</button></p>`;
  const traits = s.traits.map(t => tr(PHYSIOLOGY[t]?.label ?? CAPABILITY_LABELS[t as keyof typeof CAPABILITY_LABELS] ?? t));
  html += `<p>${tr('Shared abilities')}: ${traits.join(', ') || tr('None')}</p>`;
  html += `<p>${tr('Diet')}: ${physiologyDiet(entity).map(id => escape(resourceName(id, language))).join(', ') || tr('None')}</p>`;
  const room = subspeciesRoom(world, entity);
  html += `<p>${tr('Subspecies birth capacity')}: ${Number.isFinite(room) ? room : tr('No subspecies limit')}</p>`;
  if (entity.components.physiology?.result) html += `<p>${tr(entity.components.physiology.result.text)}</p>`;
  html += `<button type="button" data-edit-physiology>${tr('Edit physiology')}</button>`;
  html += `<p>${tr('Guaranteed birth traits')}: ${s.birthTraits.map(id => tr(`trait:${id}`)).join(', ') || tr('None')}</p>`;
  if (!s.traits.includes('sapience') && entity.components.person) html += `<p>${tr('Without sapience: settlement duties are suspended; carried goods stay with the creature.')}</p>`;
  html += `<p>${tr('Shared genes add to the species baseline. Individual changes affect only this creature.')}</p><dl class="unit-stat-values">`;
  for (const key of GENE_KEYS) {
    const gene = s.genome[key], personal = entity.components.subspecies!.deviations[key] ?? 0;
    html += `<dt>${tr(STAT_RULES[key].label)}</dt><dd>${gene >= 0 ? '+' : ''}${gene}${personal ? ` · ${tr('Individual')}: ${personal > 0 ? '+' : ''}${personal}` : ''}</dd>`;
  }
  if (s.revision) html += `</dl><p>${tr('Shared profile changed: {date}', { date: calendarDate(s.changedAt, language) })}</p>`;
  else html += '</dl>';
  return html + '</details>';
}
