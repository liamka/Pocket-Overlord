import { reproductionSex } from '../core/reproduction-state';
import type { World } from '../core/world';
import type { Entity } from '../core/types';
import { reproductionBlock, reproductionProfile } from '../core/reproduction';
import { pendingStatus } from '../core/reproduction';
import { translate, type Language } from '../i18n';
import { unitLink } from '../core/units';

const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function reproductionInspector(world: World, e: Entity, language: Language, open: boolean): string {
  const r = e.components.reproduction, profile = reproductionProfile(e);
  if (!r || !profile) return '';
  const tr = (s: string, values?: Record<string, string | number>): string => escape(translate(s, language, values));
  const p = r.pending, waiting = p?.dueAt ?? r.egg?.hatchAt;
  let html = `<details data-reproduction${open ? ' open' : ''}><summary>${tr('Reproduction')}</summary>`;
  html += `<p>${tr('Reproductive sex')}: ${tr(reproductionSex(e) === 'a' ? 'Female' : 'Male')}</p>`;
  html += `<p>${tr('Methods')}: ${profile.methods.map(m => tr(`reproduction:${m}`)).join(', ') || tr('None')}</p>`;
  html += `<p>${tr('Maturation form')}: ${tr(`reproduction:${profile.form}`)}</p>`;
  html += `<p>${tr('Offspring produced: {count}', { count: r.born })}</p>`;
  if (waiting !== undefined) {
    const stage = r.egg ? 'Egg' : p?.method === 'spore' ? 'Spores in flight' : p && pendingStatus(p) === 'budding' ? 'Budding'
      : p && pendingStatus(p) === 'taking-roots' ? 'Taking roots' : 'Pregnant';
    html += `<p>${tr('Current stage')}: ${tr(stage)} · ${tr('Matures in {seconds}s', { seconds: Math.max(0, Math.ceil((waiting - world.tick) / 30)) })}</p>`;
    if (p) html += `<p>${tr('Expected offspring: {count}', { count: p.children.length })}</p>`;
    for (const id of p?.parents ?? r.egg?.parents ?? []) {
      const parent = unitLink(world, id);
      if (parent) html += `<p>${tr('Parent')}: <button type="button" data-unit="${id}">${escape(parent.name)}</button></p>`;
    }
  }
  if (r.cloneOf !== undefined) {
    const original = unitLink(world, r.cloneOf);
    if (original) html += `<p>${tr('Clone of')}: <button type="button" data-unit="${original.id}">${escape(original.name)}</button></p>`;
  }
  if (r.divineUsed) html += `<p>${tr('Divine birth already used')}</p>`;
  const method = profile.methods[0], reason = p ? r.last?.reason ?? 'Waiting for maturation'
    : method ? reproductionBlock(world, e, method) ?? r.last?.reason ?? 'Ready to reproduce' : 'No reproduction method';
  return html + `<p>${tr('Reason')}: ${tr(reason)}</p></details>`;
}
