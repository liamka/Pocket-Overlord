import { unitStats } from '../core/unit-stats';
import { MONTH_TICKS } from '../core/calendar';
import { startRulingExperience } from '../core/unit-levels';
import { recordHappiness } from '../core/happiness';
import type { World } from '../core/world';
import { canGovern } from '../core/capabilities';
import { governmentOf, residentName } from '../core/village-life';
import type { Entity, Village, War } from '../core/types';

function elect(world: World, village: Village, candidates: Entity[]): void {
  if (!candidates.length) return;
  const g = governmentOf(village), previous = g.leaderId;
  candidates.sort((a, b) => {
    const score = (e: Entity): number => (e.components.citizen!.service ?? 0) + Math.min(60, e.components.person!.age) * 0.05
      + (unitStats(world, e).values.diplomacy + unitStats(world, e).values.stewardship) * 0.1
      + (e.id === g.leaderId ? (g.trust - 50) * 0.2 : 0);
    return score(b) - score(a) || a.id - b.id;
  });
  const chosen = candidates[0];
  // Coalesce overdue elections into one action, then save a full three-month term.
  // Even a large time gap never replays past elections or their rewards.
  g.leaderId = chosen.id; g.electedAt = world.tick; g.electionAt = world.tick + 3 * MONTH_TICKS; g.elections++;
  if (previous !== chosen.id) {
    const former = world.entities.get(previous ?? -1)?.components.stats?.experience;
    if (former) delete former.ruling;
    startRulingExperience(world, chosen, village);
    g.trust = 60; recordHappiness(world, chosen, 'leader');
  }
  world.announce(`${village.name}: ${residentName(chosen.id, world)} was elected elder`);
}

export function electSuccessor(world: World, village: Village): void {
  if (!village.government || village.government.leaderId !== null) return;
  elect(world, village, [...world.query('person', 'citizen', 'health')].filter(e => e.components.citizen!.villageId === village.id
    && e.components.citizen!.task !== 'migrate' && e.components.health!.current > 0 && canGovern(world.registry, e)));
}

export function governance(world: World): void {
  if (world.paused || world.tick % 30 !== 0) return;
  for (const village of world.society.villages) {
    const people = [...world.query('person', 'citizen')].filter(e => e.components.citizen!.villageId === village.id && e.components.citizen!.task !== 'migrate');
    const adults = people.filter(e => canGovern(world.registry, e));
    if (!adults.length && !village.government) continue;
    const g = governmentOf(village);
    if (!adults.some(e => e.id === g.leaderId)) g.leaderId = null;
    const hungry = people.filter(e => e.components.citizen!.hunger >= 75).length / Math.max(1, people.length);
    const harvest = Math.max(0, village.harvested - g.lastHarvest); g.lastHarvest = village.harvested;
    if (g.leaderId !== null) g.trust = Math.max(0, Math.min(100, g.trust + Math.min(3, harvest * 0.15)
      + (village.food >= people.length * 2 && hungry === 0 ? 0.15 : 0) - hungry * 1.8 - (village.food < people.length * 0.3 ? 0.35 : 0)));
    const dismissed = g.leaderId !== null && g.trust < 30 && world.tick - g.electedAt >= 450 && adults.length > 1;
    if (adults.length && (g.leaderId === null || world.tick >= g.electionAt || dismissed)) {
      const candidates = adults.filter(e => !dismissed || e.id !== g.leaderId);
      if (dismissed) {
        const old = world.entities.get(g.leaderId!);
        if (old?.components.citizen) old.components.citizen.service = (old.components.citizen.service ?? 0) * 0.5;
        world.announce(`${village.name}: residents replaced their elder after losing trust`);
      }
      elect(world, village, candidates);
    }
  }
}

/** A side that lost more of its army than its opponent is held responsible at home. */
export function recordWarOutcome(world: World, war: War): void {
  const a = war.lossesAttackers / Math.max(1, war.initialAttackers), b = war.lossesDefenders / Math.max(1, war.initialDefenders);
  if (a === b) return;
  const defeated = a > b ? war.attackers : war.defenders;
  for (const village of world.society.villages) if (defeated.includes(village.id) && village.government?.leaderId != null) {
    village.government.trust = Math.max(0, village.government.trust - 18);
    world.announce(`${village.name}: war losses weakened trust in the elder`);
  }
}
