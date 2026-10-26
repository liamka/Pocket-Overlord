import { ARCHITECT_MOODS, WORLD_LAWS, worldLawDefinitions } from '../content/world-laws';
import { lawEnabled, setArchitect, setForbiddenKnowledge, setWorldLaw } from '../core/world-rules';
import type { World } from '../core/world';
import { translate, type Language } from '../i18n';

const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export class WorldLawsPanel {
  private readonly dialog = document.createElement('dialog');
  private readonly button = document.createElement('button');
  private world?: World;
  private language: Language = 'en';
  private revision = -1;
  get isOpen(): boolean { return this.dialog.open; }
  constructor(root: HTMLElement, settings: HTMLDialogElement, debugMode = false) {
    if (!debugMode) return;
    this.button.type = 'button'; this.button.id = 'world-laws-open'; this.button.className = 'secondary';
    this.button.setAttribute('aria-haspopup', 'dialog');
    settings.querySelector('.dialog-actions')!.before(this.button);
    this.dialog.className = 'world-laws-dialog'; this.dialog.setAttribute('aria-labelledby', 'world-laws-title'); root.append(this.dialog);
    this.button.addEventListener('click', () => { if (this.world) { settings.close(); this.render(); this.dialog.showModal(); } });
    this.dialog.addEventListener('click', e => { if ((e.target as HTMLElement).closest('[data-laws-close]')) this.dialog.close(); });
    this.dialog.addEventListener('close', () => { this.button.setAttribute('aria-expanded', 'false'); root.querySelector<HTMLButtonElement>('#settings')?.focus(); });
    this.dialog.addEventListener('change', event => {
      const input = event.target;
      if (!this.world || !(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)) return;
      let notice = 'World settings saved in this world only.';
      if (input instanceof HTMLInputElement && input.dataset.law) {
        const result = setWorldLaw(this.world, input.dataset.law, input.checked);
        notice = result.ok ? input.checked ? 'Enabled in this world.' : 'Disabled in this world.' : result.reason;
      } else if (input instanceof HTMLInputElement && input.id === 'forbidden-knowledge') {
        setForbiddenKnowledge(this.world, input.checked);
        notice = input.checked ? 'Enabled in this world.' : 'Disabled in this world.';
      } else if (input.id === 'architect-name' || input.id === 'architect-mood') {
        notice = 'Architect updated.';
        if (!setArchitect(this.world, this.dialog.querySelector<HTMLInputElement>('#architect-name')!.value,
          this.dialog.querySelector<HTMLSelectElement>('#architect-mood')!.value)) notice = 'Name must be at most 60 characters without control characters.';
      } else return;
      const id = input.id; this.render(); this.dialog.querySelector<HTMLElement>(`#${id}`)?.focus();
      this.dialog.querySelector('[role="status"]')!.textContent = this.tr(notice);
    });
  }
  private tr(key: string): string { return translate(key, this.language); }
  update(world: World, language: Language): void {
    const replaced = this.world !== world, dirty = replaced || this.language !== language || this.revision !== world.worldRules.revision;
    if (replaced && this.dialog.open) this.dialog.close();
    this.world = world; this.language = language;
    const label = this.tr('World laws');
    if (this.button.textContent !== label) this.button.textContent = label;
    if (dirty && this.dialog.open) this.render();
  }
  private render(): void {
    const world = this.world!; this.revision = world.worldRules.revision;
    const tr = (key: string): string => escape(this.tr(key)), rules = world.worldRules;
    const expanded = new Set([...this.dialog.querySelectorAll<HTMLDetailsElement>('details[open]')].map(d => d.dataset.group));
    const first = !this.dialog.childElementCount;
    this.dialog.style.setProperty('--architect-color', ARCHITECT_MOODS[rules.architect.mood][1]);
    this.dialog.innerHTML = `<header><h2 id="world-laws-title">${tr('World laws')}</h2><button type="button" data-laws-close>${tr('Close')}</button></header>
      <p>${tr('World settings saved in this world only.')}</p><p role="status" aria-live="polite"></p>
      <div class="architect-settings"><label>${tr('Architect name')}<input id="architect-name" maxlength="60" value="${escape(rules.architect.name)}"></label>
      <label>${tr('Architect mood')}<select id="architect-mood">${Object.entries(ARCHITECT_MOODS).map(([id, [name]]) => `<option value="${id}"${rules.architect.mood === id ? ' selected' : ''}>${tr(name)}</option>`).join('')}</select></label></div>
      <p class="architect-preview">${escape(rules.architect.name) || tr('Architect name')} · ${tr(ARCHITECT_MOODS[rules.architect.mood][0])}</p><p>${tr('Mood changes only the highlight color.')}</p>
      <section class="experimental-rules"><label><input id="forbidden-knowledge" type="checkbox"${rules.forbiddenKnowledge ? ' checked' : ''}>${tr('Experimental mode (Forbidden Knowledge)')}</label>
      <p>${tr('Unlocks gene, appearance and trait editors in this world. Basic tools stay available.')}</p>
      <p>${tr('Achievements and discoveries are not available yet; experimental worlds cannot earn them.')}</p></section>
      ${[...new Set(WORLD_LAWS.map(d => d.group))].map((group, index) => `<details data-group="${index}"${expanded.has(String(index)) || first && WORLD_LAWS.some(d => d.group === group && !d.unavailable) ? ' open' : ''}><summary>${tr(group)}</summary>
        ${WORLD_LAWS.filter(d => d.group === group).map(d => {
          const missing = d.dependencies.filter(id => !lawEnabled(world, id));
          return `<div class="world-law${d.unavailable ? ' unavailable' : ''}"><label><input id="law-${d.id}" type="checkbox" data-law="${d.id}" aria-describedby="law-help-${d.id}"${rules.values[d.id] ? ' checked' : ''}${d.unavailable ? ' disabled' : ''}>${tr(d.label)}</label>
            <p id="law-help-${d.id}">${d.unavailable ? tr('Unavailable') + ': ' : ''}${tr(d.action)}</p>
            ${!d.unavailable && rules.values[d.id] && missing.length ? `<p>${escape(translate('Waiting for: {laws}.', this.language, { laws: missing.map(id => this.tr(worldLawDefinitions.get(id)!.label)).join(', ') }))}</p>` : ''}</div>`;
        }).join('')}</details>`).join('')}`;
    this.button.setAttribute('aria-expanded', 'true');
  }
}
