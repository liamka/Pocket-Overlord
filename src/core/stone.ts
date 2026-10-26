export const STONE = {
  deposit: 24, batch: 4,
  houseCost: 8, houseWood: 2, houseCapacity: 7, houseHealth: 120,
  axeCost: 2, axeWood: 1, axeDamage: 4,
  work: 4, radius: 28, stockTarget: 24, hunger: 70, foodReserve: 2,
  carryWeight: 36, carryVolume: 24, claimTicks: 900,
} as const;

// Our balance: sword strikes faster, axe retains its old hit, hammer is slow, spear reaches farther.
export const STONE_WEAPONS = {
  'stone-sword': { inputs: { stone: 2, wood: 1 }, damage: 3, interval: 0.8 },
  'stone-axe': { inputs: { stone: STONE.axeCost, wood: STONE.axeWood }, damage: STONE.axeDamage, interval: 1 },
  'stone-hammer': { inputs: { stone: 3, wood: 1 }, damage: 6, interval: 1.6 },
  'stone-spear': { inputs: { stone: 1, wood: 2 }, damage: 3, interval: 1 },
} as const;
