export const BONE_SOURCE = 'https://the-official-worldbox-wiki.fandom.com/wiki/Bone?oldid=14179';
// Pocket Overlord balance: six mixed lots per deposit, two minutes to gather remains.
// Creature yields use Category:Resources, not the old Bone article's 50% roll.
export const BONE = { deposit: 18, stockTarget: 3, spacing: 400, seedSalt: 0xb04e, remainsTicks: 3600 } as const;
