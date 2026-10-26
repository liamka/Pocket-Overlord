import { NEURONS, NEURON_BY_ID } from '../content/neurons';
import { decisionBlock } from '../core/neurons';
import type { Entity } from '../core/types';
import type { World } from '../core/world';
import { translate, type Language } from '../i18n';

const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function neuronInspector(world: World, entity: Entity, language: Language, open: boolean): string {
  const c = entity.components.citizen;
  if (!c) return '';
  const tr = (key: string, values?: Record<string, string | number>): string => escape(translate(key, language, values));
  const n = c.neurons, block = decisionBlock(world, entity), last = n?.last;
  let html = `<details data-neurons${open ? ' open' : ''}><summary>${tr('Intentions')}</summary>`;
  if (block) html += `<p>${tr(block)}</p>`;
  if (last) html += `<p><strong>${tr('Last decision')}:</strong> ${last.id ? tr(NEURON_BY_ID.get(last.id)!.label) + ' · ' : ''}${tr(last.reason)}</p>`;
  html += `<p>${tr('Reasons at the last decision')}</p>`;
  for (const definition of NEURONS.filter(n => n.support === 'adapted')) {
    const disabled = n?.disabled.includes(definition.id) ?? false;
    const remaining = Math.max(n?.cooldowns[definition.id] ?? 0, n?.retries[definition.id] ?? 0) - world.tick;
    const reason = disabled ? 'Disabled by you' : block ?? (remaining > 0 ? 'Waiting before another attempt'
      : n?.observations?.[definition.id] ?? 'Looking again soon');
    html += `<p><button type="button" data-neuron="${definition.id}" aria-pressed="${!disabled}" aria-label="${tr(definition.label)}">${tr(disabled ? 'Enable intention' : 'Disable intention')}</button> <strong>${tr(definition.label)}</strong> · ${tr(reason)}${remaining > 0 ? ` · ${tr('{seconds}s', { seconds: Math.ceil(remaining / 30) })}` : ''}</p>`;
  }
  html += `<p>${tr('Other intentions need abilities this creature does not have.')}</p></details>`;
  return html;
}
