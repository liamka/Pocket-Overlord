import { calendarDate } from './calendar';
import { herdContact, parentsOf, type Family } from '../core/families';
import { liftedIds } from '../core/cataclysms';
import type { World } from '../core/world';
import { unitLink, type UnitLink } from '../core/units';
import { translate, type Language } from '../i18n';

const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function familyDetails(world: World, id: number, chosen: number | null, language: Language, link: (value: UnitLink) => string): string {
  const entity = world.entities.get(id), memory = world.unitHistory.find(m => m.id === id), k = entity?.components.kinship ?? memory?.kinship;
  if (!k) return '';
  const tr = (s: string, values?: Record<string, string | number>): string => escape(translate(s, language, values));
  const title = (f: Family): string => {
    const names = f.founders.length ? f.founders : f.members.slice(0, 2);
    const people = names.map(id => unitLink(world, id)?.name).filter(Boolean).join(', ');
    return tr(f.type === 'normal' ? 'Family of {names}' : 'Herd of {names}', { names: people });
  };
  const button = (familyId: number | null): string => {
    const f = world.families.records.find(f => f.id === familyId);
    return f ? `<button type="button" data-family="${f.id}">${title(f)}</button>` : tr('Unknown');
  };
  let html = `<section aria-label="${tr('Family and herd')}"><h3>${tr('Family and herd')}</h3>`;
  html += `<p>${tr('Current family')}: ${k.familyId !== null && !memory ? button(k.familyId) : tr('No current family')}</p>`;
  if (k.originFamilyId !== null) html += `<p>${tr('Family of birth')}: ${button(k.originFamilyId)}</p>`;
  const selected = chosen ?? k.familyId ?? k.previousFamilyId ?? k.originFamilyId;
  const family = world.families.records.find(f => f.id === selected);
  if (family) {
    html += `<h4>${title(family)}</h4><p>${tr(family.dissolvedAt === null ? 'Active family' : 'Dissolved family')} · ${tr('Members: {count} / {limit}', { count: family.members.length, limit: family.limit })}</p>`;
    html += `<p>${tr('Species')}: ${tr(world.registry.species.get(family.speciesId)!.label)}</p>`;
    html += `<p>${tr('Founded')}: ${escape(calendarDate(family.foundedAt, language))} · <button type="button" data-x="${family.birthplace.x}" data-y="${family.birthplace.y}">${family.settlementName ? escape(family.settlementName) : tr('Wilderness')}</button></p>`;
    if (family.dissolvedAt !== null) html += `<p>${tr('Dissolved')}: ${escape(calendarDate(family.dissolvedAt, language))}</p>`;
    const show = (label: string, ids: number[]): string => `<p><strong>${tr(label)}:</strong> ${ids.map(id => unitLink(world, id)).filter((v): v is UnitLink => !!v).map(link).join(', ') || tr('None')}</p>`;
    html += show('Founders', family.founders);
    if (family.alphaId !== null) html += show('Oldest herd member', [family.alphaId]);
    html += show('Family members', family.members);
    if (family.type === 'alpha' && family.dissolvedAt === null) {
      const leader = world.entities.get(family.alphaId ?? -1), lifted = liftedIds(world);
      const near = family.members.filter(id => {
        const e = world.entities.get(id);
        return e?.components.position && leader?.components.position && !lifted.has(id) && !lifted.has(leader.id)
          && e.components.kinship?.herd?.reason !== 'No route to the herd' && herdContact(world, e.components.position, leader.components.position);
      }).length;
      html += `<p>${tr('Near the leader: {count} / {total}', { count: near, total: family.members.length })} · ${tr(near === family.members.length ? 'The herd has gathered' : 'Some members are still apart')}</p>`;
      html += `<ul>${family.members.map(id => {
        const e = world.entities.get(id)!, member = unitLink(world, id);
        return member ? `<li>${link(member)}: ${tr(e.components.kinship!.herd!.reason)}</li>` : '';
      }).join('')}</ul>`;
    }
    if (family.originFamilyIds.some(id => id !== null)) html += `<p>${tr('Origin families')}: ${[...new Set(family.originFamilyIds.filter(id => id !== null))].map(button).join(', ')}</p>`;
  }
  return html + '</section>';
}

export function genealogyDetails(world: World, id: number, language: Language, link: (value: UnitLink) => string, open: boolean): string {
  const tr = (s: string): string => escape(translate(s, language));
  const parents = (id: number): number[] => { const e = world.entities.get(id); return e ? parentsOf(e) : world.unitHistory.find(m => m.id === id)?.parents ?? []; };
  const ancestors = (id: number, depth: number, visited: Set<number>): string => {
    if (depth > 3 || visited.has(id)) return '';
    const next = new Set([...visited, id]);
    return parents(id).map(parent => {
      const p = unitLink(world, parent);
      return p ? `<li>${link(p)}${parents(parent).length && depth < 3 ? `<ul>${ancestors(parent, depth + 1, next)}</ul>` : ''}</li>` : '';
    }).join('');
  };
  const currentId = unitLink(world, id)?.id ?? id;
  const isParent = (parent: number): boolean => (unitLink(world, parent)?.id ?? parent) === currentId;
  const children = [...new Set([...world.query('kinship')].filter(e => parentsOf(e).some(isParent)).map(e => e.id)
    .concat(world.unitHistory.filter(m => m.parents.some(isParent)).map(m => m.id)).map(child => unitLink(world, child)?.id ?? child))];
  return `<details data-genealogy${open ? ' open' : ''}><summary>${tr('Open genealogy')}</summary><p>${tr('Parents and ancestors')}</p><ul>${ancestors(id, 0, new Set()) || `<li>${tr('Unknown')}</li>`}</ul><p>${tr('Children in the genealogy')}</p><ul>${children.map(child => `<li>${link(unitLink(world, child)!)}</li>`).join('') || `<li>${tr('None')}</li>`}</ul><p>${tr('Open a relative to explore earlier generations.')}</p></details>`;
}
