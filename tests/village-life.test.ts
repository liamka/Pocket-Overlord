import { operational } from '../src/core/buildings';
import { deposit, withdraw } from '../src/core/resource-ledger';
import { describe, expect, it } from 'vitest';
import { World } from '../src/core/world';
import { economyOf, governmentOf, recordService } from '../src/core/village-life';
import { SAVE_VERSION, STEP, Terrain, type Entity } from '../src/core/types';
import { decodeSave } from '../src/persistence/schema';
import { assignAnimalCare, continueAnimalCare, husbandry } from '../src/systems/husbandry';
import { assignVillageWork, continueVillageWork, economy } from '../src/systems/economy';
import { governance } from '../src/systems/governance';
import { agriculture, assignHouse } from '../src/systems/society';
import { declareWar, endWar } from '../src/systems/diplomacy';
import { processEvents } from '../src/systems/effects';
import { movement } from '../src/systems/people';
import { advance, diplomaticWorld, flatWorld } from './helpers';

function settlement() {
  const world = flatWorld(), home = world.spawn('core:house', { x: 24, y: 24 })!, village = assignHouse(world, home);
  village.food = 100; village.migrationAfter = 100000;
  const people = [18, 20, 26, 28].map(x => world.spawn('core:person', { x, y: 21 })!);
  for (const e of people) {
    Object.assign(e.components.person!, { homeId: home.id, sex: 'b', reproduceIn: 100000, buildIn: 100000 });
    e.components.citizen!.villageId = village.id;
  }
  return { world, village, people, home };
}

function place(world: World, entity: Entity, x: number, y: number): void {
  Object.assign(entity.components.position!, { x, y }); world.spatial.update(entity);
}

describe('livestock and companions', () => {
  it('starts a household herd and feeds animals only after the resident reaches them', () => {
    const { world, village, people } = settlement();
    world.tick = 600; husbandry(world, STEP);
    expect([...world.query('animal')].map(e => e.components.animal!.kind).sort()).toEqual(['dog', 'sheep', 'sheep']);
    const sheep = [...world.query('animal')].find(e => e.components.animal!.kind === 'sheep')!;
    place(world, sheep, 30, 21); sheep.components.animal!.hunger = 80;
    const worker = people[1], food = village.food;
    expect(assignAnimalCare(world, worker)).toBe(true);
    continueAnimalCare(world, worker);
    expect(village.food).toBe(food); expect(sheep.components.animal!.hunger).toBe(80);
    place(world, worker, 28.5, 21); worker.components.citizen!.path = []; continueAnimalCare(world, worker);
    expect(village.food).toBe(food - 1); expect(sheep.components.animal!.hunger).toBe(25);
    expect(worker.components.citizen!.service).toBeGreaterThan(0);
  });

  it('requires two nearby, well-fed adults to breed and limits the herd', () => {
    const { world, village } = settlement();
    const sheep = [20, 22].map(x => world.spawn('core:sheep', { x, y: 30 })!);
    for (const e of sheep) Object.assign(e.components.animal!, { villageId: village.id, breedIn: 0, hunger: 10 });
    husbandry(world, STEP);
    expect([...world.query('animal')]).toHaveLength(3);
    expect([...world.query('animal')].at(-1)!.components.animal!.age).toBe(0);
    for (const e of sheep) Object.assign(e.components.animal!, { breedIn: 0, hunger: 90 });
    husbandry(world, STEP); expect([...world.query('animal')]).toHaveLength(3);
    while ([...world.query('animal')].length < 8) world.spawn('core:sheep', { x: 21, y: 31 })!.components.animal!.villageId = village.id;
    for (const e of sheep) Object.assign(e.components.animal!, { breedIn: 0, hunger: 10 });
    husbandry(world, STEP); expect([...world.query('animal')]).toHaveLength(8);
  });

  it('has dogs follow owners and protect sheep, while wolves actually attack unguarded livestock', () => {
    const { world, village, people } = settlement(), owner = people[0];
    const dog = world.spawn('core:dog', { x: 12, y: 21 })!;
    Object.assign(dog.components.animal!, { ownerId: owner.id, villageId: village.id });
    for (let i = 0; i < 90; i++) husbandry(world, STEP);
    expect(dog.components.position!.x).toBeGreaterThan(14);
    const sheep = world.spawn('core:sheep', { x: 31, y: 30 })!, wolf = world.spawn('core:wolf', { x: 30, y: 30 })!;
    sheep.components.animal!.villageId = village.id;
    husbandry(world, STEP); processEvents(world);
    expect(sheep.components.health!.current).toBeLessThan(sheep.components.health!.max);
    place(world, dog, 29, 30); dog.components.animal!.decisionIn = 0;
    husbandry(world, STEP); processEvents(world);
    expect(wolf.components.health!.current).toBeLessThan(wolf.components.health!.max);
    world.remove(owner.id); expect(dog.components.animal!.ownerId).toBeNull();
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });

  it('does not feed through water or spend the last food reserve', () => {
    const { world, village, people } = settlement(), sheep = world.spawn('core:sheep', { x: 25, y: 21 })!;
    Object.assign(sheep.components.animal!, { villageId: village.id, hunger: 80 });
    for (let y = 0; y < 48; y++) world.terrain.set(23, y, Terrain.Water);
    expect(assignAnimalCare(world, people[0])).toBe(false);
    village.food = 1; expect(assignAnimalCare(world, people[2])).toBe(false);
  });
});

describe('village production and markets', () => {
  it('processes grain into flour and bread, carrying each batch before stocking the nearest suitable storage', () => {
    const { world, village, people } = settlement(), worker = people[0];
    const market = world.spawn('core:market', { x: 16, y: 28 })!, mill = world.spawn('core:mill', { x: 28, y: 28 })!, bakery = world.spawn('core:bakery', { x: 34, y: 28 })!;
    for (const e of [market, mill, bakery]) e.components.workplace!.villageId = village.id;
    const stocks = economyOf(village).stocks; stocks.grain = 2;
    expect(assignVillageWork(world, worker)).toBe(true);
    for (let i = 0; i < 12; i++) continueVillageWork(world, worker);
    expect(stocks.grain).toBe(2); expect(worker.components.citizen!.work!.cargo).toBeNull();
    place(world, worker, 26.3, 28); worker.components.citizen!.path = [];
    for (let i = 0; i < 8; i++) continueVillageWork(world, worker);
    expect(stocks.grain).toBe(0); expect(stocks.flour).toBe(0);
    expect(worker.components.citizen!.work!.cargo!.good).toBe('flour');
    const saved = decodeSave(world.snapshot(), world.registry), restored = new World(saved.seed, world.registry, saved);
    expect(restored.entities.get(worker.id)!.components.citizen!.work).toEqual(worker.components.citizen!.work);
    expect(worker.components.citizen!.targetId).toBe(mill.id);
    place(world, worker, 26.2, 28); worker.components.citizen!.path = []; continueVillageWork(world, worker);
    expect(stocks.flour).toBe(2); expect(economyOf(village).deliveries).toBe(1);
    expect(assignVillageWork(world, worker)).toBe(true);
    expect(worker.components.citizen!.targetId).toBe(bakery.id);
    place(world, worker, 32.3, 28); worker.components.citizen!.path = [];
    for (let i = 0; i < 8; i++) continueVillageWork(world, worker);
    expect(stocks.flour).toBe(0); expect(stocks.bread).toBe(0);
    const food = village.food;
    place(world, worker, 17.8, 28); worker.components.citizen!.path = []; continueVillageWork(world, worker);
    expect(stocks.bread).toBe(4); expect(village.food).toBe(food + 4);
    expect(economyOf(village).deliveries).toBe(2);
  });

  it('fells real trees, keeps cargo across hunger and market destruction, and makes useful tools', () => {
    const { world, village, people } = settlement(), worker = people[0];
    const market = world.spawn('core:market', { x: 16, y: 28 })!, workshop = world.spawn('core:workshop', { x: 34, y: 28 })!;
    for (const e of [market, workshop]) e.components.workplace!.villageId = village.id;
    const tree = world.spawn('core:tree', { x: 20, y: 30 })!;
    economyOf(village).forestPolicy = 'intensive';
    expect(assignVillageWork(world, worker)).toBe(true);
    place(world, worker, 20, 28.3); worker.components.citizen!.path = [];
    for (let i = 0; i < 8; i++) continueVillageWork(world, worker);
    expect(world.entities.has(tree.id)).toBe(false);
    const cargo = structuredClone(worker.components.citizen!.work!.cargo);
    worker.components.citizen!.hunger = 80; continueVillageWork(world, worker);
    expect(worker.components.citizen!.task).toBe('idle'); expect(worker.components.citizen!.work!.cargo).toEqual(cargo);
    world.remove(market.id); worker.components.citizen!.hunger = 10;
    expect(assignVillageWork(world, worker)).toBe(false);
    const replacement = world.spawn('core:market', { x: 16, y: 28 })!; replacement.components.workplace!.villageId = village.id;
    expect(assignVillageWork(world, worker)).toBe(true);
    place(world, worker, 17.8, 28); worker.components.citizen!.path = []; continueVillageWork(world, worker);
    expect(economyOf(village).stocks.wood).toBe(5);
    deposit(village, { wood: 2 }); // Four units remain protected for housing after production.
    expect(assignVillageWork(world, worker)).toBe(true);
    place(world, worker, 32.3, 28); worker.components.citizen!.path = [];
    for (let i = 0; i < 8; i++) continueVillageWork(world, worker);
    place(world, worker, 17.8, 28); worker.components.citizen!.path = []; continueVillageWork(world, worker);
    expect(economyOf(village).stocks.tools).toBe(2); expect(economyOf(village).stocks.wood).toBe(4);
    const farm = world.spawn('core:farm', { x: 20, y: 32 })!; farm.components.farm!.villageId = village.id;
    Object.assign(worker.components.citizen!, { task: 'farm', targetId: farm.id }); place(world, worker, 20, 30.3);
    world.tick = 30; agriculture(world); const equippedGrowth = farm.components.farm!.growth;
    farm.components.farm!.growth = 0; withdraw(village, { tools: economyOf(village).stocks.tools }); agriculture(world);
    expect(equippedGrowth).toBeGreaterThan(farm.components.farm!.growth);
  });

  it('lets a worker physically walk to a station and then deliver without issuing new orders', () => {
    const { world, village, people } = settlement(), worker = people[0];
    const market = world.spawn('core:market', { x: 14, y: 28 })!, mill = world.spawn('core:mill', { x: 30, y: 28 })!;
    for (const e of [market, mill]) e.components.workplace!.villageId = village.id;
    economyOf(village).stocks.grain = 2; assignVillageWork(world, worker);
    for (let i = 0; i < 1500 && !economyOf(village).deliveries; i++) {
      world.tick++; movement(world, STEP);
      if (world.tick % 15 === 0) { worker.components.citizen!.reconsiderIn -= 0.5; continueVillageWork(world, worker); }
    }
    expect(economyOf(village).deliveries).toBe(1);
    expect(Math.hypot(worker.components.position!.x - mill.components.position!.x, worker.components.position!.y - mill.components.position!.y)).toBeLessThanOrEqual(2.1);
  });

  it('finishes the route before working across an obstacle and releases labor when stores are full', () => {
    const { world, village, people } = settlement(), worker = people[0];
    const market = world.spawn('core:market', { x: 14, y: 28 })!, mill = world.spawn('core:mill', { x: 30, y: 28 })!;
    for (const e of [market, mill]) e.components.workplace!.villageId = village.id;
    economyOf(village).stocks.grain = 2; assignVillageWork(world, worker);
    place(world, worker, 30, 26);
    for (let i = 0; i < 10; i++) continueVillageWork(world, worker);
    expect(worker.components.citizen!.work!.cargo).toBeNull(); expect(economyOf(village).stocks.grain).toBe(2);
    worker.components.citizen!.work!.cargo = { good: 'wood', amount: 3, villageId: village.id };
    worker.components.citizen!.task = 'idle'; deposit(village, { wood: 2000 });
    expect(assignVillageWork(world, worker)).toBe(false);
    expect(worker.components.citizen!.work!.cargo!.amount).toBe(3);
  });

  it('preserves abandoned workplaces and clears ownership before the next save', () => {
    const { world, village, people, home } = settlement();
    world.tick = 900; economy(world); husbandry(world, STEP); governance(world);
    for (const person of people) world.remove(person.id);
    world.remove(home.id);
    world.tick = 929; world.step();
    expect(world.society.villages.some(v => v.id === village.id)).toBe(false);
    const workplaces = [...world.query('workplace')];
    expect(workplaces).toHaveLength(1);
    expect(workplaces[0].components.workplace!.villageId).toBeNull();
    expect(workplaces[0].components.building!.project).toBeDefined();
    expect([...world.query('animal')].every(e => e.components.animal!.villageId === null && e.components.animal!.ownerId === null)).toBe(true);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });

  it('develops all workplaces autonomously, continues after reload, and freezes when paused', () => {
    const { world, village } = settlement();
    for (const y of [32, 36]) for (const x of [8, 12, 16, 28, 32, 36]) world.spawn('core:tree', { x, y });
    for (const x of [12, 20, 28]) world.spawn('core:stone', { x, y: 40 });
    advance(world, 180);
    expect([...world.query('workplace')].filter(operational).map(e => e.components.workplace!.kind).sort()).toEqual(['bakery', 'market', 'mill', 'workshop']);
    expect(village.economy!.deliveries).toBeGreaterThan(0);
    expect(village.government!.leaderId).not.toBeNull();
    expect([...world.query('animal')].length).toBeGreaterThanOrEqual(3);
    const saved = decodeSave(world.snapshot(), world.registry), restored = new World(saved.seed, world.registry, saved);
    advance(world, 3); advance(restored, 3); expect(restored.snapshot()).toEqual(world.snapshot());
    restored.paused = true; const paused = restored.snapshot(); advance(restored, 2); expect(restored.snapshot()).toEqual(paused);
  });
});

describe('elders and public trust', () => {
  it('elects adults by service, rewards harvests and replaces an unpopular elder', () => {
    const { world, village, people } = settlement();
    people[0].components.person!.age = 10; recordService(people[0], 100);
    recordService(people[1], 5); recordService(people[2], 3);
    world.tick = 30; governance(world);
    const g = governmentOf(village); expect(g.leaderId).toBe(people[1].id);
    const before = g.trust; village.harvested += 20; world.tick += 30; governance(world); expect(g.trust).toBeGreaterThan(before);
    village.food = 0; for (const e of people) e.components.citizen!.hunger = 90;
    for (let i = 0; i < 20 && g.leaderId === people[1].id; i++) { world.tick += 30; governance(world); }
    expect(g.leaderId).toBe(people[2].id); expect(g.elections).toBe(2);
    expect(world.society.history.some(e => e.text.includes('losing trust'))).toBe(true);
    world.remove(people[2].id); expect(g.leaderId).toBeNull();
    world.tick += 30; governance(world); expect(g.leaderId).not.toBeNull();
  });

  it('reduces trust on the losing side when a war ends', () => {
    const world = diplomaticWorld(2); world.tick = 30; governance(world);
    const war = declareWar(world, 1, 2)!; expect(war).toBeDefined();
    const [a, b] = world.society.villages.map(governmentOf), beforeA = a.trust, beforeB = b.trust;
    war.lossesAttackers = 2; endWar(world, war, 'Losses');
    expect(a.trust).toBe(beforeA - 18); expect(b.trust).toBe(beforeB);
  });

  it('migrates older worlds and rejects broken life data and references', () => {
    const { world, village, people } = settlement();
    const old = world.snapshot(); old.version = 29;
    expect(decodeSave(old, world.registry).version).toBe(SAVE_VERSION); expect(old.version).toBe(29);
    world.tick = 900; economy(world); governance(world); husbandry(world, STEP);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
    const badTrust = world.snapshot(); badTrust.society.villages[0].government!.trust = 101;
    expect(() => decodeSave(badTrust, world.registry)).toThrow();
    const badLeader = world.snapshot(); badLeader.society.villages[0].government!.leaderId = 9999;
    expect(() => decodeSave(badLeader, world.registry)).toThrow();
    const badStock = world.snapshot(); badStock.society.villages[0].economy!.stocks.wood = -1;
    expect(() => decodeSave(badStock, world.registry)).toThrow();
    people[0].components.citizen!.work = { good: 'wood', progress: 0, cargo: { good: 'wood', amount: -1, villageId: village.id } };
    expect(() => decodeSave(world.snapshot(), world.registry)).toThrow();
  });
});
