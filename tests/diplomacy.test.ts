import { describe, expect, it } from 'vitest';
import { alliedGroup, allianceGroups } from '../src/core/diplomacy';
import { World } from '../src/core/world';
import { decodeSave } from '../src/persistence/schema';
import { atWar, campaignObjective, campaigns, declareWar, diplomacy, endWar, formAlliance, leaveAlliance } from '../src/systems/diplomacy';
import { intentions } from '../src/systems/people';
import { advance, diplomaticWorld } from './helpers';

describe('alliances and coalition wars', () => {
  it('waits twenty seconds between decisions and two minutes after a truce, including after reload', () => {
    const world = diplomaticWorld(2), relation = world.society.relations[0];
    world.society.villages[1].x = 70;
    for (const village of world.society.villages) village.food = 0;
    relation.affinity = 0; relation.nextDecision = 0;
    diplomacy(world);
    expect(world.society.wars).toHaveLength(0);
    world.tick = 300; diplomacy(world);
    expect(world.society.wars).toHaveLength(0);
    const saved = decodeSave(world.snapshot(), world.registry);
    const restored = new World(saved.seed, world.registry, saved);
    restored.paused = true; advance(restored, 30);
    expect(restored.tick).toBe(300);
    restored.paused = false; restored.tick = 600; diplomacy(restored);
    expect(restored.society.wars).toHaveLength(1);
    endWar(restored, restored.society.wars[0], 'Test truce');
    restored.society.relations[0].affinity = -60;
    restored.tick = 2400; diplomacy(restored);
    expect(restored.society.wars).toHaveLength(0);
    restored.tick = 4170; diplomacy(restored);
    expect(restored.society.wars).toHaveLength(0);
    restored.tick = 4200; diplomacy(restored);
    expect(restored.society.wars).toHaveLength(1);
  });

  it('forms a three-village alliance from improving relations and keeps every member friendly', () => {
    const world = diplomaticWorld(5);
    const ab = world.society.relations.find(r => r.a === 1 && r.b === 2)!;
    const bc = world.society.relations.find(r => r.a === 2 && r.b === 3)!;
    ab.affinity = bc.affinity = 40; ab.nextDecision = bc.nextDecision = 0;
    diplomacy(world);
    expect(alliedGroup(world.society, 1)).toEqual([1, 2, 3]);
    expect(allianceGroups(world.society)).toEqual([[1, 2, 3]]);
    for (const a of [1, 2, 3]) for (const b of [1, 2, 3]) expect(atWar(world, a, b)).toBe(false);
    expect(declareWar(world, 1, 3)).toBeUndefined();
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });
  it('an attack recruits all allies on both sides and gives them shared gathering and battle objectives', () => {
    const world = diplomaticWorld(5);
    formAlliance(world, 1, 2); formAlliance(world, 2, 3); formAlliance(world, 4, 5);
    const war = declareWar(world, 1, 4)!;
    expect(war.attackers).toEqual([1, 2, 3]); expect(war.defenders).toEqual([4, 5]);
    for (const a of war.attackers) for (const b of war.defenders) expect(atWar(world, a, b)).toBe(true);
    for (const id of war.attackers) expect(campaignObjective(world, id)).toBe(war.rallyVillage);
    intentions(world);
    const fighters = [...world.query('citizen')].filter(e => war.attackers.includes(e.components.citizen!.villageId!) && e.id % 3 !== 0);
    expect(fighters.every(e => e.components.citizen!.task === 'fight')).toBe(true);
    for (const fighter of fighters) {
      const target = world.entities.get(fighter.components.citizen!.targetId!)!;
      expect(target.components.dwelling!.villageId).toBe(war.rallyVillage);
    }
    world.tick = war.musterUntil; campaigns(world);
    for (const id of [...war.attackers, ...war.defenders]) expect(campaignObjective(world, id)).toBe(war.attackTarget);
    expect(formAlliance(world, 2, 5)).toBe(false);
    expect(leaveAlliance(world, 1)).toBe(false);
  });
  it('three independent alliances join one coalition against another alliance', () => {
    const world = diplomaticWorld();
    for (const [a, b] of [[1, 2], [3, 4], [5, 6], [7, 8]]) formAlliance(world, a, b);
    const war = declareWar(world, 1, 7)!;
    expect(declareWar(world, 3, 7)?.id).toBe(war.id);
    expect(declareWar(world, 5, 8)?.id).toBe(war.id);
    expect(world.society.wars).toHaveLength(1);
    expect(war.attackers).toEqual([1, 2, 3, 4, 5, 6]); expect(war.defenders).toEqual([7, 8]);
    expect(allianceGroups(world.society)).toHaveLength(4);
    expect(war.initialAttackers).toBe(24); expect(war.initialDefenders).toBe(8);
    for (const id of war.attackers) expect(atWar(world, id, 7)).toBe(true);
    expect(atWar(world, 1, 5)).toBe(false);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });
  it('autonomous diplomatic decisions recruit three alliances against their common enemy', () => {
    const world = diplomaticWorld();
    for (const [a, b] of [[1, 2], [3, 4], [5, 6], [7, 8]]) formAlliance(world, a, b);
    for (const a of [1, 3, 5]) {
      const r = world.society.relations.find(r => r.a === a && r.b === 7)!;
      r.affinity = -60; r.nextDecision = 0;
    }
    diplomacy(world);
    expect(world.society.wars).toHaveLength(1);
    expect(world.society.wars[0].attackers).toEqual([1, 2, 3, 4, 5, 6]);
    expect(world.society.wars[0].defenders).toEqual([7, 8]);
    expect(allianceGroups(world.society)).toHaveLength(4);
  });
  it('allies send food to a starving village while retaining their own reserve', () => {
    const world = diplomaticWorld(2); formAlliance(world, 1, 2);
    world.society.villages[0].food = 30; world.society.villages[1].food = 0;
    world.tick = 300; diplomacy(world);
    expect(world.society.villages.map(v => v.food)).toEqual([30, 0]);
    expect([...world.query('caravan')]).toHaveLength(0);
    world.tick = 600; diplomacy(world);
    expect(world.society.villages.map(v => v.food)).toEqual([22, 0]);
    expect([...world.query('caravan')].map(e => e.components.caravan!.food)).toEqual([8]);
    expect(alliedGroup(world.society, 1)).toEqual([1, 2]);
    expect(world.society.history.at(-1)?.text).toContain('отправляет еду');
  });
  it('one friendly village cannot force its allies into a treaty with their rival', () => {
    const world = diplomaticWorld(3); formAlliance(world, 1, 2);
    world.society.relations.find(r => r.a === 1 && r.b === 3)!.affinity = 60;
    world.society.relations.find(r => r.a === 2 && r.b === 3)!.affinity = -5;
    expect(formAlliance(world, 1, 3)).toBe(false);
    expect(alliedGroup(world.society, 1)).toEqual([1, 2]);
    expect(alliedGroup(world.society, 3)).toEqual([3]);
  });
  it('develops distinct alliances and real conflict from initially neutral settlements', () => {
    const world = diplomaticWorld();
    for (const r of world.society.relations) r.nextDecision = 0;
    advance(world, 120);
    expect(allianceGroups(world.society).length).toBeGreaterThan(1);
    expect(allianceGroups(world.society).some(group => group.length >= 3)).toBe(true);
    expect(world.society.wars).toHaveLength(1);
    const war = world.society.wars[0];
    expect(war.attackers.length).toBeGreaterThan(1); expect(war.defenders.length).toBeGreaterThan(1);
    expect(war.lossesAttackers + war.lossesDefenders).toBeGreaterThan(0);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });
  it('keeps long coalition announcements compatible with the save format', () => {
    const world = diplomaticWorld();
    for (const village of world.society.villages) village.name = `${village.id}${'а'.repeat(79)}`;
    for (const id of [2, 3, 4, 5, 6]) formAlliance(world, 1, id);
    formAlliance(world, 7, 8); declareWar(world, 1, 7);
    expect(world.society.history.every(event => event.text.length <= 300)).toBe(true);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });
  it('joining an alliance during war sends reinforcements without putting a village on both sides', () => {
    const world = diplomaticWorld(5);
    formAlliance(world, 1, 2); formAlliance(world, 4, 5);
    const war = declareWar(world, 1, 4)!;
    expect(formAlliance(world, 2, 3)).toBe(true);
    expect(war.attackers).toEqual([1, 2, 3]); expect(war.initialAttackers).toBe(12);
    expect(atWar(world, 3, 5)).toBe(true);
    expect(formAlliance(world, 3, 5)).toBe(false);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });
  it('moves soldiers from each allied village and causes real battle losses', () => {
    const world = diplomaticWorld(5); formAlliance(world, 1, 2); formAlliance(world, 2, 3); formAlliance(world, 4, 5);
    const war = declareWar(world, 1, 4)!;
    const soldiers = [...world.query('citizen')].filter(e => war.attackers.includes(e.components.citizen!.villageId!) && e.id % 3 !== 0);
    const positions = new Map(soldiers.map(e => [e.id, { ...e.components.position! }]));
    advance(world, 15);
    for (const id of war.attackers) expect(soldiers.filter(e => e.components.citizen!.villageId === id).some(e => {
      const old = positions.get(e.id)!, p = e.components.position!; return Math.hypot(p.x - old.x, p.y - old.y) > 3;
    })).toBe(true);
    advance(world, 45);
    expect(war.lossesAttackers + war.lossesDefenders).toBeGreaterThan(0);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });
  it('large losses produce a common truce and clear every village’s battle orders', () => {
    const world = diplomaticWorld(5); formAlliance(world, 1, 2); formAlliance(world, 2, 3); formAlliance(world, 4, 5);
    const war = declareWar(world, 1, 4)!; intentions(world);
    const victims = [...world.query('citizen')].filter(e => war.attackers.includes(e.components.citizen!.villageId!)).slice(0, 6);
    for (const e of victims) world.remove(e.id);
    expect(war.lossesAttackers).toBe(6); campaigns(world);
    expect(world.society.wars).toHaveLength(0);
    expect([...world.query('citizen')].every(e => e.components.citizen!.task !== 'fight')).toBe(true);
    for (const a of war.attackers) for (const b of war.defenders) {
      expect(atWar(world, a, b)).toBe(false);
      expect(world.society.relations.find(r => r.a === a && r.b === b)!.nextDecision).toBe(world.tick + 3600);
    }
    expect(alliedGroup(world.society, 1)).toEqual([1, 2, 3]);
    expect(leaveAlliance(world, 3)).toBe(true); expect(alliedGroup(world.society, 1)).toEqual([1, 2]);
  });
  it('shortages end the entire campaign instead of leaving allies fighting alone', () => {
    const world = diplomaticWorld(5); formAlliance(world, 1, 2); formAlliance(world, 2, 3); formAlliance(world, 4, 5);
    const war = declareWar(world, 1, 4)!;
    for (const v of world.society.villages) v.food = 0;
    world.tick = war.started + 900; campaigns(world);
    expect(world.society.wars).toHaveLength(0);
    expect(world.society.relations.some(r => r.status === 'war')).toBe(false);
  });
  it('preserves coalition membership, objectives and losses across deterministic save/reload', () => {
    const world = diplomaticWorld();
    for (const [a, b] of [[1, 2], [3, 4], [5, 6], [7, 8]]) formAlliance(world, a, b);
    declareWar(world, 1, 7); declareWar(world, 3, 7); declareWar(world, 5, 7); advance(world, 10);
    const snapshot = decodeSave(JSON.parse(JSON.stringify(world.snapshot())), world.registry);
    const restored = new World(snapshot.seed, world.registry, snapshot);
    advance(world, 35); advance(restored, 35);
    expect(restored.snapshot()).toEqual(world.snapshot());
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });
  it('does not turn a disconnected island into an attack route', () => {
    const world = diplomaticWorld(5); world.society.roads = [];
    formAlliance(world, 1, 2); formAlliance(world, 4, 5);
    expect(declareWar(world, 1, 4)).toBeUndefined();
    expect(world.society.wars).toHaveLength(0);
  });
  it('handles destroyed coalition villages and ends an empty side safely', () => {
    const world = diplomaticWorld(5); formAlliance(world, 1, 2); formAlliance(world, 4, 5);
    const war = declareWar(world, 1, 4)!;
    for (const e of [...world.entities.values()]) if ([4, 5].includes(e.components.citizen?.villageId ?? e.components.dwelling?.villageId ?? -1)) world.remove(e.id);
    advance(world, 1);
    expect(world.society.wars).toHaveLength(0);
    expect(world.society.villages.every(v => ![4, 5].includes(v.id))).toBe(true);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
    const history = [...world.society.history];
    endWar(world, war, 'Проверка повторного завершения');
    expect(world.society.wars).toHaveLength(0);
    expect(world.society.history).toEqual(history);
  });
});
