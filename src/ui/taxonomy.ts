import { COLLECTIVE_PROFILES, taxonomyPath } from '../content/taxonomy';
import { translate, type Language } from '../i18n';

const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function taxonomyInspector(speciesId: string, language: Language, open = false): string {
  const tr = (s: string, values?: Record<string, string | number>): string => escape(translate(s, language, values));
  const path = taxonomyPath(speciesId), profile = COLLECTIVE_PROFILES[speciesId];
  const tree = path.reduceRight((children, taxon) => `<ul><li data-taxon="${escape(taxon.id)}"><strong>${tr(`Taxonomic ${taxon.rank}`)}:</strong> ${tr(taxon.label)}${children}</li></ul>`, '');
  const policy = profile ? `<p><strong>${tr('Collective policy')}:</strong> ${tr(profile.reference.mode === 'none' ? 'This species does not form families or herds.'
    : profile.reference.herd ? 'Herd limit: {limit} · Led by its oldest member' : 'Family limit: {limit}', { limit: profile.limit })}</p>` : '';
  return `<details data-taxonomy${open ? ' open' : ''}><summary>${tr('Classification tree')}</summary><div class="taxonomy-tree">${tree || `<p>${tr('No taxonomy recorded')}</p>`}</div>${policy}</details>`;
}
