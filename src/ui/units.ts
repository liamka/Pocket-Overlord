import { foodInspector } from './food';
import { PhysiologyEditor } from './physiology';
import { canUseWorldEditors } from '../core/world-rules';
import { thermalReasonLabel } from '../core/temperature';
import { calendarDate } from './calendar';
import { reproductionInspector } from './reproduction';
import { GeneEditor } from './gene-editor';
import { PhenotypeEditor } from './phenotypes';
import { subspeciesInspector } from './subspecies';
import { traitsInspector } from './traits';
import { editTrait, removeTrait } from '../core/traits';
import { SHOW_UNIT_STATS, statsInspector } from './unit-stats';
import { statusInspector } from './status-effects';
import type { Entity, Vec2 } from '../core/types';
import type { World } from '../core/world';
import { entityLabel, inspectUnit, isUnit, memoryName, renameUnit, unitLink, unitName, type UnitLink } from '../core/units';
import { translate, type Language } from '../i18n';
import { resourceEntityLines } from '../render/resources';
import { dragonGroundPosition, DRAGON } from '../content/dragons';
import { ufoPose } from '../content/ufos';
import { capabilitiesOf } from '../core/capabilities';
import { capabilityLines, suspendedCapabilities } from './capabilities';
import { residentJobLines, villageJobLines } from './jobs';
import { familyDetails, genealogyDetails } from './families';
import { taxonomyInspector } from './taxonomy';
import { neuronInspector } from './neurons';
import { setNeuronEnabled } from '../core/neurons';
import { DEATH_CAUSES, DEATH_LABELS, deathOf } from '../core/death';
import { setRebirth } from '../core/metamorphosis';
import { metamorphosisInspector } from './metamorphosis';
import { happinessInspector } from './happiness';
import { currencyInspector } from './currency';

const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const setText = (element: Element, value: string): void => { if (element.textContent !== value) element.textContent = value; };
const setHidden = (element: HTMLElement, value: boolean): void => { if (element.hidden !== value) element.hidden = value; };
const setPressed = (element: HTMLElement, value: boolean): void => { const text = String(value); if (element.getAttribute('aria-pressed') !== text) element.setAttribute('aria-pressed', text); };
export class UnitInspector {
  private readonly geneEditor: GeneEditor;
  private readonly physiologyEditor: PhysiologyEditor;
  private readonly phenotypeEditor: PhenotypeEditor;
  readonly panel = document.createElement('aside');
  selectedId: number | null = null;
  private selectedFamilyId: number | null = null;
  followId: number | null = null;
  onFocus: (point: Vec2) => void = () => {};
  private world?: World;
  private language: Language = 'en';
  private title: HTMLElement;
  private content: HTMLElement;
  private favorites: HTMLElement;
  private form: HTMLFormElement;
  private name: HTMLInputElement;
  private favorite: HTMLButtonElement;
  private follow: HTMLButtonElement;
  private returnFocus?: HTMLElement;
  private contentHTML = '';
  private favoritesHTML = '';
  constructor(root: HTMLElement, private readonly button: HTMLButtonElement, private readonly openEquipment: (id: number) => void) {
    this.geneEditor = new GeneEditor(root);
    this.physiologyEditor = new PhysiologyEditor(root);
    this.phenotypeEditor = new PhenotypeEditor(root);
    this.panel.id = 'unit-panel'; this.panel.hidden = true; this.panel.setAttribute('aria-labelledby', 'unit-title');
    this.panel.innerHTML = `<header><h2 id="unit-title"></h2><button type="button" data-close></button></header>
      <form id="unit-name-form"><label for="unit-name"></label><div><input id="unit-name" autocomplete="off" size="20"><button type="submit"></button></div><p id="unit-name-error" role="status" hidden></p></form>
      <div class="unit-actions"><button id="unit-favorite" type="button"></button><button id="unit-follow" type="button"></button></div>
      <div id="unit-content"></div><h3 id="unit-favorites-title"></h3><ul id="unit-favorites"></ul>`;
    root.append(this.panel);
    this.title = this.panel.querySelector('#unit-title')!; this.content = this.panel.querySelector('#unit-content')!;
    this.favorites = this.panel.querySelector('#unit-favorites')!; this.form = this.panel.querySelector('form')!;
    this.name = this.panel.querySelector('input')!; this.favorite = this.panel.querySelector('#unit-favorite')!; this.follow = this.panel.querySelector('#unit-follow')!;
    button.addEventListener('click', () => {
      this.returnFocus = button; this.panel.hidden = !this.panel.hidden;
      if (this.panel.hidden) this.followId = null;
      this.render();
    });
    this.form.addEventListener('submit', event => {
      event.preventDefault();
      const valid = this.world && this.selectedId !== null && renameUnit(this.world, this.selectedId, this.name.value);
      this.panel.querySelector<HTMLElement>('#unit-name-error')!.hidden = !!valid;
      if (valid) { this.name.blur(); this.render(); }
    });
    this.favorite.addEventListener('click', () => {
      const identity = this.world?.entities.get(this.selectedId ?? -1)?.components.unit
        ?? this.world?.unitHistory.find(m => m.id === this.selectedId)?.identity;
      if (identity) { identity.favorite = !identity.favorite; this.render(); }
    });
    this.follow.addEventListener('click', () => {
      this.followId = this.followId === this.selectedId ? null : this.selectedId;
      const p = this.followId === null ? undefined : this.world?.entities.get(this.followId)?.components.position;
      if (p) this.onFocus(p); this.render();
    });
    this.panel.addEventListener('click', event => {
      const b = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b || b.disabled) return;
      if (b.matches('[data-edit-physiology], [data-edit-genome], [data-edit-phenotype], [data-trait-add], [data-trait-remove], [data-trait-cure]') && this.world && !canUseWorldEditors(this.world)) return;
      if (b.hasAttribute('data-close')) this.close();
      else if (b.hasAttribute('data-edit-physiology') && this.world && this.selectedId !== null) this.physiologyEditor.open(this.world, this.selectedId, this.language);
      else if (b.hasAttribute('data-edit-genome') && this.world && this.selectedId !== null) this.geneEditor.open(this.world, this.selectedId, this.language);
      else if (b.hasAttribute('data-edit-phenotype') && this.world && this.selectedId !== null) this.phenotypeEditor.open(this.world, this.selectedId, this.language);
      else if ((b.dataset.traitAdd || b.dataset.traitRemove || b.dataset.traitCure) && this.world && this.selectedId !== null) {
        const entity = this.world.entities.get(this.selectedId);
        if (entity) {
          if (b.dataset.traitCure) removeTrait(this.world, entity, b.dataset.traitCure, 'cure');
          else editTrait(this.world, entity, (b.dataset.traitAdd ?? b.dataset.traitRemove)!, !!b.dataset.traitAdd);
          this.render();
        }
      }
      else if (b.dataset.rebirth && this.world && this.selectedId !== null) {
        const entity = this.world.entities.get(this.selectedId), choice = b.dataset.rebirth;
        if (entity && (choice === 'none' || choice === 'self' || choice === 'wolf')) { setRebirth(this.world, entity, choice); this.render(); }
      }
      else if (b.dataset.family) { this.selectedFamilyId = Number(b.dataset.family); this.render(); }
      else if (b.dataset.neuron && this.world && this.selectedId !== null) {
        const entity = this.world.entities.get(this.selectedId);
        if (entity) {
          setNeuronEnabled(this.world, entity, b.dataset.neuron, b.getAttribute('aria-pressed') !== 'true');
          this.render();
          this.content.querySelector<HTMLButtonElement>(`[data-neuron="${b.dataset.neuron}"]`)?.focus();
        }
      }
      else if (b.dataset.unit) {
        this.select(Number(b.dataset.unit));
        const p = this.world?.entities.get(this.selectedId ?? -1)?.components.position;
        if (p) this.onFocus(p);
      }
      else if (b.dataset.x && b.dataset.y) { this.followId = null; this.onFocus({ x: Number(b.dataset.x), y: Number(b.dataset.y) }); this.render(); }
      else if (b.hasAttribute('data-equipment') && this.selectedId !== null) this.openEquipment(this.selectedId);
    });
    this.panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); this.close(); } });
  }
  private tr = (key: string, values?: Record<string, string | number>): string => translate(key, this.language, values);
  close(): void { this.panel.hidden = true; this.followId = null; this.returnFocus?.focus(); }
  select(id: number): void {
    if (!this.world || !this.world.entities.get(id)?.components.unit && !this.world.unitHistory.some(m => m.id === id)) return;
    this.selectedId = id; this.selectedFamilyId = null; this.followId = null; this.panel.hidden = false;
    this.name.blur(); this.panel.querySelector<HTMLElement>('#unit-name-error')!.hidden = true; this.render();
  }
  selectAt(world: World, point: Vec2, radius: number): boolean {
    this.world = world;
    const distance = (e: Entity): number => {
      let p = e.components.position!;
      if (e.components.ufo) { const pose = ufoPose(p, e.components.ufo); p = { x: pose.ground.x, y: pose.ground.y - pose.altitude }; }
      else if (e.components.dragon) { p = dragonGroundPosition(p, e.components.dragon); p = { x: p.x, y: p.y - DRAGON.altitude }; }
      else if (e.components.person) p = { x: p.x, y: p.y - 0.65 };
      return Math.hypot(point.x - p.x, point.y - p.y);
    };
    const candidates = [...world.query('position', 'unit')].filter(isUnit).map(e => ({ e, d: distance(e) }))
      .filter(({ e, d }) => d <= Math.max(radius, e.components.ship || e.components.ufo || e.components.dragon || e.components.kaiju ? 3 : 0.8))
      .sort((a, b) => a.d - b.d || a.e.id - b.e.id);
    if (!candidates.length) return false;
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    this.select(candidates[0].e.id); return true;
  }
  update(world: World, language: Language): void {
    this.geneEditor.update(world, language); this.physiologyEditor.update(world, language);
    this.phenotypeEditor.update(world, language);
    if (this.world !== world) { this.selectedId = this.followId = null; this.panel.hidden = true; }
    this.world = world; this.language = language;
    if (this.followId !== null && !world.entities.has(this.followId)) this.followId = null;
    const label = this.tr('Units and favorites'), expanded = String(!this.panel.hidden);
    if (this.button.textContent !== label) this.button.textContent = label;
    if (this.button.getAttribute('aria-expanded') !== expanded) this.button.setAttribute('aria-expanded', expanded);
    if (!this.panel.hidden) this.render();
  }
  private link(link: UnitLink): string {
    const name = escape(link.localize ? this.tr(link.name) : link.name);
    if (link.kind === 'unit') return `<button type="button" data-unit="${link.id}">${name}${link.ended ? ` · ${escape(this.tr('Remembered'))}` : ''}</button>`;
    return link.position ? `<button type="button" data-x="${link.position.x}" data-y="${link.position.y}">${name}</button>` : name;
  }
  private render(): void {
    const world = this.world;
    if (!world || this.panel.hidden) return;
    const tr = (s: string, v?: Record<string, string | number>): string => escape(this.tr(s, v));
    const view = this.selectedId === null ? undefined : inspectUnit(world, this.selectedId);
    const memory = view ? undefined : world.unitHistory.find(m => m.id === this.selectedId);
    const identity = view?.identity ?? memory?.identity;
    setText(this.title, view ? unitName(view.entity) : memory ? memoryName(memory) : this.tr('Unit card'));
    setText(this.panel.querySelector('[data-close]')!, this.tr('Close'));
    setText(this.panel.querySelector('label')!, this.tr('Name (up to 30 characters)'));
    setText(this.panel.querySelector('[type="submit"]')!, this.tr('Rename'));
    setText(this.panel.querySelector('#unit-name-error')!, this.tr('Use up to 30 characters without line breaks.'));
    setHidden(this.form, !view);
    if (document.activeElement !== this.name) this.name.value = identity?.customName ?? identity?.displayName ?? '';
    setHidden(this.favorite, !identity); setText(this.favorite, this.tr(identity?.favorite ? 'Remove favorite' : 'Add favorite'));
    setPressed(this.favorite, identity?.favorite ?? false);
    setHidden(this.follow, !view); setText(this.follow, this.tr(this.followId === this.selectedId ? 'Stop following' : 'Follow with camera'));
    setPressed(this.follow, this.followId !== null && this.followId === this.selectedId);
    let html = '';
    const row = (label: string, value: string): void => { html += `<p><strong>${tr(label)}:</strong> ${value}</p>`; };
    if (view) {
      row('Species', tr(view.species));
      html += taxonomyInspector(view.entity.components.creature?.speciesId ?? '', this.language, !!this.content.querySelector<HTMLDetailsElement>('[data-taxonomy]')?.open);
      html += subspeciesInspector(world, view.entity, this.language, !!this.content.querySelector<HTMLDetailsElement>('[data-subspecies]')?.open);
      html += reproductionInspector(world, view.entity, this.language, !!this.content.querySelector<HTMLDetailsElement>('[data-reproduction]')?.open);
      html += traitsInspector(world, view.entity, this.language, !!this.content.querySelector<HTMLDetailsElement>('[data-traits]')?.open, !!this.content.querySelector<HTMLDetailsElement>('[data-trait-editor]')?.open);
      html += metamorphosisInspector(world, view.entity, this.language, !!this.content.querySelector<HTMLDetailsElement>('[data-metamorphosis]')?.open);
      if (view.health) row('Health', `${Math.round(view.health.current * 100) / 100} / ${Math.round(view.health.max * 100) / 100}`);
      if (SHOW_UNIT_STATS) html += statsInspector(world, view.entity, this.language, !!this.content.querySelector<HTMLDetailsElement>('[data-unit-stats]')?.open);
      html += statusInspector(world, view.entity, this.language, !!this.content.querySelector<HTMLDetailsElement>('[data-status-effects]')?.open);
      if (view.age !== undefined) row('Age', Math.floor(view.age).toString());
      if (identity?.bornAt !== null && identity?.bornAt !== undefined) row('Born', identity.bornAt < 0 ? tr('Before this world was recorded') : escape(calendarDate(identity.bornAt, this.language)));
      if (view.hunger !== undefined) row('Hunger', `${Math.round(view.hunger)}%`);
      html += foodInspector(world, view.entity, this.language, !!this.content.querySelector<HTMLDetailsElement>('[data-food]')?.open);
      html += happinessInspector(world, view.entity, this.language, !!this.content.querySelector<HTMLDetailsElement>('[data-happiness-history]')?.open);
      html += currencyInspector(world, view.entity, this.language, !!this.content.querySelector<HTMLDetailsElement>('[data-money-history]')?.open);
      const government = world.society.villages.find(v => v.government?.leaderId === view.entity.id)?.government;
      if (government) row("Residents' trust in this elder", `${Math.round(government.trust)}%`);
      if (view.occupation) row('Occupation', tr(view.occupation));
      html += residentJobLines(world, view.entity, this.language).map(line => `<p>${escape(line)}</p>`).join('');
      if (view.task) row('Current task', tr(view.task));
      if (view.stage) row('Current stage', tr(view.stage) + (view.progress ? ` · ${Math.floor(view.progress * 100)}%` : ''));
      if (view.target) row('Target', this.link(view.target));
      if (view.reason && view.reason !== view.stage) row('Reason', tr(view.reason));
      html += neuronInspector(world, view.entity, this.language, this.content.querySelector<HTMLDetailsElement>('[data-neurons]')?.open ?? false);
      if (view.statuses.length) row('Current state', view.statuses.map(s => tr(s)).join(' · '));
      const thermal = view.entity.components.thermal;
      if (thermal) {
        row('Temperature', `${Math.round(thermal.temperature * 10) / 10} ${tr('heat units')}`);
        if (thermal.lastChange) row('Thermal cause', tr(thermalReasonLabel[thermal.lastChange.reason]));
      }
      const ignition = thermal?.ignition;
      if (view.entity.components.thermal?.burning) {
        row('Danger', tr(DEATH_LABELS.fire));
        if (ignition?.sourceName) row('Initiator', escape(ignition.sourceName));
        else if (ignition?.player) row('Initiator', tr('Player'));
      }
      const suspended = suspendedCapabilities(world, view.entity, this.language);
      if (suspended) html += `<p>${escape(suspended)}</p>`;
      const capabilities = capabilitiesOf(world.registry, view.entity);
      if (capabilities) html += `<details data-capabilities=""${this.content.querySelector<HTMLDetailsElement>('[data-capabilities]')?.open ? ' open=""' : ''}><summary>${tr('Capabilities')}</summary>${capabilityLines(capabilities, this.language).map(line => `<p>${escape(line)}</p>`).join('')}</details>`;
      if (view.home) row('Home', this.link(view.home));
      if (view.village) row('Settlement', this.link(view.village));
      const jobVillage = view.entity.components.citizen && world.society.villages.find(v => v.id === view.entity.components.citizen!.villageId);
      if (jobVillage) html += `<details data-jobs=""${this.content.querySelector<HTMLDetailsElement>('[data-jobs]')?.open ? ' open' : ''}><summary>${tr('Jobs and vacancies')}</summary>${villageJobLines(world, jobVillage, this.language).map(line => `<p>${escape(line)}</p>`).join('')}</details>`;
      for (const relative of view.family) row(relative.relation, this.link(relative.member));
      html += resourceEntityLines(view.entity, this.language, world).map(line => `<p>${escape(line)}</p>`).join('');
      if (view.equipment) html += `<button type="button" data-equipment>${tr('Equipment')}</button>`;
    } else if (memory) {
      row('Species', tr(entityLabel(world, { id: memory.id, typeId: memory.typeId, components: {} })));
      row('Current state', tr(memory.died ? 'Deceased' : 'Left the world'));
      if (memory.endedAt !== null) row('Recorded', escape(calendarDate(memory.endedAt, this.language)));
      const death = deathOf(world, memory.id);
      if (death) {
        row('Cause of death', tr(DEATH_LABELS[death.cause]));
        if (death.initiator) row('Initiator', escape(death.initiator.name));
        else if (death.player) row('Initiator', tr('Player'));
        if (death.villageName) row('Former settlement', escape(this.tr(death.villageName)));
        row('Place of death', this.link({ kind: 'place', id: 0, name: 'Show on map', localize: true, position: death.position }));
        if (death.successor) row('Successor', escape(death.successor.name));
        if (death.transformedInto) { const link = unitLink(world, death.transformedInto.id); row('New form', link ? this.link(link) : escape(death.transformedInto.name)); }
      } else if (memory.died) row('Cause of death', tr('Cause not recorded'));
      if (memory.continuedAs !== undefined && !death?.transformedInto) { const link = unitLink(world, memory.continuedAs); if (link) row('New form', this.link(link)); }
      if (memory.echoId !== undefined) { const link = unitLink(world, memory.echoId); if (link) row('Additional soul', this.link(link)); }
      for (const parent of memory.parents) { const link = unitLink(world, parent); if (link) row('Parent', this.link(link)); }
    } else html = `<p>${tr('Select a unit on the map with Inspect unit, or choose a favorite.')}</p>`;
    html += `<details data-deaths=""${this.content.querySelector<HTMLDetailsElement>('[data-deaths]')?.open ? ' open=""' : ''}><summary>${tr('Deaths recorded')}: ${world.deaths.total}</summary>`;
    for (const cause of DEATH_CAUSES) if (world.deaths.causes[cause]) row(DEATH_LABELS[cause], String(world.deaths.causes[cause]));
    html += `<p>${tr('Recent deaths')}</p><ul>` + world.deaths.recent.slice(-8).reverse().map(d =>
      `<li>${this.link({ kind: 'unit', id: d.victimId, name: d.name, ended: true })} · ${tr(DEATH_LABELS[d.cause])}</li>`).join('') + '</ul>';
    if (world.deaths.notable.length) html += `<p>${tr('Favorites and elders')}</p><ul>` + world.deaths.notable.slice().reverse().map(d =>
      `<li>${this.link({ kind: 'unit', id: d.victimId, name: d.name, ended: true })} · ${tr(DEATH_LABELS[d.cause])}</li>`).join('') + '</ul>';
    html += '</details>';
    if (this.selectedId !== null && (view?.entity.components.kinship || memory?.kinship)) {
      html += familyDetails(world, this.selectedId, this.selectedFamilyId, this.language, value => this.link(value));
      html += genealogyDetails(world, this.selectedId, this.language, value => this.link(value), !!this.content.querySelector<HTMLDetailsElement>('[data-genealogy]')?.open);
    }
    if (!canUseWorldEditors(world)) {
      html = html.replace(/<button([^>]*(?:data-edit-genome|data-edit-phenotype|data-trait-add|data-trait-remove|data-trait-cure)[^>]*)>/g, '<button$1 disabled>');
      if (view) html += `<p>${tr('Enable experimental mode in World laws to edit.')}</p>`;
    }
    if (this.contentHTML !== html) {
      const focused = document.activeElement instanceof HTMLButtonElement && this.content.contains(document.activeElement) ? document.activeElement : undefined;
      const index = focused ? [...this.content.querySelectorAll('button')].indexOf(focused) : -1;
      this.content.innerHTML = html; this.contentHTML = html;
      if (index >= 0) this.content.querySelectorAll('button')[index]?.focus({ preventScroll: true });
    }
    setText(this.panel.querySelector('#unit-favorites-title')!, this.tr('Favorites'));
    const favorites = [...world.query('unit')].filter(e => e.components.unit!.favorite).map(e => `<li>${this.link(unitLink(world, e.id)!)}</li>`)
      .concat(world.unitHistory.filter(m => m.identity.favorite).map(m => `<li>${this.link(unitLink(world, m.id)!)}</li>`)).join('') || `<li>${tr('No favorites yet')}</li>`;
    if (this.favoritesHTML !== favorites) { this.favorites.innerHTML = favorites; this.favoritesHTML = favorites; }
  }
}
