import type { Entity } from '../core/types';
import type { World } from '../core/world';
import { TRAIT_DEFINITIONS, traitDefinitions } from '../content/traits';
import { hasTrait, traitAvailable, traitCompatible, traitModifiers } from '../core/traits';
import { STAT_RULES, type StatId } from '../core/unit-stats';
import { translate, type Language } from '../i18n';

const escape = (s: string): string => s.replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
export const TRAIT_EFFECTS: Record<string,string> = {
  'bioproduct-gold': 'May leave finite gold ore nearby; offspring can inherit this trait',
  immune:'Blocks infectious diseases', 'strong-minded':'Blocks madness and mental control', immortal:'Prevents death from old age',
  regeneration:'May heal when fully fed and mend individual injuries', 'healing-aura':'May heal nearby friends and cure their plague',
  infected:'Infection damages health and spreads by contact', 'tumor-infection':'Infection may damage health',
  'mush-spores':'May infect nearby creatures on death', plague:'Spreads by contact and damages health', madness:'Attacks others and heals after a kill',
  'death-bomb':'Explodes on death', 'death-nuke':'Causes a large explosion on death', energized:'Discharges energy on death',
  'fire-blood':'Scatters fire on death', 'acid-blood':'Resists acid and scatters acid on death',
  'fire-proof':'Blocks fire damage', 'acid-proof':'Blocks acid damage', 'frost-proof':'Blocks freezing', 'poison-immunity':'Blocks poison',
  thorns:'May reflect part of a nearby hit', 'flesh-eater':'Heals after a damaging hit unless infected',
  unlucky:'May stumble every 20 seconds', tough:'Blocks stunning', 'mark-of-death':'May die at the next pulse',
  'mega-heartbeat':'Periodically pushes and stuns nearby creatures', whirlwind:'Continuously pushes nearby creatures',
  contagious:'Crowds of carriers may cause a plague outbreak', 'burning-feet':'Ignites nearby objects while fighting',
  miner:'May extract extra unreserved ore without creating resources', savage:'Can gather remains of its own species',
  gluttonous:'Attempts to eat two available portions', mute:'Cannot hold conversations', psychopath:'Ignores selected losses affecting happiness',
  bloodlust:'Gains happiness after a confirmed kill', pacifist:'Does not initiate wars', infertile:'Cannot conceive offspring',
  zombie:'May infect a creature on hit', 'scar-of-divinity':'Records a change made by the player', 'metamorphed':'Records a change of form',
  'its-a-boat':'A vessel with restricted personal traits', clone:'Records cloned origin',
  'light-lamp':'Emits a visible glow', shiny:'Emits a visible sparkle', wise:'Shows signs of aging',
  venomous:'May poison a creature on hit', poisonous:'Poisons creatures that eat it', 'bubble-defense':'May gain a shield after a hit',
  hotheaded:'May swear or cry during free time', weightless:'Does not trigger ground traps',
};
export function traitsInspector(world: World, e: Entity, language: Language, open: boolean, editorOpen: boolean): string {
  const s = e.components.traits;
  if (!s) return '';
  const tr = (key:string, values?:Record<string,string|number>):string => escape(translate(key,language,values));
  const label = (id:string):string => tr(`trait:${id}`);
  let html = `<details data-traits${open ? ' open' : ''}><summary>${tr('Personal traits')} · ${s.entries.length}</summary><ul>`;
  for (const t of s.entries) {
    const d = traitDefinitions[t.id], modifier = traitModifiers(e).find(m => m.id === `trait:${t.id}`), effects:string[] = [];
    for (const [mode, values] of [['flat',modifier?.flat],['percent',modifier?.percent]] as const) for (const [key,n] of Object.entries(values ?? {})) {
      effects.push(`${tr(STAT_RULES[key as StatId].label)} ${n > 0 ? '+' : ''}${n}${mode === 'percent' || STAT_RULES[key as StatId].unit === '%' ? '%' : ''}`);
    }
    if (TRAIT_EFFECTS[t.id]) effects.push(tr(TRAIT_EFFECTS[t.id]));
    if (d.sameOpinion || d.oppositeOpinion) effects.push(tr('Opinion of matching traits: {same}; opposite traits: {opposite}',{same:d.sameOpinion,opposite:d.oppositeOpinion}));
    html += `<li><strong>${label(t.id)}</strong> · ${tr(`trait-source:${t.source}`)} · ${tr(d.cure ? 'Until cured' : 'Persistent trait')}`;
    if (t.subject) html += ` · ${escape(t.subject)}`;
    html += `<p>${effects.join(' · ') || tr('Origin marker')}</p>`;
    if (d.pending || Object.keys(d.external).length) html += `<p>${tr('Some effects are not yet available in this world')}</p>`;
    if (d.cure) html += `<button type="button" data-trait-cure="${t.id}">${tr('Cure this trait')}</button>`;
    if (d.scope !== 'special') html += `<button type="button" data-trait-remove="${t.id}">${tr('Remove trait')}</button>`;
    html += '</li>';
  }
  html += '</ul>';
  if (!s.entries.length) html += `<p>${tr('No personal traits')}</p>`;
  if (s.lastTrigger) html += `<p>${tr('Last manifestation')}: ${label(s.lastTrigger.trait)} · ${tr('{seconds}s ago',{seconds:Math.floor((world.tick-s.lastTrigger.at)/30)})}</p>`;
  html += `<details data-trait-editor${editorOpen ? ' open' : ''}><summary>${tr('Edit personal traits')}</summary><p>${tr('Editing leaves a mark of divine intervention')}</p><div class="trait-options">`;
  for (const d of TRAIT_DEFINITIONS.filter(d => d.scope !== 'special' && traitCompatible(e,d) && !hasTrait(e,d.id))) {
    const conflicts = d.conflicts.filter(id => hasTrait(e,id));
    html += `<button type="button" data-trait-add="${d.id}"${traitAvailable(d) ? '' : ' disabled'}>${label(d.id)}`;
    if (conflicts.length) html += ` · ${tr('Replaces')}: ${conflicts.map(label).join(', ')}`;
    if (!traitAvailable(d)) html += ` · ${tr('Unavailable')}`;
    html += '</button>';
  }
  return html+'</div></details></details>';
}
