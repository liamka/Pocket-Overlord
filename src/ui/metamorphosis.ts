import { TRAIT_DEFINITIONS } from '../content/traits';
import type { Entity } from '../core/types';
import type { World } from '../core/world';
import { lifespanOf, marked, type FormMark } from '../core/metamorphosis';
import { speciesOf } from '../core/creatures';
import { entityLabel } from '../core/units';
import { translate, type Language } from '../i18n';

const escape = (value: string): string => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const marks: Record<FormMark, string> = { rebirth: 'Rebirth in own species', 'wolf-rebirth': 'Wolf rebirth', infected: 'Zombie infection', mush: 'Mush spores',
  tumor: 'Tumor', cursed: 'Curse', blessed: 'Blessed', pure: 'Pure', rage: 'Rage', soul: 'Soul' };
export function metamorphosisInspector(world: World, entity: Entity, language: Language, open: boolean): string {
  const state = entity.components.metamorphosis, lifespan = lifespanOf(entity);
  if (!state && lifespan === undefined) return '';
  const tr = (key: string, values?: Record<string, string | number>): string => escape(translate(key, language, values));
  let html = `<details data-metamorphosis${open ? ' open' : ''}><summary>${tr('Changes of form')}</summary>`;
  if (lifespan !== undefined) {
    html += `<p>${tr('Selected rebirth occurs once, on death at or after {age} years.', { age: Math.round(lifespan * 0.7 * 10) / 10 })}</p>`;
    for (const [choice, label] of [['none', 'No rebirth'], ['self', 'Rebirth in own species'], ['wolf', 'Wolf rebirth']] as const) {
      const rule = world.registry.transformations.get(choice === 'wolf' ? 'core:wolf-rebirth' : 'core:rebirth');
      if (choice !== 'none' && !rule?.sources.includes(entity.typeId)) continue;
      const selected = choice === 'none' ? !marked(entity, 'rebirth') && !marked(entity, 'wolf-rebirth') : marked(entity, choice === 'self' ? 'rebirth' : 'wolf-rebirth');
      html += `<button type="button" data-rebirth="${choice}" aria-pressed="${selected}">${tr(label)}</button>`;
    }
  }
  if (state?.marks.length) html += `<p>${tr('Carried signs')}: ${state.marks.map(m => tr(marks[m])).join(', ')}</p>`;
  for (const h of [...(state?.history ?? [])].reverse()) {
    const rule = world.registry.transformations.get(h.rule);
    const label = entityLabel(world, { id: h.fromId, typeId: h.fromType, components: {} });
    html += `<p><strong>${tr('Previous form')}:</strong> ${tr(label)}`;
    if (h.fromId !== entity.id) html += ` · <button type="button" data-unit="${h.fromId}">${tr('View former life')}</button>`;
    html += `</p><p>${tr('Reason')}: ${tr(rule?.label ?? 'Changes of form')}</p>`;
    html += `<p>${tr(rule?.identity === 'new' ? 'A separate soul; possessions stay with the former body.' : 'Name, ancestry and personal bonds are retained.')}</p>`;
    if (h.removed.length) html += `<p>${tr('Removed signs')}: ${h.removed.map(m => { const trait = TRAIT_DEFINITIONS.find(t => t.label === m); return tr(trait ? `trait:${trait.id}` : marks[m as FormMark] ?? m); }).join(', ')}</p>`;
    if (rule?.items === 'compatible-or-ground') html += `<p>${tr('Usable equipment follows the new body; other items remain on the ground.')}</p>`;
  }
  const runtime = speciesOf(world.registry, entity)?.runtime;
  if (runtime && state?.history.length) {
    html += `<p>${tr('Movement after change')}: ${runtime.movement.map(m => tr(`creature:${m}`)).join(', ')}</p>`;
    html += `<p>${tr('Feeding after change')}: ${runtime.food.map(f => tr(`creature:${f}`)).join(', ') || tr('None')}</p>`;
  }
  return html + '</details>';
}
