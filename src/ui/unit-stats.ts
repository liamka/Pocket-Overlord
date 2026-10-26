import type { Entity } from '../core/types';
import type { World } from '../core/world';
import { LEVEL_LIMIT, STAT_RULES, CIVIL_STATS, adultAge, biologicalAge, breedingAge, nutritionRemaining, unitStats, type StatId } from '../core/unit-stats';
import { xpRequired } from '../core/unit-levels';
import { translate, type Language } from '../i18n';

const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const number = (n: number): string => String(Math.round(n * 100) / 100);
// Keep the inspector and saved parameters available without rendering the panel.
export const SHOW_UNIT_STATS = false;
export function statsInspector(world: World, entity: Entity, language: Language, open: boolean): string {
  const s = entity.components.stats;
  if (!s) return '';
  const stats = unitStats(world, entity), v = stats.values, c = entity.components;
  const tr = (text: string, values?: Record<string, string | number>): string => escape(translate(text, language, values));
  let html = `<details data-unit-stats${open ? ' open' : ''}><summary>${tr('Unit parameters')}</summary>`;
  const bar = (label: string, current: number, max: number): void => {
    html += `<label class="unit-stat-bar">${tr(label)}: ${number(current)} / ${number(max)}<progress aria-label="${tr(label)}" value="${current}" max="${max}"></progress></label>`;
  };
  html += `<p data-unit-level>${tr('Level')}: ${s.level} / ${LEVEL_LIMIT}</p><div data-unit-experience>`;
  if (s.level === LEVEL_LIMIT) html += `<p>${tr('Level limit reached. Further experience is discarded.')}</p>`;
  else bar('Experience', s.xpIntoLevel, xpRequired(s.level));
  const experience = s.experience, last = experience.last;
  if (last) {
    const source = { hit: 'Hit on {name}', kill: 'Defeated {name}', rule: 'A year leading {name}', food: 'Experience from food' }[last.source];
    html += `<p>${tr('Last experience')}: +${last.gained} · ${tr(source, { name: last.subject })}</p>`;
    if (last.levels) html += `<p>${tr('Levels gained: {count}', { count: last.levels })}</p>`;
  }
  if (experience.culture) {
    html += `<p>${tr('Learning rate')}: ×${experience.culture.fastLearners ? 2 : 1} · ${escape(experience.culture.name)}</p>`;
    if (experience.culture.trainingPotential) html += `<p>${tr('Each earned level grants one extra level.')}</p>`;
  }
  html += '</div>';
  if (c.person || c.animal) {
    bar('Stamina', s.stamina, v.stamina);
    bar('Nutrition', nutritionRemaining(entity), v.nutrition);
    if (stats.magic) bar('Mana', s.mana, v.mana);
    if (s.stamina < 5) html += `<p>${tr('Rest or eat to recover stamina.')}</p>`;
    if (stats.magic && s.mana < 3) html += `<p>${tr('Not enough mana to cast. Rest or eat to recover.')}</p>`;
    html += `<p>${tr('Adult age')}: ${number(adultAge(entity))} · ${tr('Breeding age')}: ${number(breedingAge(entity))}</p>`;
    if (s.ageOvergrowth) html += `<p>${tr('Biological age')}: ${number(biologicalAge(entity))} · ${tr('Additional aging')}: ${number(s.ageOvergrowth)}</p>`;
    if (s.lastLearning) html += `<p>${tr('Learned {skill} from {name}', { skill: translate(STAT_RULES[s.lastLearning.skill].label, language), name: s.lastLearning.teacher })}</p>`;
  }
  const keys: StatId[] = ['health', 'hitSize', 'scale', 'mass'];
  if (c.person || c.animal) keys.push('damage', 'armor', 'critical', 'criticalMultiplier', 'speed', 'attackSpeed', 'range', 'stamina', 'nutrition', 'lifespan', 'recovery', 'metabolicRate');
  if (c.person) keys.push(...CIVIL_STATS, 'construction');
  if (stats.attack.projectile) keys.push('accuracy', 'projectiles');
  if (stats.magic) keys.push('mana');
  if (v.targets > 1) keys.push('targets');
  html += '<dl class="unit-stat-values">';
  for (const key of keys) {
    const x = stats.explanations[key], r = STAT_RULES[key];
    const value = key === 'damage' ? `${stats.minimumDamage}–${number(v.damage)}` : number(x.value);
    const unit = ['%', '×', '/s', 'tiles/s', 'tiles', 'kg', 'years', 'points/s'].includes(r.unit) ? ` ${tr(`stats:unit:${r.unit}`)}` : '';
    const terms = x.contributions.map(m => `${tr(m.source)} ${m.flat ? (m.flat > 0 ? '+' : '') + number(m.flat) : ''}${m.flat && m.percent ? ', ' : ''}${m.percent ? (m.percent > 0 ? '+' : '') + number(m.percent) + '%' : ''}`);
    html += `<dt>${tr(r.label)}</dt><dd>${value}${unit}<small>${tr('Base')}: ${number(x.base)}${terms.length ? ` · ${terms.join(' · ')}` : ''}</small></dd>`;
  }
  return html + `</dl><p>${tr('Bonuses add to the base before percentages. Limits apply last.')}</p></details>`;
}
