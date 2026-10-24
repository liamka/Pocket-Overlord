import type { Registry, ToolDefinition } from './content/registry';
import type { World } from './core/world';
import { BIOMES, type BiomeId } from './core/biomes';
import { NATURAL_BIOMES, type NaturalBiome } from './core/natural-biomes';
import { drawToolIcon, villageColor } from './render/sprites';
import { allianceGroups, sideName } from './core/diplomacy';
import { isLanguage, languages, loadLanguage, saveLanguage, translate } from './i18n';
import { roadIsIntact } from './core/roads';
import { SIMULATION_SPEEDS, speedLabel, type SimulationSpeed } from './core/types';
import { version as projectVersion } from '../package.json';
import { seasonAt, yearAt } from './core/seasons';
import { localizedSettlementName, settlementTextLocalizer } from './content/settlement-names';
import { RACES } from './core/races';
import { generateTerrain } from './core/terrain';
import { drawWorldPreview } from './render/world-preview';

const escapeText = (text: string): string => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

const icons = {
  settings: '<path fill="#c5dad9" fill-rule="evenodd" d="M10 1h4v4h2V4h1V3h2v1h1v1h1v2h-1v1h-1v2h4v4h-4v2h1v1h1v2h-1v1h-1v1h-2v-1h-1v-1h-2v4h-4v-4H8v1H7v1H5v-1H4v-1H3v-2h1v-1h1v-2H1v-4h4V8H4V7H3V5h1V4h1V3h2v1h1v1h2zM10 8h4v1h1v1h1v4h-1v1h-1v1h-4v-1H9v-1H8v-4h1V9h1z"/>',
  pause: '<path fill="#12476b" d="M5 5h6v16H5zm10 0h6v16h-6z"/><path fill="#28b3e5" d="M4 3h6v16H4zm10 0h6v16h-6z"/><path fill="#8ce5ee" d="M4 3h2v14H4zm10 0h2v14h-2z"/>',
  play: '<path fill="#12476b" d="M7 4h3v2h3v2h3v2h3v4h-3v2h-3v2h-3v2H7z"/><path fill="#30bde6" d="M5 2h3v2h3v2h3v2h3v2h3v2h-3v2h-3v2h-3v2H8v2H5z"/><path fill="#8ce5ee" d="M5 2h2v16H5z"/>',
  slower: '<path fill="currentColor" d="M13 4h4v2h-2v2h-2v2h-2v4h2v2h2v2h2v2h-4v-2h-2v-2H9v-2H7v-4h2V8h2V6h2z"/>',
  faster: '<path fill="currentColor" transform="translate(24 0) scale(-1 1)" d="M13 4h4v2h-2v2h-2v2h-2v4h2v2h2v2h2v2h-4v-2h-2v-2H9v-2H7v-4h2V8h2V6h2z"/>',
  fit: '<path fill="#a8c8bd" d="M3 3h7v3H6v4H3zm11 0h7v7h-3V6h-4zM3 14h3v4h4v3H3zm15 0h3v7h-7v-3h4z"/><path fill="#57a3a7" d="M10 10h4v4h-4z"/>',
  globe: '<path fill="#12292c" d="M7 1h10v2h4v4h2v10h-2v4h-4v2H7v-2H3v-4H1V7h2V3h4z"/><path fill="#187cb0" d="M7 3h10v2h3v3h1v8h-2v3h-3v2H8v-2H5v-3H3V8h2V5h2z"/><path fill="#46c5df" d="M7 3h9v2H8v2H5v8H3V8h2V5h2zm10 14h2v2h-3v2h-6v-2h7z"/><path fill="#6cbc3b" d="M9 5h6v2h3v3h-3v3h-3v-3H8V7h1zM5 12h4v2h3v3h-2v3H8v-3H5zm12 2h3v3h-3z"/><path fill="#c4e78a" d="M9 5h5v2H9zm-4 7h3v2H5z"/>',
  person: '<path fill="currentColor" d="M9 2h6v6H9zm1 7h4v3h5v3h-4v3h2v4h-4v-5h-2v5H7v-4h2v-3H5v-3h5z"/>',
  home: '<path fill="#af633e" d="M10 3h4v2h3v3h3v3h2v3H2v-3h2V8h3V5h3z"/><path fill="#e0bf78" d="M5 13h14v8H5z"/><path fill="#6c4b33" d="M10 15h4v6h-4z"/><path fill="#e59a50" d="M10 3h4v2H9v3H6v3H3v2H2v-2h2V8h3V5h3z"/><path fill="#81b8c1" d="M6 15h3v3H6zm9 0h3v3h-3z"/>',
  mountain: '<path fill="currentColor" d="M1 18v-3h2v-3h2V9h2V6h3v3h2V7h2V4h3v3h2v3h2v3h2v5z"/><path fill="#738070" d="M7 9h2v3h2v3h2v3h-3v-3H8v-3H6zm8-2h2v3h2v3h2v3h-3v-3h-2v-3h-2z"/>',
  cloud: '<path fill="currentColor" d="M7 3h8v2h4v3h3v7H2V8h3V5h2zM5 17h2v4H5zm6 1h2v5h-2zm6-1h2v4h-2z"/>',
  destruction: '<path fill="currentColor" fill-rule="evenodd" d="M7 2h10v2h3v3h2v8h-3v3h-2v4H7v-4H5v-3H2V7h2V4h3zM5 8v4h5V8zm9 0v4h5V8zm-3 5v3h2v-3zM9 18v4h2v-4zm4 0v4h2v-4z"/>',
  clock: '<path fill="#9b752d" d="M5 2h14v3H5zm2 3h10v4h-2v2h-2v2h2v2h2v4h2v3H5v-3h2v-4h2v-2h2v-2H9V9H7z"/><path fill="#f4d378" d="M6 2h12v2H6zm2 4h8v2h-2v2h-4V8H8zm2 9h4v2h2v2H8v-2h2zM6 20h12v1H6z"/>',
};
export const icon = (name: keyof typeof icons): string => `<svg viewBox="0 0 24 24" shape-rendering="crispEdges" aria-hidden="true">${icons[name]}</svg>`;

const speedGlyphs: Record<string, string[]> = {
  '0': ['1111', '1001', '1001', '1001', '1001', '1001', '1111'],
  '1': ['010', '110', '010', '010', '010', '010', '111'],
  '2': ['111', '001', '001', '111', '100', '100', '111'],
  '4': ['101', '101', '101', '111', '001', '001', '001'],
  '5': ['111', '100', '100', '111', '001', '001', '111'],
  '/': ['001', '001', '010', '010', '010', '100', '100'],
  '×': ['00000', '10001', '01010', '00100', '01010', '10001', '00000'],
};
function speedDigits(speed: SimulationSpeed): string {
  const characters = [...(speed === 0.2 ? '1/5×' : speedLabel(speed))];
  let offset = 0;
  const pixels = characters.flatMap(character => {
    const glyph = speedGlyphs[character], left = offset;
    offset += glyph[0].length + 1;
    return glyph.flatMap((row, y) =>
      [...row].flatMap((pixel, x) => pixel === '1' ? [`M${left + x} ${y}h1v1h-1z`] : []),
    );
  }).join('');
  const width = offset - 1;
  return `<svg class="speed-digits" viewBox="0 0 ${width} 7" width="${width * 2}" height="14" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="${pixels}"/></svg><span class="sr-only">${speedLabel(speed)}</span>`;
}

const categories: { id: string; label: string; icon: keyof typeof icons }[] = [
  { id: 'biomes', label: 'Biomes', icon: 'mountain' },
  { id: 'people', label: 'Peoples and creatures', icon: 'person' },
  { id: 'nature', label: 'Природа', icon: 'cloud' },
  { id: 'destruction', label: 'Разрушение', icon: 'destruction' },
];
const SELECTED_TOOL_KEY = 'pocket-world.selected-tool';

export class UI {
  readonly canvas: HTMLCanvasElement;
  readonly dialog: HTMLDialogElement;
  readonly settingsDialog: HTMLDialogElement;
  readonly speedButtons: HTMLButtonElement[];
  readonly timeToggle: HTMLButtonElement;
  readonly slower: HTMLButtonElement;
  readonly faster: HTMLButtonElement;
  readonly speedPicker: HTMLButtonElement;
  readonly timeButtons: HTMLButtonElement[];
  private readonly speedMenu: HTMLElement;
  private timeReady = false;
  private worldSeed = 0;
  private readonly seedInput: HTMLInputElement;
  get newWorldSeed(): number { return this.worldSeed; }
  readonly newWorld: HTMLButtonElement;
  readonly confirmNew: HTMLButtonElement;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private category = 'people';
  private selectedTool = 'core:human';
  get currentTool(): ToolDefinition { return this.registry.tools.get(this.selectedTool)!; }
  private language = loadLanguage();
  get currentLanguage() { return this.language; }
  private staticText: { node: Text; source: string }[] = [];
  private staticAttributes: { element: Element; attribute: string; source: string }[] = [];
  private lastWorld: World | undefined;
  private lastZoom = 1;
  private savedText = 'Загрузка мира…';
  private saveHadError = false;
  private warningText = '';
  private toastText = '';
  private description = document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ?? '';
  private root: HTMLElement;
  private get<T extends HTMLElement>(selector: string): T { return this.root.querySelector<T>(selector)!; }
  constructor(private readonly registry: Registry, select: (id: string) => void, private readonly debugMode = false) {
    try {
      const saved = localStorage.getItem(SELECTED_TOOL_KEY);
      if (saved && registry.tools.has(saved)) this.selectedTool = saved;
    } catch { /* Keep the default when browser storage is unavailable. */ }
    this.category = this.currentTool.category ?? 'nature';
    const availableCategories = categories.filter(category => [...registry.tools.values()].some(tool => (tool.category ?? 'nature') === category.id));
    this.root = document.querySelector('#app')!;
    this.root.innerHTML = `
      <canvas id="world" aria-label="Карта острова. Выберите инструмент и щёлкните по карте." tabindex="0"></canvas>
      <aside class="world-overview" aria-label="Статистика мира">
        <div class="world-stats" aria-label="Состояние мира">
          <div class="world-age">${icon('clock')}<span id="world-age">День 1</span><span class="live-dot"></span></div>
          <div class="season-status"><span id="season-name">Spring</span><span id="season-year">Year 1</span></div>
          <div class="stat">${icon('person')}<span>жителей</span><strong id="population">0</strong></div>
          <div class="stat">${icon('home')}<span>домов</span><strong id="houses">0</strong></div>
          <div class="stat food-stocks"><span>Food reserves</span><strong id="food-stocks">0</strong></div>
          <span class="save-status" id="save-status" role="status">Загрузка мира…</span>
        </div>
        <details id="society-panel" class="society-panel" open hidden><summary>Поселения <strong id="village-count">0</strong></summary><div class="society-totals"><span>Семей <b id="families">0</b></span><span>Детей <b id="children">0</b></span><span>Полей <b id="fields">0</b></span></div><div id="village-list" class="village-list"></div><div id="relations" class="relations"></div><div id="alliances" class="alliance-list" aria-label="Состав союзов"></div><div id="campaigns" class="campaign-list" aria-label="Совместные войны"></div><div class="chronicle-title">Летопись мира</div><ol id="chronicle" class="chronicle"></ol></details>
      </aside>
      <button id="settings" class="pixel-button" aria-label="Настройки" title="Настройки">${icon('settings')}</button>
      <div id="save-warning" class="save-warning" role="alert" hidden></div>
      <div id="pause-badge" class="pause-badge" hidden>${icon('pause')} Мир на паузе</div>
      <div id="empty-hint" class="empty-hint"><span class="hint-line"></span>Всё начинается с одного человека<span>Выберите свободное место на карте</span></div>
      <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
      <section class="game-panel" aria-label="Инструменты мира">
        <nav class="category-tabs" aria-label="Категории инструментов">${availableCategories.map(c => `<button class="category-tab" data-category="${c.id}" aria-label="${c.label}" aria-pressed="${c.id === this.category}" title="${c.label}">${icon(c.icon)}<span>${c.label}</span></button>`).join('')}</nav>
        <div class="panel-content">
          <div class="tool-dock" role="toolbar" aria-label="Выбор инструмента">${[...registry.tools.values()].map(t => `<button class="tool pixel-button" data-tool="${t.id}" aria-label="${t.label}" aria-pressed="false" title="${t.label}">${t.shortcut ? `<kbd>${t.shortcut}</kbd>` : ''}<canvas width="64" height="64" aria-hidden="true"></canvas><span class="sr-only">${t.label}</span></button>`).join('')}</div>
          <div class="tool-caption"><div class="tool-title"><span id="tool-name">Человек</span><kbd id="tool-key" hidden></kbd></div><p id="tool-hint"></p><div class="camera-hint">${icon('fit')}<output id="zoom-value" aria-label="Масштаб карты">100%</output><span>Wheel: zoom · Drag: pan</span></div></div>
        </div>
      </section>
      <div class="playback-panel">
        <div id="speed-menu" class="speed-menu" role="menu" aria-label="Скорость игры" hidden>${SIMULATION_SPEEDS.map(speed => `<button class="speed-option" role="menuitemradio" data-speed="${speed}" aria-label="${speedLabel(speed)}" aria-checked="${speed === 1}" tabindex="-1"${speed === 1 || speed === 2 || speed === 4 ? ` aria-keyshortcuts="${speed === 1 ? 2 : speed === 2 ? 3 : 4}"` : ''}><span>${speedLabel(speed)}</span><span class="speed-description">${speed === 0.2 ? 'медленно' : speed === 1 ? 'обычно' : speed === SIMULATION_SPEEDS.at(-1) ? 'максимум' : ''}</span></button>`).join('')}</div>
        <div class="speed-controls" role="group" aria-label="Скорость игры">
          <button id="time-toggle" class="pixel-button time-button time-toggle" aria-label="Стоп" aria-pressed="false" aria-keyshortcuts="Space 1" title="Остановить время · Пробел"><span class="time-play-icon">${icon('play')}</span><span class="time-pause-icon">${icon('pause')}</span></button>
          <button id="time-slower" class="pixel-button time-button time-arrow" aria-label="Уменьшить скорость" title="Уменьшить скорость">${icon('slower')}</button>
          <button id="speed-picker" class="pixel-button time-button speed-picker" aria-label="Выбрать скорость" aria-describedby="speed-value" aria-haspopup="menu" aria-controls="speed-menu" aria-expanded="false" title="Выбрать скорость"><span id="speed-value" class="speed-value">${speedDigits(1)}</span></button>
          <button id="time-faster" class="pixel-button time-button time-arrow" aria-label="Увеличить скорость" title="Увеличить скорость">${icon('faster')}</button>
        </div>
      </div>
      <small id="project-version" class="project-version" translate="no">ver ${projectVersion}</small>
      <div class="desktop-note">Для игры нужны мышь и клавиатура</div>
      <dialog id="new-dialog" aria-labelledby="new-title"><div class="dialog-symbol">${icon('globe')}</div><h2 id="new-title">Начать новый мир?</h2><p id="new-description">На месте этого острова появится новый. Текущий мир будет заменён.</p>
        <div class="seed-setting"><label class="settings-label" for="world-seed">World seed</label><div class="seed-controls"><input id="world-seed" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" aria-describedby="seed-hint seed-error"><button id="randomize-seed" class="secondary" type="button">Randomize</button></div><p id="seed-error" class="seed-error" role="alert" hidden>Enter a whole number from 0 to 4294967295.</p><p id="seed-hint" class="seed-hint">Use the same world settings to recreate this map.</p></div>
        <div class="new-world-options"><div><label class="settings-label" for="nature-select">Nature</label><select id="nature-select" name="nature"><option value="">Mixed biomes</option>${NATURAL_BIOMES.map(biome => `<option value="${biome.key}">${escapeText(biome.name)}</option>`).join('')}</select>
        ${debugMode ? `<label class="settings-label" for="biome-select">Island shape</label><select id="biome-select" name="biome"><option value="">Random</option>${BIOMES.map(biome => `<option value="${biome.id}">${escapeText(biome.name)}</option>`).join('')}</select>` : ''}</div><figure class="world-preview"><figcaption>Preview</figcaption><canvas id="world-preview" width="128" height="96" role="img" aria-label="Preview of the new island"></canvas></figure></div><div class="dialog-actions"><button class="secondary" type="button" value="cancel" autofocus>Оставить этот</button><button id="confirm-new" class="primary" type="button" value="new">Создать мир</button></div></dialog>`;
    this.root.insertAdjacentHTML('beforeend', `<dialog id="settings-dialog" aria-labelledby="settings-title"><form method="dialog"><div class="dialog-symbol">${icon('settings')}</div><h2 id="settings-title">Настройки</h2><label class="settings-label" for="language-select">Язык</label><select id="language-select" name="language">${languages.map(language => `<option value="${language.id}" lang="${language.id}">${language.name}</option>`).join('')}</select><p id="language-warning" class="language-warning" role="status" hidden>Не удалось запомнить язык. Выбор действует до перезагрузки страницы.</p><div class="dialog-actions"><button id="new-world" class="secondary" type="button">${icon('globe')}<span>New world</span></button><button class="primary" value="done">Готово</button></div></form></dialog>`);
    this.canvas = this.get('#world'); this.dialog = this.get('#new-dialog'); this.settingsDialog = this.get('#settings-dialog');
    this.get('#settings-dialog .dialog-actions').insertAdjacentHTML('beforebegin', `<div class="seed-setting"><label class="settings-label" for="current-world-seed">World seed</label><div class="seed-controls"><input id="current-world-seed" type="text" readonly><button id="copy-seed" class="secondary" type="button">Copy seed</button></div><p id="seed-copy-status" class="seed-hint" role="status" hidden></p></div>`);
    this.newWorld = this.get('#new-world'); this.confirmNew = this.get('#confirm-new');
    this.seedInput = this.get('#world-seed');
    this.seedInput.addEventListener('input', () => { if (this.readWorldSeed()) this.updateWorldPreview(); });
    this.get('#randomize-seed').addEventListener('click', () => {
      try { this.setWorldSeed(crypto.getRandomValues(new Uint32Array(1))[0]); }
      catch { this.toast('Could not create the world. Try again.'); }
    });
    this.get('#copy-seed').addEventListener('click', () => { void this.copyWorldSeed(); });
    this.dialog.addEventListener('change', event => {
      if (event.target instanceof HTMLSelectElement && this.readWorldSeed()) this.updateWorldPreview();
    });
    // Choosing an option or pressing Enter in the picker must not submit the dialog.
    this.confirmNew.addEventListener('click', () => { if (this.readWorldSeed()) this.dialog.close('new'); });
    this.get('#new-dialog button[value="cancel"]').addEventListener('click', () => this.dialog.close('cancel'));
    this.speedButtons = [...this.root.querySelectorAll<HTMLButtonElement>('[data-speed]')];
    this.timeToggle = this.get('#time-toggle'); this.slower = this.get('#time-slower'); this.faster = this.get('#time-faster');
    this.speedPicker = this.get('#speed-picker'); this.speedMenu = this.get('#speed-menu');
    this.timeButtons = [...this.speedButtons, this.timeToggle, this.slower, this.faster, this.speedPicker];
    this.speedPicker.addEventListener('click', () => this.speedMenu.hidden ? this.openSpeedMenu() : this.closeSpeedMenu());
    this.speedPicker.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); this.openSpeedMenu(); }
    });
    this.speedMenu.addEventListener('keydown', event => {
      if (event.key === 'Tab') { this.closeSpeedMenu(true); return; }
      const index = this.speedButtons.indexOf(document.activeElement as HTMLButtonElement);
      let next: number;
      if (event.key === 'ArrowDown') next = (index + 1) % this.speedButtons.length;
      else if (event.key === 'ArrowUp') next = (index + this.speedButtons.length - 1) % this.speedButtons.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = this.speedButtons.length - 1;
      else return;
      event.preventDefault(); this.speedButtons[next].focus();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !this.speedMenu.hidden) { event.preventDefault(); this.closeSpeedMenu(true); }
    });
    document.addEventListener('pointerdown', event => {
      if (!(event.target instanceof Element) || !event.target.closest('.playback-panel')) this.closeSpeedMenu();
    });
    this.get('.playback-panel').addEventListener('focusout', event => {
      if (!(event.relatedTarget instanceof Node) || !this.get('.playback-panel').contains(event.relatedTarget)) this.closeSpeedMenu();
    });
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
      drawToolIcon(button.querySelector('canvas')!, registry.tools.get(button.dataset.tool!)!.icon);
      button.addEventListener('click', () => select(button.dataset.tool!));
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-category]')) {
      button.addEventListener('click', () => {
        this.category = button.dataset.category!;
        const first = [...registry.tools.values()].find(tool => (tool.category ?? 'nature') === this.category);
        if (first && (registry.tools.get(this.selectedTool)?.category ?? 'nature') !== this.category) select(first.id);
        this.updateCategory();
      });
    }
    this.get('#settings').addEventListener('click', () => {
      this.get('#seed-copy-status').hidden = true;
      this.settingsDialog.showModal();
    });
    const languageSelect = this.get<HTMLSelectElement>('#language-select');
    languageSelect.value = this.language;
    languageSelect.addEventListener('change', () => {
      if (!isLanguage(languageSelect.value)) return;
      this.language = languageSelect.value;
      this.get('#seed-copy-status').hidden = true;
      this.applyLanguage();
      this.get('#language-warning').hidden = saveLanguage(this.language);
    });
    for (const dialog of [this.dialog, this.settingsDialog]) dialog.addEventListener('click', event => {
      // Native select popups and keyboard clicks can carry unrelated screen coordinates.
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close('cancel');
    });
    // Keep the original text nodes so changing language never replaces the canvas or its listeners.
    const walker = document.createTreeWalker(this.root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (node.data.trim()) this.staticText.push({ node, source: node.data });
    }
    for (const element of this.root.querySelectorAll('[aria-label], [title]')) for (const attribute of ['aria-label', 'title']) {
      const source = element.getAttribute(attribute);
      if (source) this.staticAttributes.push({ element, attribute, source });
    }
    this.applyLanguage();
  }
  private tr(source: string, values: Record<string, string | number> = {}): string { return translate(source, this.language, values); }
  private applyLanguage(): void {
    document.documentElement.lang = this.language;
    document.title = this.tr('Pocket World — pixel sandbox');
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (description) description.content = this.tr(this.description);
    for (const { node, source } of this.staticText) if (node.isConnected) {
      node.data = source.replace(/\S[\s\S]*\S|\S/, text => this.tr(text));
    }
    for (const { element, attribute, source } of this.staticAttributes) element.setAttribute(attribute, this.tr(source));
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
      const tool = this.registry.tools.get(button.dataset.tool!)!;
      button.setAttribute('aria-label', this.tr(tool.label));
      button.title = this.tr(tool.label) + (tool.shortcut ? ` · ${tool.shortcut}` : '');
      button.querySelector('.sr-only')!.textContent = this.tr(tool.label);
    }
    this.select(this.registry.tools.get(this.selectedTool)!);
    this.saved(this.savedText, this.saveHadError); this.warning(this.warningText);
    this.get('#toast').textContent = this.tr(this.toastText);
    if (this.lastWorld) this.update(this.lastWorld, this.lastZoom);
  }
  private openSpeedMenu(): void {
    if (!this.timeReady) return;
    this.speedMenu.hidden = false; this.speedPicker.setAttribute('aria-expanded', 'true');
    (this.speedButtons.find(button => button.getAttribute('aria-checked') === 'true') ?? this.speedButtons[0]).focus();
  }
  closeSpeedMenu(restoreFocus = false): void {
    this.speedMenu.hidden = true; this.speedPicker.setAttribute('aria-expanded', 'false');
    if (restoreFocus) this.speedPicker.focus();
  }
  setTimeReady(ready: boolean): void {
    this.timeReady = ready;
    for (const button of this.timeButtons) button.disabled = !ready;
    if (this.lastWorld) this.updateTime(this.lastWorld);
  }
  setLoading(message: 'Loading world…' | 'Creating world…' | null): void {
    const screen = document.querySelector<HTMLElement>('#loading-screen')!;
    this.root.inert = message !== null;
    this.root.setAttribute('aria-busy', String(message !== null));
    this.newWorld.disabled = message !== null;
    this.setTimeReady(message === null);
    if (message !== null) {
      this.closeSpeedMenu();
      this.setLoadingProgress(0, 1);
      screen.dataset.mode = message === 'Creating world…' ? 'create' : 'startup';
      document.querySelector('#loading-message')!.textContent = this.tr(message);
    }
    screen.hidden = message === null;
    if (message === null && screen.dataset.mode === 'create') this.canvas.focus({ preventScroll: true });
  }
  setLoadingProgress(completedSteps: number, totalSteps: number): void {
    const percent = Math.round(completedSteps / totalSteps * 100);
    const progress = document.querySelector<HTMLElement>('#loading-progress')!;
    progress.textContent = `${percent}%`;
    progress.setAttribute('aria-valuenow', String(percent));
  }
  loadingFailed(): void {
    document.querySelector<HTMLElement>('#loading-screen')!.dataset.failed = 'true';
    document.querySelector('#loading-message')!.textContent = this.tr('Could not load the world.');
    const retry = document.querySelector<HTMLButtonElement>('#loading-retry')!;
    retry.textContent = this.tr('Try again'); retry.hidden = false;
    retry.onclick = () => window.location.reload();
    retry.focus({ preventScroll: true });
  }
  private updateTime(world: World): void {
    this.timeToggle.setAttribute('aria-pressed', String(world.paused));
    this.timeToggle.setAttribute('aria-label', this.tr(world.paused ? 'Старт' : 'Стоп'));
    this.timeToggle.title = this.tr(world.paused ? 'Продолжить время · Пробел' : 'Остановить время · Пробел');
    const speedValue = this.get('#speed-value');
    if (speedValue.textContent !== speedLabel(world.speed)) speedValue.innerHTML = speedDigits(world.speed);
    for (const button of this.speedButtons) button.setAttribute('aria-checked', String(Number(button.dataset.speed) === world.speed));
    this.slower.disabled = !this.timeReady || world.speed === SIMULATION_SPEEDS[0];
    this.faster.disabled = !this.timeReady || world.speed === SIMULATION_SPEEDS[SIMULATION_SPEEDS.length - 1];
  }
  select(tool: ToolDefinition): void {
    this.selectedTool = tool.id;
    try { localStorage.setItem(SELECTED_TOOL_KEY, tool.id); }
    catch { /* Tool selection remains usable when browser storage is unavailable. */ }
    this.category = tool.category ?? 'nature';
    this.updateCategory();
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-tool]')) button.setAttribute('aria-pressed', String(button.dataset.tool === tool.id));
    this.get('#tool-name').textContent = this.tr(tool.label);
    this.get('#tool-hint').textContent = this.tr(tool.hint);
    this.get('.camera-hint > span:last-child').textContent = this.tr(tool.paint ? 'Wheel: zoom · Left-drag: plant · Right-drag: pan' : 'Wheel: zoom · Drag: pan');
    const shortcut = this.get('#tool-key');
    shortcut.textContent = tool.shortcut ?? '';
    shortcut.hidden = !tool.shortcut;
  }
  private updateCategory(): void {
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-category]')) button.setAttribute('aria-pressed', String(button.dataset.category === this.category));
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-tool]')) button.hidden = (this.registry.tools.get(button.dataset.tool!)?.category ?? 'nature') !== this.category;
  }
  update(world: World, zoom: number): void {
    if (this.lastWorld !== world) this.get<HTMLInputElement>('#current-world-seed').value = String(world.seed);
    this.lastWorld = world; this.lastZoom = zoom;
    this.get('#population').textContent = String(world.population);
    this.get('#houses').textContent = String(world.houseCount);
    this.updateSociety(world);
    this.get('#world-age').textContent = this.tr('День {day}', { day: 1 + Math.floor(world.tick / 1800) });
    this.get('#season-name').textContent = this.tr(seasonAt(world.tick).label);
    this.get('#season-year').textContent = this.tr('Year {year}', { year: yearAt(world.tick) });
    this.get('#food-stocks').textContent = String(Math.floor(world.society.villages.reduce((total, village) => total + village.food, 0)));
    this.get('#empty-hint').hidden = world.population > 0 || world.houseCount > 0;
    this.get('#pause-badge').hidden = !world.paused;
    this.get('.live-dot').classList.toggle('is-paused', world.paused);
    this.updateTime(world);
    this.get('#zoom-value').textContent = `${Math.round(zoom * 100)}%`;
  }
  private updateSociety(world: World): void {
    const nameText = settlementTextLocalizer(world.seed, world.society.villages, this.language);
    const people = [...world.query('person', 'citizen')], fields = [...world.query('farm')];
    this.get('#society-panel').hidden = world.society.villages.length === 0;
    this.get('#village-count').textContent = String(world.society.villages.length);
    this.get('#families').textContent = String(people.filter(e => e.components.citizen!.partnerId !== null).length / 2);
    this.get('#children').textContent = String(people.filter(e => e.components.person!.age < 18).length);
    this.get('#fields').textContent = String(fields.length);
    const replace = (selector: string, html: string): void => { const element = this.get(selector); if (element.innerHTML !== html) element.innerHTML = html; };
    replace('#village-list', world.society.villages.map(v => {
      const residents = people.filter(e => e.components.citizen!.villageId === v.id);
      const hungry = residents.filter(e => e.components.citizen!.hunger >= 75).length;
      const detail = this.tr(RACES[v.race ?? 'human'].label) + ' · ' + this.tr('{count} жителей · {food} еды', { count: residents.length, food: Math.floor(v.food) }) + (hungry ? this.tr(' · {count} голодают', { count: hungry }) : '');
      return `<div class="village-row"><span class="village-flag" style="background:${villageColor(v.id)}"></span><div><strong>${escapeText(localizedSettlementName(world.seed, v, this.language))}</strong><span>${escapeText(detail)}</span></div></div>`;
    }).join(''));
    const groups = allianceGroups(world.society), wars = world.society.wars.length;
    const roads = world.society.roads.filter(r => roadIsIntact(world, r)).length;
    replace('#relations', `<span>${this.tr('Дорог')} <b>${roads}</b></span><span>${this.tr('Союзов')} <b id="alliance-count">${groups.length}</b></span><span class="${wars ? 'war-count' : ''}">${this.tr('Войн')} <b id="war-count">${wars}</b></span><span>${this.tr('Караванов')} <b id="caravan-count">${[...world.query('caravan')].length}</b></span>`);
    replace('#alliances', groups.map(group => `<div class="alliance-card"><strong style="color:${villageColor(group[0])}">${this.tr('Союз · поселений: {count}', { count: group.length })}</strong><span>${escapeText(nameText(sideName(world.society, group)))}</span></div>`).join(''));
    replace('#campaigns', world.society.wars.map(war => `<div class="campaign-card" data-war="${war.id}"><strong>${this.tr(world.tick < war.musterUntil ? 'Сбор войск' : 'Совместный поход')} · ${this.tr('{a} против {b}', { a: war.attackers.length, b: war.defenders.length })}</strong><span>${escapeText(nameText(sideName(world.society, war.attackers)))}</span><span class="versus">${this.tr('против')}</span><span>${escapeText(nameText(sideName(world.society, war.defenders)))}</span><small>${escapeText(this.tr('Цель: {target} · Потери {a} / {b}', { target: nameText(sideName(world.society, [war.attackTarget])), a: war.lossesAttackers, b: war.lossesDefenders }))}</small></div>`).join(''));
    replace('#chronicle', world.society.history.slice(-5).reverse().map(e => `<li><time>${Math.floor(e.tick / 30 / 60)}:${String(Math.floor(e.tick / 30) % 60).padStart(2, '0')}</time>${escapeText(this.tr(nameText(e.text)))}</li>`).join(''));
  }
  saved(text: string, error = false): void {
    this.savedText = text; this.saveHadError = error;
    const status = this.get('#save-status'); status.hidden = !text; status.textContent = this.tr(text); status.classList.toggle('has-error', error);
  }
  warning(text: string): void { this.warningText = text; const warning = this.get('#save-warning'); warning.hidden = !text; warning.textContent = this.tr(text); }
  toast(message: string): void {
    this.toastText = message;
    const toast = this.get('#toast'); toast.textContent = this.tr(message); toast.hidden = false;
    clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
  }
  get newWorldBiome(): BiomeId | undefined {
    if (!this.debugMode) return;
    const value = this.get<HTMLSelectElement>('#biome-select').value;
    return BIOMES.find(biome => biome.id === value)?.id;
  }
  get newWorldNature(): NaturalBiome | undefined {
    const value = this.get<HTMLSelectElement>('#nature-select').value;
    return NATURAL_BIOMES.find(biome => biome.key === value)?.id;
  }
  private updateWorldPreview(): void {
    const terrain = generateTerrain(this.worldSeed, undefined, undefined, this.newWorldBiome, this.newWorldNature);
    drawWorldPreview(this.get<HTMLCanvasElement>('#world-preview'), terrain);
  }
  private readWorldSeed(): boolean {
    const value = this.seedInput.value.trim(), seed = Number(value);
    const valid = /^\d+$/.test(value) && Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff;
    this.seedInput.setAttribute('aria-invalid', String(!valid));
    this.get('#seed-error').hidden = valid;
    this.get('#world-preview').hidden = !valid;
    this.confirmNew.disabled = !valid;
    if (valid) this.worldSeed = seed;
    return valid;
  }
  private setWorldSeed(seed: number): void {
    this.seedInput.value = String(seed);
    if (this.readWorldSeed()) this.updateWorldPreview();
  }
  private async copyWorldSeed(): Promise<void> {
    const input = this.get<HTMLInputElement>('#current-world-seed'), status = this.get('#seed-copy-status');
    try {
      await navigator.clipboard.writeText(input.value);
      status.textContent = this.tr('Seed copied');
    } catch {
      input.focus(); input.select();
      status.textContent = this.tr('Could not copy. Copy the selected seed manually.');
    }
    status.hidden = false;
  }
  prepareNewWorld(seed: number): void {
    // Escape must never reuse the previous successful confirmation's returnValue.
    this.dialog.returnValue = 'cancel';
    for (const picker of this.dialog.querySelectorAll<HTMLSelectElement>('#nature-select, #biome-select')) {
      picker.selectedIndex = Math.floor(Math.random() * picker.options.length);
    }
    this.setWorldSeed(seed);
  }
}
