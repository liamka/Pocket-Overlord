import type { Entity } from '../core/types';
import type { World } from '../core/world';
import { statusDefinitions } from '../content/status-effects';
import { statusImmunities, statusTier, type StatusEndReason } from '../core/status-effects';
import { translate, type Language } from '../i18n';

const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const STATUS_REASON_LABELS: Record<StatusEndReason, string> = {
  expired: 'Status completed', cured: 'Status cured', death: 'Owner died', removed: 'Status interrupted', conflict: 'Removed by another status',
  water: 'Extinguished by water', damage: 'Interrupted by damage', replaced: 'Status replaced', 'target-lost': 'Target is no longer available', 'condition-ended': 'Cause no longer present',
};
const blocks: Record<string, string> = { spell: 'Cannot cast spells', conversation: 'Cannot have conversations', breed: 'Cannot reproduce',
  attack: 'Cannot attack', evolve: 'Cannot evolve', plot: 'Cannot start a plot', 'combat-action': 'Cannot use an advanced combat action' };
export function statusInspector(world: World, e: Entity, language: Language, open: boolean): string {
  const tr = (key: string, values?: Record<string, string | number>): string => escape(translate(key, language, values));
  const state = e.components.statuses;
  if (!state) return '';
  let html = `<details data-status-effects${open ? ' open' : ''}><summary>${tr('Temporary statuses')} (${state.active.length})</summary>`;
  html += `<p>${tr(statusTier(e) === 'none' ? 'This creature cannot receive statuses' : statusTier(e) === 'basic' ? 'This creature supports only basic statuses' : 'Supports basic and advanced statuses')}</p>`;
  const immunities = statusImmunities(e);
  html += `<p>${tr('Status immunities')}: ${immunities.length ? immunities.map(id => tr(statusDefinitions[id].label)).join(', ') : tr('None')}</p>`;
  if (!state.active.length) html += `<p>${tr('No active statuses')}</p>`;
  for (const s of state.active) {
    const d = statusDefinitions[s.id];
    const remaining = s.expiresAt === null ? tr('While the cause persists') : s.expiresAt <= world.tick && s.id === 'pregnant'
      ? tr('Waiting for a safe place and room for the child') : tr('{seconds}s remaining', { seconds: Math.max(0, Math.ceil((s.expiresAt - world.tick) / 30)) });
    html += `<p><strong>${tr(d.label)}</strong> · ${remaining}<br>${tr('Source')}: ${s.source.localize ? tr(s.source.name) : escape(s.source.name)}`;
    if (d.stops) html += `<br>${tr('Cannot move or make decisions')}`;
    for (const block of d.blocks ?? []) html += `<br>${tr(blocks[block])}`;
    if (s.nextTick !== null) html += `<br>${tr('Next effect in {seconds}s', { seconds: Math.max(0, Math.ceil((s.nextTick - world.tick) / 30)) })}`;
    html += '</p>';
  }
  if (state.rejected) html += `<p>${tr(statusDefinitions[state.rejected.id].label)}: ${tr(state.rejected.reason)}</p>`;
  for (const h of state.history.slice(-3).reverse()) html += `<p>${tr(statusDefinitions[h.id].label)} · ${tr(STATUS_REASON_LABELS[h.reason])}</p>`;
  return html + '</details>';
}
