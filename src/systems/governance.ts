import type { World } from '../core/world';
import { governmentOf, residentName } from '../core/village-life';
import type { War } from '../core/types';

export function governance(world: World): void {
  if (world.tick % 30 !== 0) return;
  for (const village of world.society.villages) {
    const people = [...world.query('person', 'citizen')].filter(e => e.components.citizen!.villageId === village.id && e.components.citizen!.task !== 'migrate');
    const adults = people.filter(e => e.components.person!.age >= 18);
    if (!adults.length && !village.government) continue;
    const g = governmentOf(village), previous = g.leaderId;
    if (!adults.some(e => e.id === g.leaderId)) g.leaderId = null;
    const hungry = people.filter(e => e.components.citizen!.hunger >= 75).length / Math.max(1, people.length);
    const harvest = Math.max(0, village.harvested - g.lastHarvest); g.lastHarvest = village.harvested;
    if (g.leaderId !== null) g.trust = Math.max(0, Math.min(100, g.trust + Math.min(3, harvest * 0.15)
      + (village.food >= people.length * 2 && hungry === 0 ? 0.15 : 0) - hungry * 1.8 - (village.food < people.length * 0.3 ? 0.35 : 0)));
    const dismissed = g.leaderId !== null && g.trust < 30 && world.tick - g.electedAt >= 450 && adults.length > 1;
    if (adults.length && (g.leaderId === null || world.tick >= g.electionAt || dismissed)) {
      const candidates = adults.filter(e => !dismissed || e.id !== g.leaderId);
      candidates.sort((a, b) => {
        const score = (e: typeof a): number => (e.components.citizen!.service ?? 0) + Math.min(60, e.components.person!.age) * 0.05
          + (e.id === g.leaderId ? (g.trust - 50) * 0.2 : 0);
        return score(b) - score(a) || a.id - b.id;
      });
      const chosen = candidates[0];
      if (dismissed) {
        const old = world.entities.get(g.leaderId!);
        if (old?.components.citizen) old.components.citizen.service = (old.components.citizen.service ?? 0) * 0.5;
        world.announce(`${village.name}: residents replaced their elder after losing trust`);
      }
      g.leaderId = chosen.id; g.electedAt = world.tick; g.electionAt = world.tick + 1800; g.elections++;
      if (previous !== chosen.id) g.trust = 60;
      world.announce(`${village.name}: ${residentName(chosen.id)} was elected elder`);
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
