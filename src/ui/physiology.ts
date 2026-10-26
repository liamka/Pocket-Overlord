import { PHYSIOLOGY, PHYSIOLOGY_IDS, changePhysiology, isPhysiologyId, type PhysiologyId } from '../content/subspecies-traits';
import { physiologyProblem } from '../core/physiology';
import { subspeciesOf } from '../core/subspecies-state';
import { updateSubspecies } from '../core/subspecies';
import { canUseWorldEditors } from '../core/world-rules';
import type { World } from '../core/world';
import { translate, type Language } from '../i18n';

const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export class PhysiologyEditor {
  private readonly dialog = document.createElement('dialog');
  private world?: World;
  private entityId = 0;
  private revision = 0;
  private draft: PhysiologyId[] = [];
  private language: Language = 'en';
  private selected: PhysiologyId = 'stomach';
  private notice = '';
  constructor(root: HTMLElement) {
    this.dialog.className = 'gene-editor'; this.dialog.setAttribute('aria-label', 'Subspecies physiology'); root.append(this.dialog);
    this.dialog.addEventListener('change', event => {
      const input = event.target as HTMLSelectElement;
      if (input.matches('[data-physiology-choice]') && isPhysiologyId(input.value)) { this.selected = input.value; this.render(); }
    });
    this.dialog.addEventListener('click', event => {
      const b = (event.target as HTMLElement).closest<HTMLButtonElement>('button'), w = this.world, e = w?.entities.get(this.entityId);
      if (!b || !w || !e) return;
      const action = b.dataset.physiology;
      if (action === 'close') { this.dialog.close(); return; }
      if (action === 'toggle') this.draft = changePhysiology(this.draft, this.selected, !this.draft.includes(this.selected));
      if (action === 'apply') {
        const s = subspeciesOf(e);
        if (!canUseWorldEditors(w)) this.notice = 'Enable forbidden knowledge to edit physiology';
        else if (!s || s.revision !== this.revision) this.notice = 'The subspecies changed; reopen the editor';
        else if (w.paused) this.notice = 'Resume time before applying physiology';
        else if (updateSubspecies(w, s.id, { traits: this.draft })) {
          this.draft = [...s.traits]; this.revision = s.revision; this.notice = 'Physiology applied to the whole subspecies';
        } else this.notice = 'Physiology could not be applied; no changes were made';
      }
      this.render();
    });
  }
  open(world: World, entityId: number, language: Language): void {
    const e = world.entities.get(entityId), s = subspeciesOf(e);
    if (!e || !s || !canUseWorldEditors(world)) return;
    this.world = world; this.entityId = entityId; this.language = language; this.revision = s.revision; this.draft = [...s.traits]; this.notice = '';
    this.render(); if (!this.dialog.open) this.dialog.showModal();
  }
  update(world: World, language: Language): void {
    if (world !== this.world || !world.entities.has(this.entityId)) this.dialog.close();
    if (language !== this.language) { this.language = language; if (this.dialog.open) this.render(); }
  }
  private render(): void {
    const w = this.world, e = w?.entities.get(this.entityId), s = subspeciesOf(e);
    if (!w || !e || !s) return;
    const tr = (text: string): string => escape(translate(text, this.language)), selected = PHYSIOLOGY[this.selected], active = this.draft.includes(this.selected);
    const problem = !active && physiologyProblem(w, e, this.selected);
    const changed = PHYSIOLOGY_IDS.filter(id => s.traits.includes(id) !== this.draft.includes(id));
    this.dialog.setAttribute('aria-label', translate('Subspecies physiology', this.language));
    this.dialog.innerHTML = `<h2>${tr('Subspecies physiology')}</h2><p>${tr('Changes affect every living member and future offspring.')}</p>
      <label>${tr('Shared abilities')}<select data-physiology-choice>${PHYSIOLOGY_IDS.filter(id => !['genealogy', 'tools', 'governance', 'gmo', 'uplifted'].includes(id)).map(id => `<option value="${id}"${id === this.selected ? ' selected' : ''}>${this.draft.includes(id) ? '+ ' : ''}${tr(PHYSIOLOGY[id].label)}</option>`).join('')}</select></label>
      <p>${tr('Requires')}: ${selected.requires.map(id => tr(PHYSIOLOGY[id].label)).join(', ') || tr('None')}</p>
      <p>${tr('Incompatible with')}: ${selected.opposites.map(id => tr(PHYSIOLOGY[id].label)).join(', ') || tr('None')}</p>
      ${problem ? `<p role="status">${tr(problem)}</p>` : ''}<button type="button" data-physiology="toggle"${problem ? ' disabled' : ''}>${tr(active ? 'Remove ability' : 'Add ability')}</button>
      <p>${tr('Shared abilities')}: ${this.draft.map(id => tr(PHYSIOLOGY[id].label)).join(', ') || tr('None')}</p>
      <p>${tr('Pending changes')}: ${changed.map(id => `${this.draft.includes(id) ? '+' : '−'} ${tr(PHYSIOLOGY[id].label)}`).join(', ') || tr('None')}</p>
      <p role="status">${tr(this.notice)}</p><button type="button" data-physiology="apply"${!changed.length ? ' disabled' : ''}>${tr('Apply physiology')}</button>
      <button type="button" data-physiology="close">${tr('Close')}</button>`;
  }
}
