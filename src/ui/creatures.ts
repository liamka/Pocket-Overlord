import { calendarDate } from './calendar';
import type { World } from '../core/world';
import type { Entity } from '../core/types';
import { speciesOf, type SpeciesProfile } from '../core/creatures';
import { unitName } from '../core/units';
import { translate, type Language } from '../i18n';
import { CREATURE_FAMILIES } from '../content/creature-families';
import { capabilityLines, suspendedCapabilities } from './capabilities';
import { speciesReference } from '../content/species-reference';
import { exportSpeciesComparison, speciesParametersInspector } from './species-profiles';
import { taxonomyInspector } from './taxonomy';

const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Read-only catalogue: unavailable records never offer empty actions. */
export class CreatureInspector {
  readonly dialog = document.createElement('dialog');
  private world?: World;
  private language: Language = 'en';
  private speciesId = 'human';
  private individualId = 0;
  private lastTick = -1;
  private membership = '';
  constructor(root: HTMLElement, private button: HTMLButtonElement) {
    this.dialog.id = 'creature-dialog'; this.dialog.setAttribute('aria-labelledby', 'creature-title'); root.append(this.dialog);
    button.addEventListener('click', () => { if (this.world) { this.render(); this.dialog.showModal(); } });
    this.dialog.addEventListener('change', event => {
      const select = event.target as HTMLSelectElement;
      if (select.id === 'creature-species') { this.speciesId = select.value; this.individualId = 0; this.render(); }
      if (select.id === 'creature-individual') { this.individualId = Number(select.value); this.updateIndividual(); }
    });
    this.dialog.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (button?.dataset.close !== undefined) this.dialog.close();
      if (button?.dataset.pause !== undefined && this.world) { this.world.command({ kind: 'pause', paused: !this.world.paused }); this.updateIndividual(); }
      if (button?.hasAttribute('data-export-species') && this.world) {
        exportSpeciesComparison(this.world, this.speciesId, this.world.entities.get(this.individualId));
        this.dialog.querySelector('[data-species-export-status]')!.textContent = this.tr('Profile comparison exported');
      }
    });
  }
  update(world: World, language: Language): void {
    const changed = this.world !== world || this.language !== language;
    if (this.world !== world) this.individualId = 0;
    this.world = world; this.language = language;
    const label = this.tr('Creature catalogue');
    if (this.button.textContent !== label) this.button.textContent = label;
    if (!this.dialog.open) return;
    if (changed) this.render();
    if (changed || this.lastTick !== Math.floor(world.tick / 6)) {
      this.lastTick = Math.floor(world.tick / 6); this.updateMembers(); this.updateIndividual();
    }
  }
  private tr(source: string, values: Record<string, string | number> = {}): string { return translate(source, this.language, values); }
  private token(value: string): string { return this.tr(`creature:${value}`); }
  private render(): void {
    const world = this.world!, tr = (s: string): string => escape(this.tr(s));
    const profiles = [...world.registry.species.values()].filter(p => p.runtime || speciesReference(p.id));
    const p = world.registry.species.get(this.speciesId) ?? profiles[0];
    if (!p) return;
    this.speciesId = p.id;
    this.dialog.innerHTML = `<h2 id="creature-title">${tr('Creature catalogue')}</h2>
      <label for="creature-species">${tr('Species profile')}</label><select id="creature-species">${profiles.map(s => `<option value="${escape(s.id)}"${s.id === p.id ? ' selected' : ''}>${tr(s.runtime ? s.label : s.sourceName)}</option>`).join('')}</select>
      <section>${this.profile(p)}</section>
      ${taxonomyInspector(p.id, this.language, true)}
      <section id="species-parameters"></section>
      <label for="creature-individual">${tr('Individual')}</label><select id="creature-individual"></select>
      <section id="creature-state" aria-label="${tr('Individual')}"></section>
      <details><summary>${tr('Catalogue coverage')}</summary>${this.coverage()}</details>
      <details id="creature-families"><summary>${tr('Creature families')}</summary>${this.families()}</details>
      <div class="creature-actions"><button type="button" data-pause></button><button type="button" data-close>${tr('Готово')}</button></div>`;
    this.membership = ''; this.updateMembers(); this.updateIndividual();
  }
  private profile(p: SpeciesProfile): string {
    const r = p.runtime!, tr = (s: string, v?: Record<string, string | number>): string => escape(this.tr(s, v));
    if (!r) return `<p>${tr('Reference profile only. This species cannot be created yet.')}</p>`;
    return `<p>${tr('Partial support; other forms and powers are unavailable.')}</p>
      <p>${tr('Form: {form} · Movement: {movement}', { form: this.token(p.form), movement: r.movement.map(m => this.token(m)).join(', ') })}</p>
      <p>${tr('Food: {food} · Reproduction: {reproduction}', { food: r.food.map(m => this.token(m)).join(', ') || this.token('none'), reproduction: this.token(r.reproduction) })}</p>
      <p>${tr('Citizenship: {value}', { value: this.token(r.citizenship ? 'yes' : 'no') })}</p>
      <p>${tr('Abilities: {abilities}', { abilities: r.abilities.map(a => this.token(a)).join(', ') || this.token('none') })}</p>
      <p>${tr('Families: {families}', { families: r.families.map(id => this.tr(CREATURE_FAMILIES.find(f => f[0] === id)![1])).join(', ') })}</p>
      <div id="creature-capabilities">${capabilityLines(r, this.language).map(line => `<p>${escape(line)}</p>`).join('')}</div>`;
  }
  private updateMembers(): void {
    const members = [...this.world!.query('creature')].filter(e => e.components.creature!.speciesId === this.speciesId);
    if (!this.individualId) this.individualId = members[0]?.id ?? 0;
    const signature = `${this.speciesId}:${members.map(e => e.id).join(',')}:${this.individualId}`;
    if (signature === this.membership) return;
    this.membership = signature;
    const select = this.dialog.querySelector<HTMLSelectElement>('#creature-individual')!;
    const missing = this.individualId && !members.some(e => e.id === this.individualId);
    select.innerHTML = `${missing ? `<option value="${this.individualId}" selected>#${this.individualId} · ${escape(this.tr('Individual is no longer present'))}</option>` : ''}${members.map(e => `<option value="${e.id}"${e.id === this.individualId ? ' selected' : ''}>${escape(unitName(e))} · #${e.id}</option>`).join('')}`;
    select.disabled = !members.length;
  }
  private updateIndividual(): void {
    const e = this.world!.entities.get(this.individualId), panel = this.dialog.querySelector('#creature-state')!;
    const html = e ? this.individual(e) : `<p>${escape(this.tr(this.individualId ? 'Individual is no longer present' : 'No individuals of this species'))}</p>`;
    if (panel.innerHTML !== html) panel.innerHTML = html;
    const parameters = this.dialog.querySelector('#species-parameters')!;
    const wasOpen = !!parameters.querySelector<HTMLDetailsElement>('[data-species-parameters]')?.open;
    const comparison = speciesParametersInspector(this.world!, this.speciesId, this.language, e, wasOpen);
    if (parameters.innerHTML !== comparison) parameters.innerHTML = comparison;
    this.dialog.querySelector<HTMLButtonElement>('[data-pause]')!.textContent = this.token(this.world!.paused ? 'resume' : 'pause');
  }
  private individual(e: Entity): string {
    const world = this.world!, c = e.components, creature = c.creature!, tr = (s: string, v?: Record<string, string | number>): string => escape(this.tr(s, v));
    const citizen = c.citizen, animal = c.animal, dragon = c.dragon, ufo = c.ufo, kaiju = c.kaiju, ship = c.ship;
    const targetId = citizen?.emergency?.targetId ?? citizen?.targetId ?? animal?.targetId ?? dragon?.targetId ?? ufo?.targetId ?? kaiju?.targetId ?? ship?.targetId;
    const target = world.entities.get(targetId ?? -1), targetSpecies = target && speciesOf(world.registry, target);
    let action = 'idle', reason = 'roam', time: number | undefined;
    if (citizen) {
      action = citizen.emergency ? 'guard' : citizen.task === 'eat' ? 'eat' : citizen.task === 'fight' || citizen.task === 'guard' ? 'guard' : citizen.task === 'idle' ? citizen.path.length ? 'travel' : 'idle' : 'work';
      reason = citizen.emergency ? 'danger' : citizen.task === 'eat' ? 'hungry' : citizen.task !== 'idle' ? 'job' : 'roam';
      if (citizen.pregnancy > 0) time = citizen.pregnancy;
    }
    if (animal) {
      action = target ? animal.kind === 'wolf' ? 'hunt' : 'guard' : animal.moving ? 'travel' : 'idle';
      reason = target ? animal.kind === 'wolf' ? 'hungry' : 'danger' : 'roam';
      time = animal.attackIn > 0 ? animal.attackIn : undefined;
    }
    if (dragon) { action = dragon.arrival ? 'arrival' : dragon.departure ? 'departure' : dragon.breath > 0 ? 'beam' : 'travel'; time = dragon.arrival?.elapsed ?? dragon.departure?.elapsed ?? (dragon.breath > 0 ? dragon.breath : undefined); reason = target || dragon.breath > 0 ? 'job' : 'roam'; }
    if (ufo || kaiju) { const s = (ufo ?? kaiju)!; action = ufo?.arrival ? 'arrival' : ufo?.departure ? 'departure' : s.phase === 'cruise' ? 'travel' : s.phase; time = ufo?.arrival?.elapsed ?? ufo?.departure?.elapsed ?? s.phaseTime; reason = target || ['charge', 'beam'].includes(s.phase) ? 'job' : 'roam'; }
    if (ship) { action = ship.phase === 'fishing' ? 'fish' : ship.phase === 'sailing' || ship.phase === 'returning' ? 'travel' : 'idle'; time = ship.wait; reason = ship.phase === 'idle' ? 'roam' : 'job'; }
    const day = (tick: number): string => calendarDate(tick, this.language);
    const suspended = suspendedCapabilities(world, e, this.language);
    return `<p>${tr('Origin: {origin} · Appeared: {day}', { origin: this.token(creature.origin), day: creature.since === null ? this.token('unknown') : day(creature.since) })}</p>
      <p>${tr('Health: {health} · Age: {age} · Hunger: {hunger}', { health: c.health ? `${c.health.current.toFixed(1)}/${c.health.max}` : '—', age: (c.person?.age ?? animal?.age ?? dragon?.age ?? ufo?.age ?? kaiju?.age)?.toFixed(1) ?? '—', hunger: (citizen?.hunger ?? animal?.hunger)?.toFixed(1) ?? '—' })}</p>
      <p>${tr('Action: {action} · Target: {target}', { action: this.token(action), target: target ? `${targetSpecies ? this.tr(targetSpecies.label) : this.token('target')} #${target.id}` : '—' })}</p>
      <p>${tr('Reason: {reason} · Phase time: {time}s', { reason: this.token(reason), time: time?.toFixed(1) ?? '—' })}</p>
      ${suspended ? `<p>${escape(suspended)}</p>` : ''}
      ${creature.result ? `<p>${tr('Last result: {result} · {day}', { result: this.token(creature.result.kind), day: day(creature.result.at) })}</p>` : ''}`;
  }
  private coverage(): string {
    const profiles = [...this.world!.registry.species.values()], groups = [...new Set(profiles.map(p => p.group))];
    return `<p>${escape(this.tr('Forms are counted separately. Historical entries and phenomena are not playable creatures.'))}</p>` + groups.map(group => {
      const rows = profiles.filter(p => p.group === group);
      return `<p><strong>${escape(this.token(group === 'unique' ? 'unique-group' : group))}</strong><br>${escape(this.tr('Partial: {partial} · Unavailable: {unavailable} · Historical: {historical}', { partial: rows.filter(p => p.support === 'partial').length, unavailable: rows.filter(p => p.support === 'unavailable').length, historical: rows.filter(p => ['removed', 'unused', 'phenomenon'].includes(p.support)).length }))}</p>`;
    }).join('');
  }
  private families(): string {
    const tr = (s: string): string => escape(this.tr(s));
    return `<p>${tr('Only the capabilities listed for a species are available to its creatures.')}</p><ul>` + CREATURE_FAMILIES.map(([id, label, description]) => {
      const species = [...this.world!.registry.species.values()].filter(p => p.runtime?.families.includes(id));
      return `<li><strong>${tr(label)}</strong><p>${tr(description)}</p><p>${species.length ? species.map(p => tr(p.label)).join(', ') : tr('No supported species in this family yet')}</p></li>`;
    }).join('') + '</ul>';
  }
}
