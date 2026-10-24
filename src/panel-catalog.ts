import './panel-catalog.css';
import { drawSprite, drawToolIcon } from './render/sprites';
import { icon } from './ui';

export const catalogVariants = [
  { id: 'inventory', name: 'Tabbed inventory', description: 'Category tabs, a dense item grid and an inspector beside it.' },
  { id: 'explorer', name: 'Catalog explorer', description: 'A permanent category rail and named items in a tall side window.' },
  { id: 'hotbar', name: 'Library + hotbar', description: 'Pin up to eight tools, then close the library to reveal the world.' },
  { id: 'command', name: 'Search palette', description: 'A search-first list with names, categories and keyboard navigation.' },
  { id: 'atlas', name: 'Item atlas', description: 'A light catalog with readable labels and a compact description strip.' },
  { id: 'shelves', name: 'Category browser', description: 'Start with eight large category tiles, then browse one collection at a time.' },
] as const;
type CatalogId = typeof catalogVariants[number]['id'];
type Translate = (source: string) => string;
const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const groups = [
  { id: 'terrain', name: 'Terrain', symbol: 'mountain', color: '#b6ad7b', names: ['Grass', 'Sand', 'Water', 'Mountain', 'Forest', 'Road'] },
  { id: 'plants', name: 'Plants', symbol: 'cloud', color: '#b0cb7c', names: ['Oak', 'Pine', 'Palm', 'Birch', 'Flower', 'Mushroom'] },
  { id: 'people', name: 'People', symbol: 'person', color: '#e4bc82', names: ['Human', 'Elf', 'Dwarf', 'Orc', 'Settler', 'Warrior'] },
  { id: 'buildings', name: 'Buildings', symbol: 'home', color: '#e2b09b', names: ['House', 'Farm', 'Tower', 'Castle', 'Bridge', 'Windmill'] },
  { id: 'weather', name: 'Weather', symbol: 'cloud', color: '#a0d4e5', names: ['Rain', 'Snow', 'Lightning', 'Wind', 'Cloud', 'Sun'] },
  { id: 'destruction', name: 'Destruction', symbol: 'destruction', color: '#f5a98b', names: ['Dynamite', 'Rocket', 'Meteor', 'Earthquake', 'Volcano', 'Fire'] },
  { id: 'creatures', name: 'Creatures', symbol: 'globe', color: '#c9b6df', names: ['Wolf', 'Bear', 'Dragon', 'Sheep', 'Deer', 'Rabbit'] },
  { id: 'resources', name: 'Resources', symbol: 'home', color: '#dfcf80', names: ['Wood', 'Stone', 'Gold', 'Iron', 'Food', 'Crystal'] },
] as const;
type Group = typeof groups[number];
type Item = { id: string; name: string; edition: string; group: Group; image: string };

// Sample names and numbered variants demonstrate browsing, not new game content.
// Artwork reuses the existing game sprites and category icons.
function artwork(group: Group, index: number): string {
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
  if (group.id === 'people' || group.id === 'weather' || group.id === 'destruction') {
    drawToolIcon(canvas, group.id === 'people' ? 'human' : group.id === 'weather' ? 'rain' : index % 2 ? 'rocket' : 'dynamite');
  } else if (group.id === 'plants' || group.id === 'buildings' || group.id === 'resources') {
    const ctx = canvas.getContext('2d')!; ctx.imageSmoothingEnabled = false;
    ctx.translate(32, 51); ctx.scale(2, 2);
    drawSprite(ctx, group.id === 'plants' ? 'tree' : group.id === 'resources' ? 'crate' : index % 3 === 1 ? 'farm' : 'house', index % 4, 0, false, 0.8);
  } else {
    return `data:image/svg+xml,${encodeURIComponent(icon(group.symbol).replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" color="${group.color}" `))}`;
  }
  return canvas.toDataURL();
}
const items: Item[] = groups.flatMap(group => {
  const images = group.names.map((_, i) => artwork(group, i));
  return Array.from({ length: 54 }, (_, i) => ({ id: `${group.id}-${i}`, name: group.names[i % 6], edition: String(Math.floor(i / 6) + 1).padStart(2, '0'), group, image: images[i % 6] }));
});
const byId = new Map(items.map(item => [item.id, item]));
export { groups as catalogGroups, items as catalogItems };
export type { Item as CatalogItem };
const favorites = new Set(groups.flatMap(group => [`${group.id}-0`, `${group.id}-1`]));
let recent = ['plants-0', 'weather-0', 'destruction-0', 'people-0', 'buildings-0'];
const pins = ['people-0', 'plants-0', 'weather-0', 'destruction-0', 'buildings-0'];
type State = { group: string; query: string; filter: 'all' | 'favorites' | 'recent'; selected: string; page: number; open: boolean; overview: boolean };
const states = new Map<CatalogId, State>(catalogVariants.map(variant => [variant.id, {
  group: variant.id === 'command' || variant.id === 'shelves' ? 'all' : 'plants', query: '', filter: 'all', selected: 'plants-0', page: 0, open: true, overview: variant.id === 'shelves',
}]));
export const isCatalog = (id: string): id is CatalogId => states.has(id as CatalogId);
const pageSize = (id: CatalogId): number => id === 'command' ? 8 : id === 'atlas' ? 12 : 24;
const itemName = (item: Item, tr: Translate): string => `${tr(item.name)} ${item.edition}`;
function results(state: State, tr: Translate): Item[] {
  const words = state.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const source = state.filter === 'recent' ? recent.map(id => byId.get(id)!) : items;
  return source.filter(item => (state.group === 'all' || state.group === item.group.id)
    && (state.filter !== 'favorites' || favorites.has(item.id))
    && words.every(word => `${itemName(item, tr)} ${tr(item.group.name)} ${item.name} ${item.group.name}`.toLocaleLowerCase().includes(word)));
}
function itemButton(item: Item, state: State, tr: Translate, quick = false, slot = 0): string {
  const name = escape(itemName(item, tr));
  return `<button type="button" class="${quick ? 'quick-item' : 'catalog-item'}" data-catalog-item="${item.id}" aria-label="${name}" title="${name}" aria-pressed="${state.selected === item.id}" style="--item-color:${item.group.color}"><img src="${item.image}" alt="" width="40" height="40" /><span class="item-label">${name}</span><span class="item-category">${escape(tr(item.group.name))}</span>${favorites.has(item.id) && !quick ? '<span class="favorite-mark" aria-hidden="true">★</span>' : ''}${quick ? `<kbd>${slot + 1}</kbd>` : ''}</button>`;
}
function groupNav(state: State, tr: Translate): string {
  return `<nav class="catalog-groups" aria-label="${escape(tr('Categories'))}"><button type="button" data-catalog-group="all" aria-pressed="${state.group === 'all'}">${icon('mountain')}<span>${escape(tr('All items'))}</span><small>432</small></button>${groups.map(group => `<button type="button" data-catalog-group="${group.id}" aria-pressed="${state.group === group.id}" style="--group-color:${group.color}">${icon(group.symbol)}<span>${escape(tr(group.name))}</span><small>54</small></button>`).join('')}</nav>`;
}
function inspector(id: CatalogId, state: State, tr: Translate): string {
  const item = byId.get(state.selected)!;
  const pinned = pins.includes(item.id);
  return `<aside class="catalog-inspector"><img src="${item.image}" alt="" width="64" height="64" /><div class="catalog-item-info"><small>${escape(tr(item.group.name))}</small><strong>${escape(itemName(item, tr))}</strong><p>${escape(tr('Demo item'))} <span>${item.edition} / 09</span></p></div><div class="inspector-actions"><button type="button" data-catalog-action="favorite" aria-pressed="${favorites.has(item.id)}"><span aria-hidden="true">${favorites.has(item.id) ? '★' : '☆'}</span> ${escape(tr(favorites.has(item.id) ? 'Remove from favorites' : 'Add to favorites'))}</button>${id === 'hotbar' ? `<button type="button" data-catalog-action="pin" ${!pinned && pins.length === 8 ? 'disabled' : ''}>${escape(tr(pinned ? 'Unpin from hotbar' : pins.length === 8 ? 'Hotbar full' : 'Pin to hotbar'))}</button>` : ''}</div></aside>`;
}
export function catalogPanel(id: CatalogId, tr: Translate): string {
  const state = states.get(id)!;
  const filtered = results(state, tr), size = pageSize(id), pages = Math.max(1, Math.ceil(filtered.length / size));
  state.page = Math.min(state.page, pages - 1);
  const shown = filtered.slice(state.page * size, (state.page + 1) * size);
  const overview = id === 'shelves' && state.overview && !state.query && state.filter === 'all';
  const search = `<label class="catalog-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="${escape(tr('Search catalog'))}" placeholder="${escape(tr('Search catalog'))}" value="${escape(state.query)}" autocomplete="off" spellcheck="false" /><button type="button" data-catalog-action="clear" aria-label="${escape(tr('Clear search'))}" ${state.query ? '' : 'hidden'}>×</button></label>`;
  const filters = `<div class="catalog-filters" role="group" aria-label="${escape(tr('Catalog'))}">${(['all', 'favorites', 'recent'] as const).map(filter => `<button type="button" data-catalog-filter="${filter}" aria-pressed="${state.filter === filter}">${escape(tr(filter === 'all' ? 'All items' : filter === 'favorites' ? 'Favorites' : 'Recent'))}</button>`).join('')}</div>`;
  const tiles = `<div class="category-tiles">${groups.map(group => `<button type="button" data-catalog-group="${group.id}" style="--group-color:${group.color}">${icon(group.symbol)}<strong>${escape(tr(group.name))}</strong><span>54 ${escape(tr('items'))}</span></button>`).join('')}</div>`;
  const grid = `<div class="catalog-grid" role="group" aria-label="${escape(tr('Catalog'))}">${shown.map(item => itemButton(item, state, tr)).join('')}</div>`;
  const empty = `<div class="catalog-empty"><strong>${escape(tr('No items found'))}</strong><button type="button" data-catalog-action="reset">${escape(tr('Reset filters'))}</button></div>`;
  const window = `<div class="catalog-window" ${id === 'hotbar' && !state.open ? 'hidden' : ''}>
    <header class="catalog-title"><strong>${escape(tr('Catalog'))} <span>432</span></strong><span class="catalog-demo-label">${escape(tr('Demo item'))}</span>${id === 'hotbar' ? `<button type="button" data-catalog-action="toggle" aria-label="${escape(tr('Close catalog'))}">×</button>` : ''}</header>
    ${groupNav(state, tr)}<div class="catalog-toolbar">${search}${filters}</div>
    <div class="catalog-content"><div class="catalog-breadcrumb">${id === 'shelves' ? `<button type="button" data-catalog-action="categories">${escape(tr('Categories'))}</button><span aria-hidden="true">/</span>` : ''}<strong>${escape(tr(overview || state.group === 'all' ? 'All items' : groups.find(group => group.id === state.group)!.name))}</strong><span class="catalog-count" role="status">${overview ? 432 : filtered.length} ${escape(tr('items'))}</span></div>${overview ? tiles : shown.length ? grid : empty}</div>
    ${inspector(id, state, tr)}
    <footer class="catalog-pagination"><span>${overview ? '8 / 8' : filtered.length ? `${state.page * size + 1}–${state.page * size + shown.length} / ${filtered.length}` : '0 / 0'}</span><div ${overview ? 'hidden' : ''}><button type="button" data-catalog-page="previous" aria-label="${escape(tr('Previous page'))}" ${state.page === 0 ? 'disabled' : ''}>‹</button><span>${state.page + 1} / ${pages}</span><button type="button" data-catalog-page="next" aria-label="${escape(tr('Next page'))}" ${state.page + 1 >= pages ? 'disabled' : ''}>›</button></div></footer>
  </div>`;
  const bar = id === 'hotbar' ? `<div class="catalog-hotbar"><button type="button" class="catalog-launcher" data-catalog-action="toggle" aria-expanded="${state.open}">${icon('mountain')}<span>${escape(tr(state.open ? 'Close catalog' : 'Open catalog'))}</span></button><div class="quick-items" role="group" aria-label="${escape(tr('Quick access'))}">${pins.map((item, i) => itemButton(byId.get(item)!, state, tr, true, i)).join('')}${Array.from({ length: 8 - pins.length }, (_, i) => `<span class="quick-empty" aria-hidden="true">${pins.length + i + 1}</span>`).join('')}</div></div>` : '';
  return `<div class="catalog-demo" data-catalog="${id}">${window}${bar}</div>`;
}

export function bindCatalog(root: HTMLElement, tr: Translate): void {
  function refresh(id?: CatalogId, focus?: string): void {
    const active = document.activeElement;
    const search = active instanceof HTMLInputElement && active.matches('.catalog-search input') ? active : undefined;
    const position = search?.selectionStart;
    const activeDemo = active?.closest<HTMLElement>('.catalog-demo');
    for (const demo of root.querySelectorAll<HTMLElement>('.catalog-demo')) {
      const key = demo.dataset.catalog! as CatalogId;
      if (id && key !== id) continue;
      const holder = document.createElement('div'); holder.innerHTML = catalogPanel(key, tr);
      demo.replaceChildren(...holder.firstElementChild!.childNodes);
      if (demo === activeDemo) {
        if (search) {
          const input = demo.querySelector<HTMLInputElement>('input')!; input.focus({ preventScroll: true });
          // Search inputs do not expose setSelectionRange in every browser.
          if (position !== null && position !== undefined) try { input.setSelectionRange(position, position); } catch { /* Browser places the caret at the end. */ }
        } else if (focus) {
          for (const selector of focus.split(', ')) {
            const control = demo.querySelector<HTMLElement>(selector);
            if (control) { control.focus({ preventScroll: true }); break; }
          }
        }
      }
    }
  }
  const updateSearch = (event: Event): void => {
    if (event instanceof InputEvent && event.isComposing) return;
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.matches('.catalog-search input')) return;
    const id = input.closest<HTMLElement>('.catalog-demo')!.dataset.catalog! as CatalogId;
    const state = states.get(id)!;
    state.query = input.value; state.group = 'all'; state.page = 0; state.overview = false;
    refresh(id);
  };
  root.addEventListener('input', updateSearch);
  root.addEventListener('compositionend', updateSearch);
  root.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    const demo = button?.closest<HTMLElement>('.catalog-demo');
    if (!button || !demo) return;
    const id = demo.dataset.catalog! as CatalogId, state = states.get(id)!;
    let focus = '';
    let refreshAll = false;
    if (button.dataset.catalogItem) {
      state.selected = button.dataset.catalogItem;
      recent = [state.selected, ...recent.filter(item => item !== state.selected)].slice(0, 24);
      refreshAll = true;
      focus = `[data-catalog-item="${state.selected}"]`;
    } else if (button.dataset.catalogGroup) {
      state.group = button.dataset.catalogGroup; state.page = 0; state.query = ''; state.overview = false;
      focus = `[data-catalog-group="${state.group}"]`;
    } else if (button.dataset.catalogFilter) {
      state.filter = button.dataset.catalogFilter as State['filter']; state.group = 'all'; state.page = 0; state.overview = false;
      focus = `[data-catalog-filter="${state.filter}"]`;
    } else if (button.dataset.catalogPage) {
      state.page += button.dataset.catalogPage === 'next' ? 1 : -1;
      focus = `[data-catalog-page="${button.dataset.catalogPage}"]:not(:disabled), .catalog-grid button`;
    } else if (button.dataset.catalogAction === 'favorite') {
      if (favorites.has(state.selected)) favorites.delete(state.selected); else favorites.add(state.selected);
      refresh(undefined, '[data-catalog-action="favorite"]'); return;
    } else if (button.dataset.catalogAction === 'pin') {
      const index = pins.indexOf(state.selected);
      if (index >= 0) pins.splice(index, 1); else if (pins.length < 8) pins.push(state.selected);
      focus = '[data-catalog-action="pin"]:not(:disabled), .catalog-launcher';
    } else if (button.dataset.catalogAction === 'toggle') {
      state.open = !state.open; focus = state.open ? '.catalog-search input' : '.catalog-launcher';
    } else if (button.dataset.catalogAction === 'categories') {
      state.overview = true; state.query = ''; state.group = 'all'; state.filter = 'all'; state.page = 0;
      focus = '[data-catalog-action="categories"]';
    } else if (button.dataset.catalogAction === 'clear' || button.dataset.catalogAction === 'reset') {
      state.query = ''; state.group = 'all'; state.filter = 'all'; state.page = 0; state.overview = false;
      focus = '.catalog-search input';
    } else return;
    refresh(refreshAll ? undefined : id, focus);
  });
  root.addEventListener('keydown', event => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const demo = target.closest<HTMLElement>('.catalog-demo');
    if (!demo) return;
    if (demo.dataset.catalog === 'hotbar' && !(target instanceof HTMLInputElement) && /^[1-8]$/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const item = pins[Number(event.key) - 1];
      if (item) {
        event.preventDefault(); states.get('hotbar')!.selected = item;
        recent = [item, ...recent.filter(previous => previous !== item)].slice(0, 24);
        refresh(undefined, `.quick-items [data-catalog-item="${item}"]`);
      }
      return;
    }
    const buttons = [...demo.querySelectorAll<HTMLButtonElement>('.catalog-grid .catalog-item')];
    if (target instanceof HTMLInputElement && event.key === 'ArrowDown' && buttons.length) {
      event.preventDefault(); buttons[0].focus(); return;
    }
    if (!target.matches('.catalog-item')) return;
    const index = buttons.indexOf(target as HTMLButtonElement);
    const row = buttons.filter(button => Math.abs(button.getBoundingClientRect().top - buttons[0].getBoundingClientRect().top) < 2).length;
    const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : event.key === 'ArrowDown' ? index + row : event.key === 'ArrowUp' ? index - row : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : undefined;
    if (next === undefined) return;
    event.preventDefault(); buttons[Math.max(0, Math.min(buttons.length - 1, next))]?.focus();
  });
}
