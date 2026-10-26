import { describe, expect, it } from 'vitest';
import { flatWorld, setFood, villageWorld } from './helpers';
import { World } from '../src/core/world';
import { befriend, inspectUnit, renameUnit, unitName } from '../src/core/units';
import { residentName } from '../src/core/village-life';
import { decodeSave } from '../src/persistence/schema';
import { beginIntegration, integration } from '../src/systems/integration';
import { translate } from '../src/i18n';

describe('unit inspection and identity', () => {
  it('inspects ships through their capabilities, without a citizen, age or birth date', () => {
    const world = flatWorld(), ship = world.spawn('core:ship', { x: 5, y: 5 })!;
    const view = inspectUnit(world, ship.id)!;
    expect(view.occupation).toBe('Fishing vessel');
    expect(view.age).toBeUndefined();
    expect(view.identity.bornAt).toBeNull();
    expect(view.equipment).toBe(false);
    expect(ship.components.citizen).toBeUndefined();
  });

  it('keeps Unicode personal names through localization and loading, with a 30-character limit', () => {
    const world = flatWorld(), person = world.spawn('core:person', { x: 6, y: 6 })!;
    const rng = world.rng.state;
    expect(renameUnit(world, person.id, 'Я'.repeat(30))).toBe(true);
    expect(renameUnit(world, person.id, 'Я'.repeat(31))).toBe(false);
    expect(renameUnit(world, person.id, 'first\nsecond')).toBe(false);
    expect(renameUnit(world, person.id, ' Астра <&> ')).toBe(true);
    expect(translate('Species', 'ru')).toBe('Вид');
    const restored = new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry));
    expect(unitName(restored.entities.get(person.id)!)).toBe('Астра <&>');
    expect(residentName(person.id, restored)).toBe('Астра <&>');
    expect(restored.rng.state).toBe(rng);
  });

  it('migrates generated names and dead parents without consuming randomness or inventing dates', () => {
    const world = flatWorld(), parent = world.spawn('core:person', { x: 5, y: 5 })!, child = world.spawn('core:person', { x: 8, y: 5 })!;
    child.components.citizen!.parents = [parent.id];
    const old = world.snapshot(); old.version = 43; delete old.unitHistory;
    old.entities = old.entities.filter(e => e.id !== parent.id);
    for (const entity of old.entities) delete entity.components.unit;
    const a = decodeSave(old, world.registry), b = decodeSave(old, world.registry);
    expect(a).toEqual(b); expect(a.rngState).toBe(old.rngState);
    expect(a.entities[0].components.unit!.displayName).toBe(residentName(child.id));
    expect(a.unitHistory![0]).toMatchObject({ id: parent.id, endedAt: null, identity: { bornAt: null } });
    expect(a.entities[0].components.citizen!.parents).toEqual([parent.id]);
  });

  it('allows ordinary damage to kill a favorite, preserving family and reporting distinct losses once', () => {
    const world = flatWorld(), parent = world.spawn('core:person', { x: 5, y: 5 })!, child = world.spawn('core:person', { x: 8, y: 5 })!, partner = world.spawn('core:person', { x: 11, y: 5 })!, friend = world.spawn('core:person', { x: 14, y: 5 })!;
    child.components.citizen!.parents = [parent.id];
    parent.components.citizen!.partnerId = partner.id; partner.components.citizen!.partnerId = parent.id;
    befriend(world, parent, friend); renameUnit(world, parent.id, 'Remember me');
    parent.components.unit!.favorite = true;
    world.events.push({ kind: 'damage', target: parent.id, amount: 100000 }); world.step();
    expect(world.entities.has(parent.id)).toBe(false);
    expect(partner.components.citizen!.partnerId).toBeNull(); expect(friend.components.unit!.bestFriendId).toBeNull();
    expect(world.unitHistory.find(m => m.id === parent.id)?.died).toBe(true);
    const messages = world.society.history.map(e => e.text);
    expect(messages.some(s => s.includes('lost their partner Remember me'))).toBe(true);
    expect(messages.some(s => s.includes('lost their best friend Remember me'))).toBe(true);
    expect(messages.filter(s => s === 'Favorite Remember me died')).toHaveLength(1);
    world.remove(parent.id);
    expect(world.unitHistory.filter(m => m.id === parent.id)).toHaveLength(1);
    const loaded = new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry));
    expect(inspectUnit(loaded, child.id)!.family).toContainEqual({ relation: 'Parent', member: { kind: 'unit', id: parent.id, name: 'Remember me', ended: true } });
  });

  it('keeps family and friendship independent of migration affiliation', () => {
    const world = villageWorld(), [person, partner, friend] = [...world.query('citizen')];
    person.components.citizen!.partnerId = partner.id; partner.components.citizen!.partnerId = person.id;
    befriend(world, person, friend); renameUnit(world, person.id, 'Traveller');
    const village = world.society.villages[1];
    person.components.person!.homeId = null; person.components.citizen!.villageId = village.id;
    beginIntegration(world, person, { id: 1, fromId: world.society.villages[0].id, toId: village.id, destination: village,
      members: [person.id], homeIds: [], food: 0, started: world.tick });
    const view = inspectUnit(world, person.id)!;
    expect(view.village?.id).toBe(village.id); expect(unitName(person)).toBe('Traveller');
    expect(view.family.find(r => r.relation === 'Partner')?.member.id).toBe(partner.id);
    expect(view.family.find(r => r.relation === 'Best friend')?.member.id).toBe(friend.id);
  });

  it('completes a real conversation identically across a save and does not advance it while paused', () => {
    const base = villageWorld([{ x: 24, y: 24 }]), [first, second] = [...base.query('citizen')];
    const village = base.society.villages[0]; setFood(village, 100);
    Object.assign(first.components.position!, { x: 20, y: 20 }); Object.assign(second.components.position!, { x: 21, y: 20 });
    for (const [e, other] of [[first, second], [second, first]]) Object.assign(e.components.citizen!, { task: 'socialize', targetId: other.id, path: [], hunger: 0 });
    first.components.citizen!.integration = { villageId: village.id, groupId: 1, arrived: base.tick, status: 'settling', belonging: 30,
      worked: false, friendId: null, contactId: second.id, contact: 3, socialAfter: base.tick + 600, socialUntil: base.tick + 360, leaveAfter: base.tick + 2700 };
    const systems = [{ id: 'test:conversation', update: (w: World) => integration(w) }];
    const snapshot = decodeSave(base.snapshot(), base.registry);
    const continuous = new World(base.seed, base.registry, snapshot, systems);
    const resumed = new World(base.seed, base.registry, snapshot, systems);
    resumed.paused = true; const paused = resumed.snapshot(); for (let i = 0; i < 120; i++) resumed.step();
    expect(resumed.snapshot()).toEqual(paused); resumed.paused = false;
    for (let i = 0; i < 90; i++) { continuous.step(); resumed.step(); }
    expect(resumed.snapshot()).toEqual(continuous.snapshot()); expect(resumed.rng.state).toBe(snapshot.rngState);
    expect(resumed.entities.get(first.id)!.components.unit!.bestFriendId).toBe(second.id);
  });

  it('handles vanished task targets and cleans invalid identity references on load', () => {
    const world = flatWorld(), person = world.spawn('core:person', { x: 6, y: 6 })!, tree = world.spawn('core:tree', { x: 9, y: 6 })!;
    Object.assign(person.components.citizen!, { task: 'work', targetId: tree.id }); world.remove(tree.id);
    expect(inspectUnit(world, person.id)!.target).toBeUndefined();
    expect(person.components.citizen!.task).toBe('idle');
    person.components.citizen!.targetId = tree.id;
    expect(inspectUnit(world, person.id)!.reason).toBe('Target is no longer available');
    person.components.citizen!.targetId = null;
    Object.assign(person.components.unit!, { bestFriendId: 999999, lostPartnerId: 999999 });
    const loaded = decodeSave(world.snapshot(), world.registry);
    expect(loaded.entities.find(e => e.id === person.id)!.components.unit).toMatchObject({ bestFriendId: null, lostPartnerId: null });
    loaded.entities.find(e => e.id === person.id)!.components.unit!.customName = 'x'.repeat(31);
    expect(() => decodeSave(loaded, world.registry)).toThrow();
  });
});
