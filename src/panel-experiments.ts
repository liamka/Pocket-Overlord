import './panel-experiments.css';
import { catalogGroups as groups, catalogItems as items, type CatalogItem } from './panel-catalog';
import { icon } from './ui';

export const experiments = [
  { id: 'wheel', name: 'World wheel', description: 'Eight categories around a compass. Choose a family, then a tool.' },
  { id: 'cartridges', name: 'Power cartridges', description: 'Pull out one colored cartridge. The rest stay within reach.' },
  { id: 'hand', name: 'Hand of powers', description: 'Categories become a hand of cards. Tools unfold above the selected card.' },
  { id: 'living-atlas', name: 'Living atlas', description: 'The catalog takes over the map. Eight collections form their own little world.' },
] as const;
type Experiment = typeof experiments[number]['id'];
type Group = typeof groups[number];
type Translate = (value: string) => string;
type State = { group: string; anchor: string; family: string; query: string; selected: string; page: number; open: boolean; overview: boolean; favorites: boolean };
const states = new Map<Experiment, State>(experiments.map((item, i) => {
  const group = groups[[1, 5, 4, 1][i]];
  return [item.id, { group: group.id, anchor: group.id, family: item.id === 'cartridges' ? '' : group.names[0], query: '', selected: `${group.id}-0`, page: 0, open: true, overview: item.id === 'living-atlas', favorites: false }];
}));
export const isExperiment = (id: string): id is Experiment => states.has(id as Experiment);
const byId = new Map(items.map(item => [item.id, item]));
const favorites = new Set(['plants-0', 'people-0', 'weather-0', 'destruction-0', 'buildings-0']);
const escape = (value: string): string => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const size = (id: Experiment): number => id === 'hand' ? 9 : id === 'living-atlas' ? 18 : 12;
const name = (item: CatalogItem, tr: Translate): string => `${tr(item.name)} ${item.edition}`;
const groupOf = (state: State): Group => groups.find(group => group.id === state.anchor)!;
function glyph(group: Group): string {
  const paths: Record<string, string> = {
    plants: 'M11 11H7V9H4V4h5v2h3v5h1V7h2V4h6v5h-3v3h-4v8h4v2H6v-2h5z',
    creatures: 'M3 5h4v5H3zm7-3h4v6h-4zm7 3h4v5h-4zM7 12h3v-2h4v2h3v3h2v5h-5v-2h-4v2H5v-5h2z',
    resources: 'M6 3h12v3h3v7h-3v3h-3v3h-2v3h-2v-3H9v-3H6v-3H3V6h3zm1 4v5h3V7zm7 0v5h3V7z',
  };
  return paths[group.id] ? `<svg viewBox="0 0 24 24" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="${paths[group.id]}" /></svg>` : icon(group.symbol);
}
function matches(state: State, tr: Translate): CatalogItem[] {
  const query = state.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(item => (state.group === 'all' || item.group.id === state.group)
    && (!state.family || item.name === state.family)
    && (!state.favorites || favorites.has(item.id))
    && query.every(word => `${name(item, tr)} ${tr(item.group.name)} ${item.name} ${item.group.name}`.toLocaleLowerCase().includes(word)));
}
function search(state: State, tr: Translate): string {
  return `<div class="ex-searchbar"><label class="ex-search"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6" fill="none" stroke="currentColor" stroke-width="2" /></svg><input type="search" placeholder="${escape(tr('Search catalog'))}" aria-label="${escape(tr('Search catalog'))}" value="${escape(state.query)}" autocomplete="off" /><button type="button" data-ex-action="clear" aria-label="${escape(tr('Clear search'))}" ${state.query ? '' : 'hidden'}>×</button></label><button type="button" class="ex-favorites" data-ex-action="favorites" aria-label="${escape(tr('Favorites'))}" title="${escape(tr('Favorites'))}" aria-pressed="${state.favorites}">★</button></div>`;
}
function families(state: State, tr: Translate): string {
  const group = groupOf(state);
  return `<div class="ex-families"><span>${escape(tr(state.group === 'all' ? 'All items' : group.name))}</span><label><span class="ex-sr-only">${escape(tr('Choose a family'))}</span><select data-ex-family aria-label="${escape(tr('Choose a family'))}" ${state.group === 'all' ? 'disabled' : ''}><option value="">${escape(tr('All families'))}</option>${group.names.map(family => `<option value="${family}" ${state.family === family ? 'selected' : ''}>${escape(tr(family))}</option>`).join('')}</select></label></div>`;
}
function itemButton(item: CatalogItem, state: State, tr: Translate): string {
  return `<button type="button" class="ex-item" data-ex-item="${item.id}" aria-pressed="${state.selected === item.id}" aria-label="${escape(name(item, tr))}" title="${escape(name(item, tr))}" style="--item-accent:${item.group.color}"><span class="ex-edition">${item.edition}</span><img src="${item.image}" alt="" width="48" height="48" /><span class="ex-item-name">${escape(tr(item.name))}</span>${favorites.has(item.id) ? '<span class="ex-item-star" aria-hidden="true">★</span>' : ''}</button>`;
}
function collection(id: Experiment, state: State, tr: Translate): string {
  const filtered = matches(state, tr), amount = size(id), pages = Math.max(1, Math.ceil(filtered.length / amount));
  state.page = Math.min(state.page, pages - 1);
  const shown = filtered.slice(state.page * amount, (state.page + 1) * amount);
  return `${families(state, tr)}<div class="ex-items" role="group" aria-label="${escape(tr('Browse tools'))}">${shown.length ? shown.map(item => itemButton(item, state, tr)).join('') : `<div class="ex-empty"><strong>${escape(tr('No items found'))}</strong><button type="button" data-ex-action="reset">${escape(tr('Reset filters'))}</button></div>`}</div><div class="ex-pagination"><span role="status">${filtered.length ? `${state.page * amount + 1}–${state.page * amount + shown.length}` : '0'} / ${filtered.length} ${escape(tr('items'))}</span><div><button type="button" data-ex-page="previous" aria-label="${escape(tr('Previous page'))}" ${state.page === 0 ? 'disabled' : ''}>‹</button><span>${state.page + 1} / ${pages}</span><button type="button" data-ex-page="next" aria-label="${escape(tr('Next page'))}" ${state.page + 1 >= pages ? 'disabled' : ''}>›</button></div></div>`;
}
function selection(state: State, tr: Translate): string {
  const item = byId.get(state.selected)!;
  return `<div class="ex-selection"><img src="${item.image}" alt="" width="48" height="48" /><div><small>${escape(tr('Selected'))} / ${escape(tr(item.group.name))}</small><strong>${escape(name(item, tr))}</strong></div><button type="button" data-ex-action="favorite" aria-label="${escape(tr(favorites.has(item.id) ? 'Remove from favorites' : 'Add to favorites'))}" title="${escape(tr(favorites.has(item.id) ? 'Remove from favorites' : 'Add to favorites'))}" aria-pressed="${favorites.has(item.id)}">${favorites.has(item.id) ? '★' : '☆'}</button></div>`;
}
function wheel(state: State, tr: Translate): string {
  const active = groupOf(state);
  return `<header class="wheel-header"><span>${escape(tr('8 collections'))} <b>432</b></span>${search(state, tr)}</header><div class="wheel-layout"><nav class="world-wheel" aria-label="${escape(tr('Choose a category'))}"><div class="wheel-track" aria-hidden="true"></div><div class="wheel-axis" aria-hidden="true"></div>${groups.map((group, index) => {
    const angle = (index * 45 - 90) * Math.PI / 180;
    return `<button type="button" class="wheel-node" data-ex-group="${group.id}" aria-pressed="${state.group === group.id}" style="--node-x:${50 + Math.cos(angle) * 38}%;--node-y:${50 + Math.sin(angle) * 38}%;--group-accent:${group.color}">${glyph(group)}<span>${escape(tr(group.name))}</span></button>`;
  }).join('')}<button type="button" class="wheel-hub" data-ex-action="toggle" aria-expanded="${state.open}" aria-label="${escape(tr(state.open ? 'Collapse tools' : 'Show tools'))}" style="--group-accent:${active.color}">${glyph(active)}<strong>${escape(tr(state.group === 'all' ? 'All items' : active.name))}</strong><span>${state.group === 'all' ? '432' : '54'} ${escape(tr('items'))}</span></button></nav><div class="wheel-collection" ${state.open ? '' : 'hidden'}><div class="wheel-collection-title"><span>${glyph(active)}</span><div><small>${escape(tr('Catalog'))}</small><h3>${escape(tr(state.group === 'all' ? 'All items' : active.name))}</h3></div><b>${state.group === 'all' ? '432' : '54'}</b></div>${collection('wheel', state, tr)}${selection(state, tr)}</div></div>`;
}
function cartridges(state: State, tr: Translate): string {
  return `<header class="cartridge-header"><div><strong>${escape(tr('Power cartridges'))}</strong><span>${escape(tr('8 collections'))} / 432</span></div>${search(state, tr)}</header><div class="cartridge-bank">${groups.map(group => `<section class="power-cartridge ${state.anchor === group.id && state.open ? 'is-pulled' : ''}" style="--cartridge-color:${group.color}">${state.anchor === group.id && state.open ? `<div class="cartridge-tray">${collection('cartridges', state, tr)}${selection(state, tr)}</div>` : ''}<button type="button" class="cartridge-handle" data-ex-group="${group.id}" aria-expanded="${state.anchor === group.id && state.open}" aria-label="${escape(tr(group.name))}"><span class="cartridge-grip" aria-hidden="true"></span>${glyph(group)}<strong>${escape(tr(group.name))}</strong><span class="cartridge-capacity">54</span></button></section>`).join('')}</div>`;
}
function hand(state: State, tr: Translate): string {
  return `<header class="hand-header"><div><small>${escape(tr('Hand of powers'))}</small><h3>${escape(tr(state.group === 'all' ? 'All items' : groupOf(state).name))}</h3></div>${search(state, tr)}</header><div class="hand-collection" ${state.open ? '' : 'hidden'}>${collection('hand', state, tr)}</div><nav class="power-hand" aria-label="${escape(tr('Choose a category'))}">${groups.map((group, index) => `<button type="button" class="power-card" data-ex-group="${group.id}" aria-pressed="${state.group === group.id}" style="--card-color:${group.color};--card-slot:${index};--card-angle:${(index - 3.5) * 4}deg;--card-drop:${Math.abs(index - 3.5) * 10}px"><span class="card-corner">${glyph(group)}</span><span class="card-symbol">${glyph(group)}</span><strong>${escape(tr(group.name))}</strong><span>54 ${escape(tr('items'))}</span></button>`).join('')}</nav><div class="hand-selection">${selection(state, tr)}</div>`;
}
function atlas(state: State, tr: Translate): string {
  const group = groupOf(state);
  return `<div class="atlas-surface"><svg class="atlas-routes" viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true"><path d="M80 220Q200 80 380 230T800 210T920 410M80 420Q230 290 400 420T800 430M140 220Q260 330 140 420M390 220Q540 330 390 430M640 220Q790 340 640 430" /></svg><header class="living-header"><div class="atlas-heading">${state.overview ? `<span class="atlas-total">432</span><div><h3>${escape(tr('Living atlas'))}</h3><span>${escape(tr('8 collections'))}</span></div>` : `<button type="button" class="atlas-back" data-ex-action="overview" aria-label="${escape(tr('Back to collections'))}">‹</button><div><h3>${escape(tr(state.group === 'all' ? 'All items' : group.name))}</h3><span>${escape(tr('Catalog'))} / 432</span></div>`}</div>${search(state, tr)}</header>${state.overview ? `<div class="atlas-territories">${groups.map((group, index) => `<button type="button" class="atlas-territory" data-ex-group="${group.id}" aria-label="${escape(tr('Open collection'))}: ${escape(tr(group.name))}" style="--land-color:${group.color};--land-wash:${group.color}22;--land-shift:${index % 2 === 0 ? '-9px' : '9px'}"><span class="territory-heading">${glyph(group)}<strong>${escape(tr(group.name))}</strong></span><span class="territory-samples">${items.filter(item => item.group.id === group.id).slice(0, 6).map(item => `<img src="${item.image}" alt="" width="32" height="32" />`).join('')}</span><span class="territory-count"><b>54</b> ${escape(tr('items'))}<span aria-hidden="true">↗</span></span></button>`).join('')}</div><p class="atlas-instruction">${escape(tr('Select a category or search all 432 items.'))}</p>` : `<div class="atlas-open-collection">${collection('living-atlas', state, tr)}${selection(state, tr)}</div>`}</div>`;
}
export function experimentPanel(id: Experiment, tr: Translate): string {
  const state = states.get(id)!;
  return `<div class="experiment" data-experiment="${id}">${id === 'wheel' ? wheel(state, tr) : id === 'cartridges' ? cartridges(state, tr) : id === 'hand' ? hand(state, tr) : atlas(state, tr)}</div>`;
}

export function bindExperiments(root: HTMLElement, tr: Translate): void {
  function refresh(id?: Experiment, focus?: string): void {
    const active = document.activeElement;
    const activeDemo = active?.closest('.experiment');
    for (const demo of root.querySelectorAll<HTMLElement>('.experiment')) {
      const key = demo.dataset.experiment! as Experiment;
      if (id && key !== id) continue;
      const template = document.createElement('template'); template.innerHTML = experimentPanel(key, tr);
      if (demo === activeDemo && active instanceof HTMLInputElement) {
        // Preserve the actual input, caret, and composition state while results change.
        template.content.querySelector('input')!.replaceWith(active);
      }
      demo.replaceChildren(...template.content.firstElementChild!.childNodes);
      if (demo === activeDemo) {
        if (active instanceof HTMLInputElement) active.focus({ preventScroll: true });
        else if (focus) {
          for (const selector of focus.split(', ')) {
            const target = demo.querySelector<HTMLElement>(selector);
            if (target && !target.matches(':disabled')) { target.focus({ preventScroll: true }); break; }
          }
        }
      }
    }
  }
  function reset(state: State): void {
    state.query = ''; state.group = state.anchor; state.family = ''; state.favorites = false; state.page = 0; state.open = true;
  }
  const searchChanged = (event: Event): void => {
    if (event instanceof InputEvent && event.isComposing) return;
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.matches('.ex-search input')) return;
    const id = input.closest<HTMLElement>('.experiment')!.dataset.experiment! as Experiment;
    const state = states.get(id)!;
    state.query = input.value; state.group = state.query ? 'all' : state.anchor; state.family = ''; state.page = 0; state.open = true; state.overview = false;
    refresh(id);
  };
  root.addEventListener('input', searchChanged);
  root.addEventListener('compositionend', searchChanged);
  root.addEventListener('change', event => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement) || !select.hasAttribute('data-ex-family')) return;
    const id = select.closest<HTMLElement>('.experiment')!.dataset.experiment! as Experiment;
    const state = states.get(id)!; state.family = select.value; state.page = 0;
    refresh(id, '[data-ex-family]');
  });
  root.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    const demo = button?.closest<HTMLElement>('.experiment');
    if (!button || !demo) return;
    const id = demo.dataset.experiment! as Experiment, state = states.get(id)!;
    let focus = '', all = false;
    if (button.dataset.exGroup) {
      const group = groups.find(group => group.id === button.dataset.exGroup)!;
      const close = id === 'cartridges' && state.open && state.anchor === group.id && !state.query;
      state.group = group.id; state.anchor = group.id; state.family = id === 'cartridges' || id === 'living-atlas' ? '' : group.names[0];
      state.query = ''; state.page = 0; state.open = !close; state.overview = false; state.favorites = false;
      focus = `[data-ex-group="${group.id}"], [data-ex-family]`;
    } else if (button.dataset.exItem) {
      state.selected = button.dataset.exItem; focus = `[data-ex-item="${state.selected}"]`;
    } else if (button.dataset.exPage) {
      state.page = Math.max(0, state.page + (button.dataset.exPage === 'next' ? 1 : -1));
      focus = `[data-ex-page="${button.dataset.exPage}"]:not(:disabled), .ex-item`;
    } else if (button.dataset.exAction === 'favorite') {
      if (favorites.has(state.selected)) favorites.delete(state.selected); else favorites.add(state.selected);
      all = true; focus = '[data-ex-action="favorite"]';
    } else if (button.dataset.exAction === 'favorites') {
      state.favorites = !state.favorites; state.group = state.favorites ? 'all' : state.anchor;
      state.family = ''; state.page = 0; state.open = true; state.overview = false;
      focus = '[data-ex-action="favorites"]';
    } else if (button.dataset.exAction === 'clear' || button.dataset.exAction === 'reset') {
      reset(state); focus = '.ex-search input';
    } else if (button.dataset.exAction === 'toggle') {
      state.open = !state.open; focus = '[data-ex-action="toggle"]';
    } else if (button.dataset.exAction === 'overview') {
      reset(state); state.overview = true; focus = '.atlas-territory';
    } else return;
    refresh(all ? undefined : id, focus);
  });
  root.addEventListener('keydown', event => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const demo = target.closest('.experiment');
    if (!demo) return;
    const buttons = [...demo.querySelectorAll<HTMLButtonElement>('.ex-item')];
    if (target instanceof HTMLInputElement && event.key === 'ArrowDown' && buttons.length) {
      event.preventDefault(); buttons[0].focus(); return;
    }
    if (!target.matches('.ex-item')) return;
    const index = buttons.indexOf(target as HTMLButtonElement);
    const columns = buttons.filter(button => Math.abs(button.getBoundingClientRect().top - buttons[0].getBoundingClientRect().top) < 2).length;
    const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : event.key === 'ArrowDown' ? index + columns : event.key === 'ArrowUp' ? index - columns : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : undefined;
    if (next !== undefined) { event.preventDefault(); buttons[Math.max(0, Math.min(buttons.length - 1, next))].focus(); }
  });
}
