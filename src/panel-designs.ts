import './panel-designs.css';
import { panelCopy } from './panel-designs-copy';
import { catalogCopy } from './panel-catalog-copy';
import { experimentCopy } from './panel-experiments-copy';
import { bindExperiments, experimentPanel, experiments, isExperiment } from './panel-experiments';
import { bindCatalog, catalogPanel, catalogVariants, isCatalog } from './panel-catalog';
import { createRegistry } from './content/defaults';
import { generateTerrain } from './core/terrain';
import { noise } from './core/random';
import { Terrain } from './core/types';
import { drawSprite, drawToolIcon } from './render/sprites';
import { icon } from './ui';
import { isLanguage, languages, loadLanguage, saveLanguage, translate } from './i18n';
import { version } from '../package.json';

const column = { ru: 0, 'zh-CN': 1, ja: 2, es: 3 } as const;
const copy = { ...panelCopy, ...catalogCopy, ...experimentCopy };
let language = loadLanguage();
const tr = (source: string): string => language !== 'en' && Object.hasOwn(copy, source)
  ? copy[source as keyof typeof copy][column[language]] : translate(source, language);
const escape = (value: string): string => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const text = (source: string): string => escape(tr(source));

const variants = [
  { id: 'classic', name: 'Compact classic', description: 'The familiar olive frame, with tools in one row and less empty space.' },
  { id: 'floating', name: 'Floating dock', description: 'A small blue dock. The selected tool gets its own floating caption.' },
  { id: 'guide', name: 'Field guide', description: 'A light panel with named tools and a dedicated space for instructions.' },
  { id: 'side', name: 'Side palette', description: 'A toolbox in the corner, leaving the bottom of the world open.' },
  { id: 'split', name: 'Split controls', description: 'Tools on the left, details on the right. The world shows through between them.' },
  { id: 'rail', name: 'Slim rail', description: 'Everything in a single strip. Open the hint when you need more detail.' },
] as const;
const categories = [
  { id: 'all', name: 'All', symbol: 'mountain' },
  { id: 'people', name: 'People', symbol: 'person' },
  { id: 'nature', name: 'Nature', symbol: 'cloud' },
  { id: 'destruction', name: 'Destruction', symbol: 'destruction' },
] as const;
const registry = createRegistry();
const tools = [...registry.tools.values()];
let selected = registry.tools.get('core:dynamite')!;
let category = 'all';
let narrow = false;
let zoom = 100;
const root = document.querySelector<HTMLDivElement>('#designs')!;
let expanded: HTMLDialogElement;
let expandedTrigger: HTMLButtonElement | undefined;

const tabs = (): string => `<nav class="design-tabs" aria-label="${text('Tool categories')}">${categories.map(item => `<button type="button" data-category="${item.id}" aria-pressed="${category === item.id}" title="${text(item.name)}" aria-label="${text(item.name)}">${icon(item.symbol)}<span>${text(item.name)}</span></button>`).join('')}</nav>`;
const dock = (): string => `<div class="design-tools" role="group" aria-label="${text('World tools')}">${tools.map(tool => `<button type="button" class="design-tool" data-tool="${tool.id}" aria-label="${text(tool.label)}" title="${text(tool.label)}" aria-pressed="${selected.id === tool.id}" ${category !== 'all' && category !== tool.category ? 'hidden' : ''}><canvas width="64" height="64" aria-hidden="true"></canvas><span>${text(tool.label)}</span></button>`).join('')}</div>`;
const caption = (): string => `<div class="design-caption" aria-live="polite"><canvas class="selected-icon" width="64" height="64" aria-hidden="true"></canvas><div><strong class="selected-name">${text(selected.label)}</strong><p class="selected-hint">${text(selected.hint)}</p></div></div>`;
const camera = (): string => `<div class="design-camera"><button type="button" data-zoom="out" aria-label="${text('Zoom out')}">−</button><button type="button" data-zoom="reset" aria-label="${text('Reset zoom')}" title="${text('Reset zoom')}">${icon('fit')}<span class="zoom-value">${zoom}%</span></button><button type="button" data-zoom="in" aria-label="${text('Zoom in')}">+</button></div>`;
function panel(id: string): string {
  if (id === 'rail') return `<div class="design-panel">${tabs()}${dock()}<details class="rail-detail"><summary aria-label="${text('Show hint')}"><span class="selected-name">${text(selected.label)}</span><span aria-hidden="true">⌃</span></summary>${caption()}</details>${camera()}</div>`;
  return `<div class="design-panel">${tabs()}${dock()}${caption()}${camera()}</div>`;
}
function scene(id: string): string {
  return `<div class="scene ${isExperiment(id) ? 'experiment-scene' : isCatalog(id) ? 'catalog-scene' : ''}" data-variant="${id}"><canvas class="landscape" width="1280" height="768" aria-hidden="true"></canvas>${isExperiment(id) ? experimentPanel(id, tr) : isCatalog(id) ? catalogPanel(id, tr) : panel(id)}<small class="preview-version" translate="no">ver ${escape(version)}</small></div>`;
}
const exploration = (item: { id: string; name: string; description: string }): string => `<section class="exploration" id="${item.id}" aria-labelledby="${item.id}-title"><header class="exploration-heading"><div><h2 id="${item.id}-title">${text(item.name)}</h2><p>${text(item.description)}</p></div><button type="button" class="expand-button" data-expand="${item.id}" aria-label="${text('Expand')}: ${text(item.name)}">${icon('fit')}<span>${text('Expand')}</span></button></header><div class="preview-mat">${scene(item.id)}</div></section>`;

// A shared still landscape uses existing terrain and sprites, without saved worlds.
const landscape = document.createElement('canvas');
landscape.width = 1280; landscape.height = 768;
const painter = landscape.getContext('2d')!;
const terrain = generateTerrain(172, 160, 96, 'turtle');
const palette = ['#3274aa', '#559cce', '#dfd69d', '#809e55', '#625d4a', '#6a695a', '#baa071', '#60705b'];
for (let y = 0; y < terrain.height; y++) for (let x = 0; x < terrain.width; x++) {
  const tile = terrain.at(x, y), n = noise(x, y, 172);
  painter.fillStyle = palette[tile]; painter.fillRect(x * 8, y * 8, 8, 8);
  if (tile === Terrain.Grass && n > 0.7) {
    painter.fillStyle = '#a2b46b'; painter.fillRect(x * 8 + 2, y * 8 + 4, 2, 1);
  }
  if (tile === Terrain.DeepWater && n > 0.96) {
    painter.fillStyle = '#4084b4'; painter.fillRect(x * 8, y * 8 + 3, 6, 1);
  }
}
for (let y = 2; y < terrain.height - 2; y += 2) for (let x = 2; x < terrain.width - 2; x += 2) {
  if (terrain.at(x, y) !== Terrain.Grass || noise(x, y, 19) < 0.58) continue;
  painter.save(); painter.translate(x * 8, y * 8); drawSprite(painter, 'tree', Math.floor(noise(x, y, 7) * 4)); painter.restore();
}

function paint(container: ParentNode): void {
  for (const canvas of container.querySelectorAll<HTMLCanvasElement>('.landscape')) canvas.getContext('2d')!.drawImage(landscape, 0, 0);
  for (const button of container.querySelectorAll<HTMLButtonElement>('[data-tool]')) drawToolIcon(button.querySelector('canvas')!, registry.tools.get(button.dataset.tool!)!.icon);
  for (const canvas of container.querySelectorAll<HTMLCanvasElement>('.selected-icon')) drawToolIcon(canvas, selected.icon);
}
function updatePanels(): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-category]')) button.setAttribute('aria-pressed', String(button.dataset.category === category));
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
    const tool = registry.tools.get(button.dataset.tool!)!;
    button.hidden = category !== 'all' && tool.category !== category;
    button.setAttribute('aria-pressed', String(tool.id === selected.id));
  }
  for (const name of root.querySelectorAll('.selected-name')) name.textContent = tr(selected.label);
  for (const hint of root.querySelectorAll('.selected-hint')) hint.textContent = tr(selected.hint);
  for (const canvas of root.querySelectorAll<HTMLCanvasElement>('.selected-icon')) drawToolIcon(canvas, selected.icon);
  for (const value of root.querySelectorAll('.zoom-value')) value.textContent = `${zoom}%`;
  for (const canvas of root.querySelectorAll<HTMLCanvasElement>('.landscape')) canvas.style.transform = `scale(${zoom / 100})`;
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-zoom="out"]')) button.disabled = zoom <= 100;
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-zoom="in"]')) button.disabled = zoom >= 175;
}
function render(): void {
  document.documentElement.lang = language;
  document.title = `${tr('Panel designs')} | Pocket World`;
  root.innerHTML = `
    <header class="masthead wrap"><a class="brand" href="./"><img src="./favicon.svg" width="28" height="28" alt="" />Pocket World</a><div class="header-actions"><select id="gallery-language" aria-label="${text('Язык')}">${languages.map(item => `<option value="${item.id}" ${language === item.id ? 'selected' : ''}>${item.name}</option>`).join('')}</select><a class="back-link" href="./">${text('Back to the game')}</a></div></header>
    <main class="wrap"><div class="intro"><div class="intro-title"><h1>${text('Panel designs')}</h1><p>${text('Four new ways to reach 432 items.')}</p></div><p class="intro-help">${text('Choose a category. Open a collection. Try a power.')}</p></div>
    <div class="gallery-controls"><span>${text('Preview only. Your game stays as it is.')}</span><div class="width-picker" role="group" aria-label="${text('Preview width')}"><button type="button" data-width="wide" aria-pressed="${!narrow}">${text('Wide')}</button><button type="button" data-width="narrow" aria-pressed="${narrow}">${text('Narrow')}</button></div></div>
    <nav class="gallery-sections"><a href="#new-directions">${text('New directions')}</a><a href="#previous-explorations">${text('Previous explorations')}</a></nav>
    <div class="gallery-section-heading" id="new-directions"><h2>${text('New directions')}</h2><p>${text('Demo catalog: 432 sample items in 8 categories.')}</p></div>
    <div class="gallery experiment-gallery ${narrow ? 'is-narrow' : ''}">${experiments.map(exploration).join('')}</div>
    <details class="previous-directions" id="previous-explorations"><summary>${text('Previous explorations')}</summary>
    <div class="gallery-section-heading" id="large-catalog"><h2>${text('For 400+ items')}</h2><p>${text('Demo catalog: 432 sample items in 8 categories.')}</p></div>
    <div class="gallery ${narrow ? 'is-narrow' : ''}">${catalogVariants.map(exploration).join('')}</div>
    <div class="gallery-section-heading" id="original-panels"><h2>${text('Original six')}</h2></div>
    <div class="gallery ${narrow ? 'is-narrow' : ''}">${variants.map(exploration).join('')}</div>
    </details>
    <footer class="gallery-footer"><a href="./">${text('Back to the game')}</a><span>Pocket World <span translate="no">/ ${escape(version)}</span></span></footer></main>
    <dialog class="expanded-preview" aria-labelledby="expanded-title"><header><h2 id="expanded-title"></h2><button type="button" class="close-preview" aria-label="${text('Close preview')}">×</button></header><div class="expanded-content"></div></dialog>`;
  expanded = root.querySelector<HTMLDialogElement>('.expanded-preview')!;
  expanded.addEventListener('close', () => {
    expanded.querySelector('.expanded-content')!.replaceChildren();
    expandedTrigger?.focus({ preventScroll: true });
  });
  expanded.addEventListener('click', event => { if (event.target === expanded) expanded.close(); });
  paint(root); updatePanels();
  root.querySelector<HTMLSelectElement>('#gallery-language')!.addEventListener('change', event => {
    const value = (event.target as HTMLSelectElement).value;
    if (!isLanguage(value)) return;
    language = value; saveLanguage(language); render();
    root.querySelector<HTMLSelectElement>('#gallery-language')!.focus();
  });
}
root.addEventListener('click', event => {
  const button = (event.target as Element).closest<HTMLButtonElement>('button');
  if (!button) return;
  if (button.dataset.tool) {
    selected = registry.tools.get(button.dataset.tool)!; updatePanels();
  } else if (button.dataset.category) {
    category = button.dataset.category;
    if (category !== 'all' && selected.category !== category) selected = tools.find(tool => tool.category === category)!;
    updatePanels();
  } else if (button.dataset.width) {
    narrow = button.dataset.width === 'narrow';
    for (const gallery of root.querySelectorAll('.gallery')) gallery.classList.toggle('is-narrow', narrow);
    for (const control of root.querySelectorAll<HTMLElement>('[data-width]')) control.setAttribute('aria-pressed', String(control.dataset.width === (narrow ? 'narrow' : 'wide')));
  } else if (button.dataset.expand) {
    const variant = [...experiments, ...catalogVariants, ...variants].find(item => item.id === button.dataset.expand)!;
    expanded.querySelector('#expanded-title')!.textContent = tr(variant.name);
    expanded.querySelector('.expanded-content')!.innerHTML = scene(variant.id);
    expandedTrigger = button; paint(expanded); updatePanels(); expanded.showModal();
  } else if (button.classList.contains('close-preview')) {
    expanded.close();
  } else if (button.dataset.zoom) {
    zoom = button.dataset.zoom === 'reset' ? 100 : Math.max(100, Math.min(175, zoom + (button.dataset.zoom === 'in' ? 25 : -25)));
    updatePanels();
  }
});
bindCatalog(root, tr);
bindExperiments(root, tr);
render();
