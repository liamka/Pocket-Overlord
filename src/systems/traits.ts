import { applyStatus, hasStatus } from '../core/status-effects';
import type { Entity } from '../core/types';
import type { World } from '../core/world';
import { traitDefinitions } from '../content/traits';
import { acquireTraits, adoptAfflictions, growTraits, hasTrait, recordTraitTrigger, removeTrait, traitEvent, traitBlocks } from '../core/traits';
import { hungerPercent } from '../core/unit-stats';
import { unitName } from '../core/units';
import type { DeathRecord } from '../core/death';
import { atWar } from './society';
import { infect } from './afflictions';
import { recordHappiness } from '../core/happiness';
import { Terrain } from '../core/types';
import { produceGold } from '../content/gold';

const alive = (world: World, e: Entity): boolean => world.entities.get(e.id) === e && (e.components.health?.current ?? 0) > 0;
const heal = (e: Entity, amount: number): void => { const h = e.components.health; if (h && h.current > 0) h.current = Math.min(h.max,h.current+amount); };
/** Same close-contact geometry as infection; a wall of mountains separates auras. */
function neighbours(world: World, e: Entity, radius: number): Entity[] {
  const p = e.components.position;
  if (!p) return [];
  return world.nearby(p,radius).filter(other => {
    if (!alive(world,other) || !other.components.unit) return false;
    const q = other.components.position!, steps = Math.max(1,Math.ceil(Math.hypot(p.x-q.x,p.y-q.y)*2));
    for (let i=1;i<=steps;i++) if (world.terrain.at(p.x+(q.x-p.x)*i/steps,p.y+(q.y-p.y)*i/steps) === Terrain.Mountain) return false;
    return true;
  }).sort((a,b) => a.id-b.id);
}
function friendly(world: World, a: Entity, b: Entity): boolean {
  if (a === b) return true;
  if (a.components.person?.madness || b.components.person?.madness) return false;
  const av = a.components.citizen?.villageId ?? a.components.animal?.villageId, bv = b.components.citizen?.villageId ?? b.components.animal?.villageId;
  return av != null && bv != null ? !atWar(world,av,bv) : a.typeId === b.typeId;
}
export function traitsSystem(world: World): void {
  if (world.paused) return;
  let impulses = 0;
  for (const e of [...world.query('traits','health')].sort((a,b) => a.id-b.id)) {
    if (!alive(world,e)) continue;
    adoptAfflictions(e,world.tick); growTraits(world,e);
    const s = e.components.traits!, birthday = Math.floor(e.components.person?.age ?? e.components.animal?.age ?? 0);
    if (birthday > s.lastBirthday) {
      s.lastBirthday = birthday;
      if (e.components.person && birthday > 40 && !hasTrait(e,'wise') && world.rng.next() < 0.3) acquireTraits(world,e,['wise'],'event');
      if (birthday > 300 && hasTrait(e,'immortal') && !hasTrait(e,'evil') && world.rng.next() < 0.5) acquireTraits(world,e,['evil'],'event');
    }
    for (const t of [...s.entries]) {
      if (t.nextAt === undefined || t.nextAt > world.tick || traitDefinitions[t.id].pending) continue;
      // Commit deadline/receipt before publishing any effect. Saved pending events cannot fire twice.
      if (t.id === 'whirlwind' && impulses >= 128) continue;
      t.nextAt = world.tick + traitDefinitions[t.id].interval!;
      recordTraitTrigger(e,t.id,world.tick);
      const h = e.components.health!, p = e.components.position;
      if (t.id === 'bioproduct-gold') produceGold(world, e);
      else if (t.id === 'regeneration' && !hasTrait(e,'infected')) {
        if (hungerPercent(e) <= 0 && world.rng.next() < 0.2) heal(e,h.max*0.02);
        for (const id of ['crippled','skin-burns','one-eyed']) if (hasTrait(e,id) && world.rng.next() < 0.05) removeTrait(world,e,id,'cure');
      } else if (t.id === 'healing-aura' && world.rng.next() < 0.2) {
        for (const other of neighbours(world,e,4)) if (friendly(world,e,other)) { heal(other,10); removeTrait(world,other,'plague','cure'); }
      } else if (t.id === 'infected') {
        world.events.push({kind:'damage',target:e.id,amount:Math.max(10,h.max*0.1),cause:'zombie'});
        for (const other of neighbours(world,e,2.4).filter(o => o.id !== e.id).slice(0,8)) {
          if (!traitBlocks(other,'infected') && !hasTrait(other,'infected') && world.rng.next() < 0.1) acquireTraits(world,other,['infected'],'event',unitName(e));
        }
      } else if (t.id === 'tumor-infection' && world.rng.next() < 0.1) world.events.push({kind:'damage',target:e.id,amount:h.max*0.1,cause:'tumor'});
      else if (t.id === 'mark-of-death' && world.rng.next() < 0.2) world.events.push({kind:'damage',target:e.id,amount:1e6,cause:'divine'});
      else if (t.id === 'contagious') {
        const nearby = neighbours(world,e,4);
        if (nearby.filter(o => o.id !== e.id && hasTrait(o,'contagious')).length >= 19 && world.rng.next() < 0.45) {
          for (const other of nearby) if (!hasTrait(other,'contagious')) { infect(other); adoptAfflictions(other,world.tick); }
        }
      } else if (t.id === 'unlucky' && !traitBlocks(e,'stun') && world.rng.next() < 0.2) {
        const c = e.components.combat ??= {baseHealth:e.components.stats?.base.health ?? h.max,immunities:[],statuses:{}};
        c.statuses.stun = Math.max(c.statuses.stun ?? 0,5);
      } else if ((t.id === 'whirlwind' || t.id === 'mega-heartbeat') && p) {
        for (const other of neighbours(world,e,3).filter(o => o.id !== e.id).slice(0,Math.min(16,128-impulses))) {
          const q = other.components.position!, d = Math.hypot(q.x-p.x,q.y-p.y) || 1;
          world.events.push({kind:'impulse',target:other.id,x:(q.x-p.x)/d*2,y:(q.y-p.y)/d*2}); impulses++;
          if (t.id === 'mega-heartbeat' && !traitBlocks(other,'stun')) {
            const c = other.components.combat ??= {baseHealth:other.components.stats?.base.health ?? other.components.health!.max,immunities:[],statuses:{}};
            c.statuses.stun = Math.max(c.statuses.stun ?? 0,4.5);
          }
        }
      } else if (t.id === 'hotheaded' && e.components.citizen?.task === 'idle' && !hasTrait(e,'mute') && world.rng.next() < 0.2) {
        applyStatus(world,e,world.rng.next() < 0.5 ? 'swearing' : 'crying',{seconds:3});
      } else if (t.id === 'burning-feet' && p && (e.components.citizen?.task === 'fight' || hasStatus(e,'crying') || hasStatus(e,'swearing'))) {
        for (const other of world.nearby(p,0.8).sort((a,b) => a.id-b.id).slice(0,8)) if (other.id !== e.id) world.events.push({kind:'heat',target:other.id,amount:80,sourceId:e.id,cause:'fire'});
      }
    }
    // Trait/status mutations reconcile their affected units at the mutation site.
    // Unchanged traits must not repeat the full stat scan after unitStatsSystem.
  }
}
/** One confirmed damaging hit. Reflections publish ordinary damage, never another hit callback. */
export function traitHit(world: World, source: Entity | undefined, target: Entity, damage: number): void {
  if (damage <= 0 || world.paused) return;
  if (source && alive(world,source)) {
    if (hasTrait(source,'flesh-eater') && !hasTrait(source,'infected')) heal(source,source.components.health!.max*0.05);
    if (hasTrait(source,'venomous') && alive(world,target) && world.rng.next() < 0.3) applyStatus(world,target,'poisoned',{source});
    if (hasTrait(source,'zombie') && alive(world,target) && !traitBlocks(target,'infected') && world.rng.next() < 0.5) acquireTraits(world,target,['infected'],'event',unitName(source));
    if (hasTrait(target,'thorns') && source.id !== target.id && source.components.position && target.components.position
      && Math.hypot(source.components.position.x-target.components.position.x,source.components.position.y-target.components.position.y) < 2 && world.rng.next() < 0.5) {
      world.events.push({kind:'damage',target:source.id,amount:Math.min(1e6,damage*0.2),cause:'conflict',sourceId:target.id,sourceName:unitName(target)});
    }
  }
  if (alive(world,target) && hasTrait(target,'bubble-defense') && world.rng.next() < 0.1) applyStatus(world,target,'shield',{seconds:5,source:target});
  if (alive(world,target) && target.components.traits && !hasStatus(target,'shield')) for (const id of ['one-eyed','crippled']) {
    if (!hasTrait(target,id) && world.rng.next() < 0.02) acquireTraits(world,target,[id],'event',source ? unitName(source) : undefined);
  }
}
/** World.die's synchronous guard and removal own the once-only death receipt. */
export function traitDeath(world: World, dead: Entity, killer: Entity | undefined, death: DeathRecord): void {
  if (killer && alive(world,killer) && !death.player && death.initiator?.id === killer.id && killer.id !== dead.id) {
    if (hasTrait(dead,'poisonous') && death.cause === 'eaten') applyStatus(world,killer,'poisoned',{source:dead});
    const s = killer.components.traits;
    if (s) {
      s.kills = Math.min(1e9,s.kills+1);
      // A Chosen One is a personal trait, not proof that the victim held a mage role.
      const ids = [s.kills >= 11 ? 'veteran' : '',dead.components.dragon ? 'dragonslayer' : ''].filter(Boolean);
      traitEvent(world,killer,s.nextEventId,ids,death.name);
      if (hasTrait(killer,'madness')) heal(killer,killer.components.health!.max*0.05);
      if (hasTrait(killer,'bloodlust')) recordHappiness(world,killer,'bloodlust-kill',dead);
    }
  }
  const p = dead.components.position;
  if (!p) return;
  for (const id of ['death-bomb','death-nuke','energized','fire-blood','acid-blood','mush-spores']) {
    if (!hasTrait(dead,id)) continue;
    recordTraitTrigger(dead,id,world.tick);
    const context = {sourceId:dead.id,sourceName:unitName(dead)};
    if (id === 'death-bomb' || id === 'death-nuke') world.events.push({kind:'blast',...p,...context,radius:id === 'death-nuke' ? 12 : 4,power:id === 'death-nuke' ? 300 : 65,heat:80,cause:'explosion'});
    else if (id === 'energized') {
      for (const other of neighbours(world,dead,2).filter(o => o.id !== dead.id).slice(0,16)) world.events.push({kind:'damage',target:other.id,amount:25,cause:'fire',...context});
      world.visual({kind:'blast',...p,radius:2});
    } else if (id === 'mush-spores') {
      // Plan 27's pinned contract says 30%; the newer indexed page says 70%.
      for (const other of neighbours(world,dead,3).filter(o => o.id !== dead.id).slice(0,16)) if (!traitBlocks(other,id) && world.rng.next() < 0.3) acquireTraits(world,other,[id],'event',unitName(dead));
    } else {
      const count = Math.floor(world.rng.next()*(dead.components.dragon ? 31 : 6)), targets = world.nearby(p,3).filter(o => o.id !== dead.id && alive(world,o)).sort((a,b) => a.id-b.id);
      for (let i=0;i<count && targets.length;i++) {
        const other = targets[Math.floor(world.rng.next()*targets.length)];
        if (id === 'fire-blood') world.events.push({kind:'heat',target:other.id,amount:60,cause:'fire',...context});
        else world.events.push({kind:'damage',target:other.id,amount:5,cause:'acid',...context});
      }
    }
  }
}
