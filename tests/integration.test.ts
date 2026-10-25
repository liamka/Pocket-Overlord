import { describe, expect, it } from 'vitest';
import { World } from '../src/core/world';
import { SAVE_VERSION, Terrain, type Entity } from '../src/core/types';
import { decodeSave } from '../src/persistence/schema';
import { assignSocializing, beginIntegration, continueSocializing, integration } from '../src/systems/integration';
import { migrations } from '../src/systems/migration';
import { agriculture } from '../src/systems/society';
import { governmentOf } from '../src/core/village-life';
import { declareWar } from '../src/systems/diplomacy';
import { advance, diplomaticWorld, migrationWorld, pioneerWorld } from './helpers';

function place(world: World, entity: Entity, x: number, y: number): void {
  Object.assign(entity.components.position!, { x, y }); world.spatial.update(entity);
}

function arrivals(withLocal = true) {
  const world = migrationWorld(), family = [...world.query('person')], village = world.society.villages[1];
  const home = [...world.query('dwelling')][1];
  const local = withLocal ? world.spawn('core:person', { x: 33, y: 24 })! : undefined;
  if (local) {
    Object.assign(local.components.person!, { homeId: home.id, age: 24, reproduceIn: 100000, buildIn: 100000 });
    local.components.citizen!.villageId = village.id;
  }
  world.tick = 300; migrations(world);
  const group = world.society.migrations[0];
  for (const [i, e] of family.entries()) { place(world, e, 34 + i * 2, 22); e.components.citizen!.hunger = 15; }
  world.tick = 330; migrations(world);
  return { world, family, local, village, home, group };
}

describe('newcomer integration', () => {
  it('starts only after arrival in an existing village and keeps family identity and reserved housing', () => {
    const { world, family, group, home } = arrivals();
    expect(world.society.migrations).toHaveLength(0);
    for (const person of family) {
      expect(person.components.person!.homeId).toBe(home.id);
      expect(person.components.citizen!.integration).toMatchObject({ status: 'settling', groupId: group.id, arrived: 330, worked: false, friendId: null });
    }
    expect(family[2].components.citizen!.parents).toEqual(family.slice(0, 2).map(e => e.id));
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
    const colony = pioneerWorld(); colony.tick = 150; migrations(colony); advance(colony, 55);
    expect([...colony.query('citizen')].every(e => !e.components.citizen!.integration)).toBe(true);
  });

  it('finds work and local friends through normal simulation, then stays in the village', () => {
    const { world, family, village } = arrivals();
    advance(world, 100);
    expect(family.some(e => e.components.citizen!.integration?.worked)).toBe(true);
    expect(family.some(e => (e.components.citizen!.integration?.friendId ?? null) !== null)).toBe(true);
    expect(family.some(e => e.components.citizen!.integration?.status === 'settled')).toBe(true);
    expect(family.every(e => e.components.citizen!.villageId === village.id && e.components.citizen!.task !== 'migrate')).toBe(true);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });

  it('earns a friendship only through sustained nearby meetings with a welcoming resident', () => {
    const { world, family, local } = arrivals(), newcomer = family[0], state = newcomer.components.citizen!.integration!;
    world.tick = 420; expect(assignSocializing(world, newcomer)).toBe(true);
    place(world, newcomer, 22, 22);
    for (let i = 0; i < 6; i++) { world.tick += 30; integration(world); }
    expect(state.friendId).toBeNull();
    place(world, newcomer, 34, 24);
    for (let i = 0; i < 5; i++) { world.tick += 30; integration(world); }
    expect(state.friendId).toBeNull();
    world.tick += 30; state.socialUntil = world.tick + 30; integration(world);
    expect(state.friendId).toBe(local!.id);
    expect(world.society.history.filter(e => e.text.includes('befriended'))).toHaveLength(1);
  });

  it('counts a real harvest as work, but not walking toward a job', () => {
    const { world, family, village } = arrivals(false), worker = family[0], state = worker.components.citizen!.integration!;
    const field = world.spawn('core:farm', { x: 42, y: 30 })!;
    Object.assign(field.components.farm!, { villageId: village.id, growth: 0.99 });
    Object.assign(worker.components.citizen!, { task: 'farm', targetId: field.id });
    agriculture(world); integration(world); expect(state.worked).toBe(false);
    place(world, worker, 41, 30); agriculture(world);
    expect(field.components.farm!.harvests).toBe(1); expect(state.worked).toBe(true);
  });

  it('keeps children free of a work requirement when they find a home and a friend', () => {
    const { world, family, local } = arrivals(), child = family[2], state = child.components.citizen!.integration!;
    state.friendId = local!.id; state.belonging = 70;
    world.tick = state.arrived + 900; integration(world);
    expect(state.status).toBe('settled'); expect(state.worked).toBe(false);
  });

  it('isolates unsupported arrivals and lets them gather without inventing local friendships', () => {
    const { world, family, village } = arrivals();
    village.food = 0; governmentOf(village).trust = 10;
    for (let i = 0; i < 60; i++) { world.tick += 30; integration(world); }
    expect(family.every(e => e.components.citizen!.integration!.status === 'isolated')).toBe(true);
    expect(assignSocializing(world, family[0])).toBe(true);
    const target = world.entities.get(family[0].components.citizen!.targetId!)!;
    expect(family).toContain(target);
    for (let i = 0; i < 8; i++) { world.tick += 30; integration(world); }
    expect(family[0].components.citizen!.integration!.friendId).toBeNull();
  });

  it('moves a rejected family together to available housing even while the village migration timer is cooling down', () => {
    const { world, family, village } = arrivals(), source = world.society.villages[0];
    source.food = 100;
    for (const e of family) Object.assign(e.components.citizen!.integration!, { status: 'isolated', leaveAfter: 330 });
    world.tick = 450; migrations(world);
    const group = world.society.migrations[0];
    expect(group.fromId).toBe(village.id); expect(group.toId).toBe(source.id);
    expect(group.members).toEqual(family.map(e => e.id));
    expect(family.every(e => !e.components.citizen!.integration && e.components.citizen!.task === 'migrate')).toBe(true);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });

  it('lets an isolated newcomer try local friendships again and settle when work becomes available', () => {
    const { world, family, local, village } = arrivals(), newcomer = family[0], state = newcomer.components.citizen!.integration!;
    Object.assign(state, { status: 'isolated', belonging: 45 });
    world.tick = state.arrived + 2400; place(world, newcomer, 34, 24);
    expect(assignSocializing(world, newcomer)).toBe(true);
    expect(newcomer.components.citizen!.targetId).toBe(local!.id);
    for (let i = 0; i < 6; i++) { world.tick += 30; integration(world); }
    expect(state.friendId).toBe(local!.id); expect(state.status).toBe('isolated');
    const field = world.spawn('core:farm', { x: 42, y: 30 })!;
    Object.assign(field.components.farm!, { villageId: village.id, growth: 0.99 });
    Object.assign(newcomer.components.citizen!, { task: 'farm', targetId: field.id, path: [] });
    place(world, newcomer, 41, 30); agriculture(world); integration(world);
    expect(state.status).toBe('settled');
  });

  it('keeps isolated families housed when the destination is full or unreachable', () => {
    for (const reason of ['full', 'water'] as const) {
      const { world, family, home } = arrivals(), destination = [...world.query('dwelling')][0];
      world.society.villages[0].food = 100;
      for (const e of family) Object.assign(e.components.citizen!.integration!, { status: 'isolated', leaveAfter: 330 });
      if (reason === 'full') destination.components.dwelling!.capacity = 2;
      else for (let y = 0; y < 48; y++) world.terrain.set(23, y, Terrain.Water);
      world.tick = 450; migrations(world);
      expect(world.society.migrations).toHaveLength(0);
      expect(family.every(e => e.components.person!.homeId === home.id)).toBe(true);
      expect(family[0].components.citizen!.integration!.leaveAfter).toBeGreaterThan(world.tick);
    }
  });

  it('interrupts meetings for hunger and danger, and clears references when a friend dies', () => {
    const { world, family, local } = arrivals(), newcomer = family[0], c = newcomer.components.citizen!;
    world.tick = 420; assignSocializing(world, newcomer);
    c.hunger = 60;
    expect(continueSocializing(world, newcomer)).toBe(false); expect(c.task).toBe('idle');
    continueSocializing(world, local!); c.hunger = 10; world.tick = c.integration!.socialAfter;
    expect(assignSocializing(world, newcomer)).toBe(true);
    local!.components.thermal!.burning = true;
    expect(continueSocializing(world, newcomer)).toBe(false);
    c.integration!.friendId = local!.id; c.integration!.contactId = local!.id;
    world.remove(local!.id);
    expect(c.integration!.friendId).toBeNull(); expect(c.integration!.contactId).toBeNull();
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });

  it('ends meetings when war starts so social visits cannot override defense orders', () => {
    const world = diplomaticWorld(2), newcomer = [...world.query('citizen')][0];
    beginIntegration(world, newcomer, { id: world.society.nextMigrationId++, fromId: 2, toId: 1,
      destination: { x: 10, y: 10 }, members: [newcomer.id], homeIds: [], food: 0, started: 0 });
    world.tick = 90;
    expect(assignSocializing(world, newcomer)).toBe(true);
    expect(declareWar(world, 1, 2)).toBeDefined();
    expect(continueSocializing(world, newcomer)).toBe(false);
    expect(newcomer.components.citizen!.task).toBe('idle');
  });

  it('restores meetings and adaptation deterministically, preserves old worlds and rejects corrupt state', () => {
    const { world, family } = arrivals(); world.tick = 420; assignSocializing(world, family[0]);
    const saved = decodeSave(world.snapshot(), world.registry), restored = new World(saved.seed, world.registry, saved);
    world.paused = true; const paused = world.snapshot(); advance(world, 1); expect(world.snapshot()).toEqual(paused); world.paused = false;
    advance(world, 15); advance(restored, 15); expect(restored.snapshot()).toEqual(world.snapshot());
    const old = migrationWorld().snapshot(); old.version = 30;
    expect(decodeSave(old, world.registry)).toEqual({ ...old, version: SAVE_VERSION });
    for (const mutate of [
      (e: Entity) => { e.components.citizen!.integration!.friendId = 99999; },
      (e: Entity) => { e.components.citizen!.integration!.friendId = e.id; },
      (e: Entity) => { e.components.citizen!.integration!.belonging = 101; },
      (e: Entity) => { e.components.citizen!.integration!.villageId = 1; },
      (e: Entity) => { e.components.citizen!.integration!.arrived = world.tick + 30; },
      (e: Entity) => { e.components.citizen!.integration!.groupId = world.society.nextMigrationId; },
    ]) {
      const bad = world.snapshot(); mutate(bad.entities.find(e => e.id === family[0].id)!);
      expect(() => decodeSave(bad, world.registry)).toThrow();
    }
  });
});
