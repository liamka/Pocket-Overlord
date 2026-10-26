import type { Entity } from '../core/types';
import type { World } from '../core/world';
import { canFeel, happinessPercent } from '../core/happiness';
import { HAPPINESS_EVENTS } from '../content/happiness';
import { translate, type Language } from '../i18n';

const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function happinessInspector(world: World, entity: Entity, language: Language, open: boolean): string {
  const tr = (key: string, values?: Record<string, string | number>): string => escape(translate(key, language, values));
  const h = entity.components.happiness;
  if (!h || !canFeel(world.registry, entity)) return `<p><strong>${tr('Happiness')}:</strong> ${tr(h?.egg ? 'Emotions are inactive inside an egg' : 'No emotional capacity')}</p>`;
  const percent = happinessPercent(h.value);
  const category = percent >= 90 ? 'Ecstatic' : percent >= 70 ? 'Joyful' : percent >= 60 ? 'Content' : percent >= 40 ? 'Even spirits'
    : percent >= 10 ? 'Saddened' : percent > 0 ? 'Despondent' : 'At the lowest point';
  let html = `<section data-happiness><p><strong>${tr('Happiness')}:</strong> <span>${percent}%</span> · ${tr(category)}</p>
    <meter min="0" max="100" value="${percent}" aria-label="${tr('Happiness')}" title="${h.value} / −100…100">${percent}%</meter>`;
  if (entity.components.citizen) html += `<p>${tr(percent > 60 ? 'More likely to laugh during free time' : percent < 30
    ? 'May cry during free time and rests at home longer' : percent <= 50 ? 'Prefers longer rest at home' : 'Food, safety and work take priority')}</p>`;
  html += `<details data-happiness-history${open ? ' open' : ''}><summary>${tr('Recent happiness events')}</summary>`;
  html += h.history.length ? '<ul>' + h.history.slice(-8).reverse().map(m => `<li>${tr(HAPPINESS_EVENTS[m.type].label)} · ${m.change > 0 ? '+' : ''}${m.change}
    · ${m.source.localize ? tr(m.source.name) : escape(m.source.name)} · ${tr('{seconds}s ago', { seconds: Math.floor((world.tick - m.tick) / 30) })}</li>`).join('') + '</ul>'
    : `<p>${tr('No happiness events yet')}</p>`;
  return html + '</details></section>';
}
