/** Leather, revision 20453. Costs, reserve and wear are Pocket Overlord balance. */
export const LEATHER_SOURCE = 'https://the-official-worldbox-wiki.fandom.com/wiki/Leather?oldid=20453';
export const LEATHER = { stockTarget: 3, breedingReserve: 2, huntRadius: 22, herdRadius: 8, wearPerHit: 1, bootsSpeed: 0.03 } as const;

/** Existing fire system owns ignition, damage and final loss of the finite pile. */
export const leatherRemainsFire = (leather: number) => ({
  thermal: { temperature: 0, wetness: 0, burning: false },
  combustible: { fuel: leather > 0 ? 6 : 0, ignition: 35 },
});
