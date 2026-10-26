import { SUPPLY_GOODS, supplyNeed, supplyPolicy, type SupplyEntry, type SupplyGood } from '../core/supply';
import { roadProblem, roadIsIntact } from '../core/roads';
import { buildingLines } from './buildings';
import { housingLimit } from '../core/buildings';
import type { Entity, Village } from '../core/types';
import type { World } from '../core/world';
import { cargoContents, inTransit, isCrafted, RECIPES, reservedStock, stockContents } from '../core/resource-ledger';
import { sourceContents } from '../core/resource-sources';
import { depositContents, housingStoneReserve, stoneSurplus } from '../core/deposits';
import { addBundle, entries, SAPIENT_SPECIES, type ResourceBundle, type ResourceId } from '../core/resources';
import { BONE } from '../core/bone';
import { GOLD } from '../core/gold';
import { translate, type Language } from '../i18n';
import { reservedAt, storageFor, storesOf } from '../core/stockpiles';
import { bundleLoad } from '../core/resources';
import { FOREST, FOREST_POLICIES, housingWoodReserve, treeProblem } from '../core/forestry';
import { availableStock } from '../core/resource-ledger';
import { buildingOwner } from '../core/buildings';
import { incomingGems } from '../core/gems';
import { biomeDefinition } from '../core/natural-biomes';
import { COMMON_METAL_MATERIALS, canWorkMetal, metalExperience, type CommonMetalMaterial } from '../core/common-metals';
import { operational } from '../core/buildings';
import { localizedSettlementName } from '../content/settlement-names';

const names: Record<ResourceId, string> = {
  grain: 'Grain', flour: 'Flour', bread: 'Bread', wood: 'Wood', tools: 'Tools', stone: 'Stone', stoneAxes: 'Stone axes',
  commonMetal: 'Common metal ore', silver: 'Silver', mythril: 'Mythril', adamantine: 'Adamantine', bone: 'Bone', leather: 'Leather', gems: 'Gems', gold: 'Gold', dragonScale: 'Dragon scales', fertilizer: 'Fertilizer',
  bananas: 'Bananas', berries: 'Berries', candy: 'Candies', celestialAvocado: 'Celestial avocado', coconut: 'Coconut', crystalSalt: 'Crystal salt', desertBerries: 'Desert berries', evilBeets: 'Evil beets', fish: 'Fish', herbs: 'Herbs', honey: 'Honey', lemons: 'Lemons', meat: 'Meat', mushrooms: 'Mushrooms', peppers: 'Peppers', pineCones: 'Pine cones', snowCucumbers: 'Snow cucumbers', worms: 'Worms',
  ale: 'Ale', burger: 'Burger', cider: 'Cider', jam: 'Jam', pie: 'Pie', sushi: 'Sushi', tea: 'Tea', provisions: 'Provisions',
};
export function wrapResourceLines(ctx: CanvasRenderingContext2D, lines: string[], width: number): string[] {
  return lines.flatMap(line => {
    const wrapped: string[] = []; let current = '';
    for (const part of line.split(', ')) {
      const next = current ? `${current}, ${part}` : part;
      if (current && ctx.measureText(next).width > width) { wrapped.push(current); current = part; }
      else current = next;
    }
    wrapped.push(current); return wrapped;
  });
}
export function resourceText(goods: ResourceBundle, language: Language): string {
  return entries(goods).filter(([, n]) => n > 1e-8).map(([id, n]) => `${translate(names[id], language)} ${Math.round(n * 100) / 100}`).join(', ') || translate('Nothing', language);
}
export const resourceName = (id: ResourceId, language: Language): string => translate(names[id], language);
export function resourceEntityLines(entity: Entity, language: Language, world?: World): string[] {
  const work = entity.components.citizen?.work, source = sourceContents(entity), lines: string[] = [];
  if (work?.mine) lines.push(translate(work.mine.enteredAt === null ? 'Walking to the mine entrance' : 'Working inside the mine', language));
  if (entity.components.mineOrigin) lines.push(translate('Exposed by mine {id}', language, { id: entity.components.mineOrigin.mineId }));
  const voyage = entity.components.foreignVoyage, hunter = entity.components.monsterHunter;
  if (voyage || hunter) {
    const cargo = { ...(voyage?.goods ?? hunter?.loot) };
    if (voyage) addBundle(cargo, voyage.purchases);
    lines.push(translate('Cargo: {goods}', language, { goods: resourceText(cargo, language) }));
  }
  if (entity.components.stone?.profile === 'silverOre') lines.push(translate('Silver ore', language),
    translate('Origin biome: {biome}', language, { biome: translate(biomeDefinition(entity.components.stone.biome).name, language) }));
  if (entity.components.stone?.profile === 'goldOre') lines.push(translate('Gold ore', language), translate('Gold is a mineral stock, separate from personal coins', language));
  if (entity.components.ship?.kind === 'trade') {
    lines.push(translate('Successful cargo delivery generates {gold} gold at the receiving harbor', language, { gold: GOLD.tradeIncome }));
    const voyage = entity.components.ship.goldVoyage;
    if (voyage?.settled) lines.push(translate('Voyage income credited: {gold} gold · Overflow lost: {lost}', language, { gold: voyage.income, lost: GOLD.tradeIncome - voyage.income }));
  }
  if (entity.components.stone?.profile === 'boneDeposit') lines.push(translate('Bone deposit', language),
    translate('Origin biome: {biome}', language, { biome: translate(biomeDefinition(entity.components.stone.biome).name, language) }));
  if (work?.waiting && !entity.components.citizen?.jobProblem && ['idle', 'eat', 'work', 'deliver'].includes(entity.components.citizen!.task)) lines.push(translate(work.waiting, language));
  if (work?.cargo) lines.push(translate('Cargo: {goods}', language, { goods: resourceText(cargoContents(work.cargo), language) }), translate(entity.components.citizen?.task === 'deliver' ? 'Carried to storage' : 'Waiting with cargo for a reachable storage space', language));
  else if (entity.components.citizen?.task === 'work' && work && isCrafted(work.good)) lines.push(translate('Recipe cost: {goods}', language, { goods: resourceText(RECIPES[work.good].inputs, language) }));
  if (source) lines.push(translate(entity.components.tree ? 'Felling yield: {goods}' : 'Remaining: {goods}', language, { goods: resourceText(source, language) }));
  if (entity.components.foodPlant) {
    const plant = entity.components.foodPlant;
    lines.unshift(translate('Fruit plants', language));
    lines.push(translate(plant.remaining ? 'Ripe harvest: {goods}' : 'Ripening in {seconds} s; winter pauses the harvest', language,
      { goods: resourceText({ [plant.good]: plant.remaining }, language), seconds: Math.max(0, Math.ceil((plant.ripeAt - (world?.tick ?? 0)) / 30)) }));
  }
  const mineral = entity.components.stone ?? entity.components.commonMetal;
  if (mineral) {
    const d = mineral, held = d.claims.reduce((n, c) => n + c.amount, 0);
    if (held) lines.push(translate('Reserved for mining: {goods}', language, { goods: resourceText(depositContents(d, held), language) }));
    lines.push(translate(d.origin === 'placed' ? 'Placed deposit' : d.origin === 'mine' ? 'Deposit from a mine' : d.origin === 'biology' ? 'Deposit from a gold-producing creature' : d.origin === 'meteorite' ? 'Meteorite deposit' : 'Natural deposit', language));
  }
  const gem = entity.components.gemSource;
  if (gem) lines.unshift(translate(gem.kind === 'plant' ? 'Crystal plant' : gem.origin === 'mine' ? 'Gem ore raised by a mine' : 'Natural gem ore', language),
    translate('Origin biome: {biome}', language, { biome: translate(biomeDefinition(gem.biome).name, language) }));
  if (entity.components.shipment && world) {
    const load = entity.components.shipment;
    lines.push(supplyLine(world, { ...load, carrierId: entity.id, tick: world.tick, ...entity.components.position! }, language));
    lines.push(translate('Cargo: {goods}', language, { goods: resourceText(load.goods, language) }));
    if (load.itemIds.length) lines.push(translate('Shipment items: {ids}', language, { ids: load.itemIds.map(id => `#${id}`).join(', ') }));
    lines.push(translate('Delivered {delivered} · Returned {returned} · Lost or dropped {lost}', language, { delivered: load.delivered, returned: load.returned, lost: load.lost }));
  }
  const caravan = entity.components.caravan;
  if (caravan?.gems && !entity.components.shipment) lines.push(translate('Cargo: {goods}', language, { goods: resourceText({ gems: caravan.gems }, language) }),
    translate(caravan.retryIn > 0 ? 'Gem shipment is waiting for a clear route' : caravan.returning ? 'Gem shipment is returning home' : 'Gem shipment is travelling to another village', language));
  if (entity.components.commonMetal) lines.unshift(translate('Common metal ore', language));
  if (entity.components.tree) {
    const t = entity.components.tree, problem = treeProblem(entity);
    lines.push(translate(t.age < FOREST.sapling ? 'Sapling' : t.age < FOREST.mature ? 'Growing tree' : 'Mature tree', language));
    if (problem) lines.push(translate(problem, language));
    else if (t.claim) lines.push(translate('Reserved by woodcutter {id}', language, { id: t.claim.workerId }));
  }
  if (entity.components.harbor) lines.push(translate('Wood per ship: {wood}', language, { wood: FOREST.shipWood }));
  const pile = entity.components.resourcePile;
  if (pile) {
    const species: Record<string, string> = { human: 'Human', elf: 'Elf', dwarf: 'Dwarf', orc: 'Orc', sheep: 'Sheep', dog: 'Dog', wolf: 'Wolf' };
    lines.push(translate('Remains: {species}', language, { species: translate(species[pile.species], language) }));
    if (world) {
      const owner = world.society.villages.find(v => v.id === pile.villageId);
      lines.push(translate('Owner: {name}', language, { name: owner ? localizedSettlementName(world.seed, owner, language) : translate('No owner', language) }),
        translate('Gather within {seconds} s', language, { seconds: Math.max(0, Math.ceil((pile.createdAt + BONE.remainsTicks - world.tick) / 30)) }));
    }
    if (SAPIENT_SPECIES.includes(pile.species)) lines.push(translate('Sapient remains require explicit collection permission', language));
  }
  if (entity.components.resourceConsumer) lines.push(translate('Diet: {goods}', language,
    { goods: entity.components.resourceConsumer.diet.map(id => translate(names[id], language)).join(', ') }),
    translate(entity.components.resourceConsumer.sapientRemains ? 'May gather sapient remains' : 'May not gather sapient remains', language));
  if (entity.components.raisedRemains) lines.push(translate('Raised from remains: no new resources on death', language));
  const store = world && storageFor(world, entity.id);
  if (store) {
    const available = { ...store.goods }, reserved = reservedAt(store);
    for (const [id, n] of entries(reserved)) available[id] = Math.max(0, (available[id] ?? 0) - n);
    lines.push(translate(entity.components.stockpile?.resistance === 'fireproof' ? 'Fireproof stockpile' : entity.components.stockpile?.resistance === 'acidproof' ? 'Acidproof stockpile' : 'Stockpile', language),
      translate('Stored volume: {used} / {capacity}', language, { used: Math.round((bundleLoad(store.goods).volume + (store.equipmentVolume ?? 0)) * 100) / 100, capacity: store.capacity }),
      translate('Available: {goods}', language, { goods: resourceText(available, language) }), translate('Reserved: {goods}', language, { goods: resourceText(reserved, language) }));
  }
  return [...lines, ...(world ? buildingLines(world, entity, language) : [])];
}
export function gemRecipeLines(world: World, villageId: number | null | undefined, required: number, language: Language): string[] {
  if (!required) return [];
  const village = world.society.villages.find(v => v.id === villageId);
  const available = village ? availableStock(world, village, 'gems') : 0;
  const incoming = village ? incomingGems(world, village.id) : 0;
  return [translate('Gems required: {required} · Available: {available} · Missing: {missing} · In transit: {incoming}', language,
    { required, available, missing: Math.max(0, required - available), incoming }),
    translate('Gem sources: rare ore and crystal flora. Caravans bring surplus along open roads.', language)];
}
export function boneRecipeLines(language: Language): string[] {
  return [translate('Bone sources: Corrupted deposits and animal remains.', language),
    translate('Bone is used for rings and amulets only.', language)];
}
/** Small original Canvas marks on the existing rock silhouette; no external art. */
export function drawGemSource(ctx: CanvasRenderingContext2D, plant = false): void {
  ctx.fillStyle = '#533e81'; ctx.fillRect(-5, -6, 10, 7);
  for (const [x, y, height] of plant ? [[-5, -10, 9], [0, -16, 15], [4, -8, 7]] : [[-4, -9, 5], [2, -7, 4]]) {
    ctx.fillStyle = '#9474cf'; ctx.fillRect(x, y, 3, height);
    ctx.fillStyle = '#d9c4ff'; ctx.fillRect(x, y, 1, height - 1);
  }
}
export function resourceVillageLines(world: World, village: Village, language: Language): string[] {
  if (!village.economy) return [];
  const reserved = reservedStock(world, village), available = stockContents(village);
  for (const [id, n] of entries(reserved)) available[id] = Math.max(0, (available[id] ?? 0) - n);
  const rows: [string, ResourceBundle][] = [['Available: {goods}', available], ['Reserved: {goods}', reserved], ['In transit: {goods}', inTransit(world, village.id)],
    ['Consumed: {goods}', village.economy.spent ?? {}], ['Lost: {goods}', village.economy.lost ?? {}]];
  const plots = housingLimit(world, village);
  const roads = world.society.roads.filter(r => r.a === village.id || r.b === village.id);
  const connected = roads.filter(r => roadIsIntact(world, r)).length;
  const unfinished = roads.find(r => !roadIsIntact(world, r));
  const roadState = unfinished ? roadProblem(world, unfinished) : village.roadPlan?.problem === 'No road route' ? 'No road route'
    : roads.length ? 'Roads connected' : village.roadPlan?.problem ?? 'Road needs buildings';
  return [translate('House plots: {used} / {capacity}', language, { used: plots.used, capacity: plots.limit }), translate('Storage sites: {count}', language, { count: storesOf(village).length }),
    translate('Road connections: {connected}/{total} · {reason}', language, { connected, total: roads.length, reason: translate(roadState, language) }),
    ...supplyVillageLines(world, village, language),
    ...forestVillageLines(world, village, language), ...metalworkingLines(world, village, language),
    translate('Stone for housing: {stone} · Surplus: {surplus}', language, { stone: housingStoneReserve(world, village), surplus: stoneSurplus(world, village) }),
    ...rows.map(([label, goods]) => translate(label, language, { goods: resourceText(goods, language) }))];
}
export function metalworkingLines(world: World, village: Village, language: Language): string[] {
  const ore = availableStock(world, village, 'commonMetal'), experience = metalExperience(village);
  const workshop = [...world.query('workplace')].some(e => e.components.workplace!.kind === 'workshop'
    && e.components.workplace!.villageId === village.id && operational(e) && !e.components.thermal?.burning);
  return [translate('Raw ore available: {amount}', language, { amount: ore }),
    ...Object.entries(COMMON_METAL_MATERIALS).map(([id, material]) => {
      const status = !canWorkMetal(village, id as CommonMetalMaterial)
        ? translate('Metal items completed: {count}/{required}', language, { count: experience, required: material.requires })
        : translate(!workshop ? 'A working workshop is required' : ore < material.cost ? 'Missing unreserved ore' : 'Ready to forge', language);
      return translate('{material}: ore per weapon {cost}, durability {durability} · {status}', language, {
        material: translate(`equipment-material:${id}`, language), cost: material.cost, durability: material.durability, status,
      });
    })];
}
export function forestVillageLines(world: World, village: Village, language: Language): string[] {
  if (!village.economy) return [];
  const policy = FOREST_POLICIES[village.economy.forestPolicy ?? 'balanced'];
  const plannedWood = [...world.query('building')].reduce((sum, e) => sum + (buildingOwner(e) === village.id && !e.components.building!.project?.paid ? e.components.building!.project?.cost.wood ?? 0 : 0), 0);
  return [translate('Available: {goods}', language, { goods: resourceText({ wood: availableStock(world, village, 'wood') }, language) }),
    translate('Wood held for housing: {wood} · Missing wood: {missing}', language, { wood: housingWoodReserve(world, village), missing: Math.max(0, plannedWood - (village.economy.stocks.wood ?? 0)) }),
    translate('Keep {trees} mature trees · Up to {workers} woodcutters', language, { trees: policy.trees, workers: policy.workers }),
    ...(village.economy.forestProblem && availableStock(world, village, 'wood') < Math.max(12, plannedWood) ? [translate(village.economy.forestProblem, language)] : [])];
}

function supplyName(good: SupplyGood, language: Language): string {
  return good === 'food' ? translate('Food', language) : good === 'equipment' ? translate('Individual equipment', language) : resourceName(good, language);
}
function supplyLine(world: World, entry: SupplyEntry, language: Language): string {
  const name = (id: number) => { const v = world.society.villages.find(v => v.id === id); return v ? localizedSettlementName(world.seed, v, language) : `#${id}`; };
  return translate('Supply {from} → {to}: {goods} · {reason}', language, { from: name(entry.fromId), to: name(entry.toId),
    goods: `${supplyName(entry.good, language)} ${entry.amount}`, reason: translate(entry.reason, language) });
}
export function supplyVillageLines(world: World, village: Village, language: Language): string[] {
  const needs = SUPPLY_GOODS.map(good => ({ good, amount: supplyNeed(world, village, good) })).filter(n => n.amount > 0);
  return [translate('Supply needs: {goods}', language, { goods: needs.map(n => `${supplyName(n.good, language)} ${Math.ceil(n.amount)}`).join(', ') || translate('Nothing', language) }),
    translate('Food reserve: {amount} · Next supply in {seconds} s', language, { amount: supplyPolicy(world, village, 'food').reserve,
      seconds: Math.max(0, Math.ceil(((village.economy?.supplyAfter ?? 0) - world.tick) / 30)) }),
    ...(village.economy?.supplyHistory ?? []).slice(-4).map(entry => supplyLine(world, entry, language))];
}

/** Original compact foliage silhouette; ripe fruit is visible without opening a panel. */
export function drawFoodPlant(ctx: CanvasRenderingContext2D, entity: Entity): void {
  const plant = entity.components.foodPlant!;
  ctx.fillStyle = '#684d34'; ctx.fillRect(-1, -3, 2, 4);
  ctx.fillStyle = '#385c39'; ctx.fillRect(-6, -7, 12, 6); ctx.fillRect(-4, -10, 8, 3);
  ctx.fillStyle = '#749b4b'; ctx.fillRect(-4, -9, 5, 3); ctx.fillRect(-5, -6, 3, 2);
  if (plant.remaining) {
    ctx.fillStyle = plant.good === 'berries' || plant.good === 'evilBeets' ? '#c34c68'
      : ['lemons', 'bananas', 'grain'].includes(plant.good) ? '#f0d76b' : plant.good === 'peppers' ? '#ec703e'
      : plant.good === 'candy' ? '#eeb7df' : plant.good === 'snowCucumbers' ? '#d2e6ea' : '#c0aa77';
    for (const [x, y] of [[-4, -5], [1, -7], [3, -4]]) ctx.fillRect(x, y, 2, 2);
  }
}
