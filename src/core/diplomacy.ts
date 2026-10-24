import type { Society, War } from './types';

export function alliedGroup(society: Society, villageId: number): number[] {
  const members = new Set([villageId]);
  for (const id of members) for (const relation of society.relations) {
    if (relation.status !== 'alliance') continue;
    if (relation.a === id) members.add(relation.b);
    if (relation.b === id) members.add(relation.a);
  }
  return [...members].sort((a, b) => a - b);
}

export function allianceGroups(society: Society): number[][] {
  const seen = new Set<number>(), groups: number[][] = [];
  for (const village of society.villages) {
    if (seen.has(village.id)) continue;
    const group = alliedGroup(society, village.id);
    for (const id of group) seen.add(id);
    if (group.length > 1) groups.push(group);
  }
  return groups;
}

export const opposingSides = (war: War, a: number, b: number): boolean =>
  war.attackers.includes(a) && war.defenders.includes(b) || war.defenders.includes(a) && war.attackers.includes(b);

export const sideName = (society: Society, ids: number[]): string => ids.map(id => society.villages.find(v => v.id === id)?.name ?? '').filter(Boolean).join(', ');

/** Collapse mutual obligations into cliques, while preserving explicit enemies in old saves. */
export function normalizeLegacyAlliances(society: Society): void {
  const enemies = society.relations.filter(r => r.status === 'war');
  const alliances = society.relations.filter(r => r.status === 'alliance').sort((a, b) => b.affinity - a.affinity || a.a - b.a || a.b - b.b);
  for (const r of alliances) r.status = 'neutral';
  for (const r of alliances) {
    const combined = new Set([...alliedGroup(society, r.a), ...alliedGroup(society, r.b)]);
    if (!enemies.some(e => combined.has(e.a) && combined.has(e.b))) r.status = 'alliance';
  }
  for (const group of allianceGroups(society)) for (const r of society.relations) {
    if (group.includes(r.a) && group.includes(r.b)) r.status = 'alliance';
  }
}
