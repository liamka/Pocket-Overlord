export const GOLD_SOURCE = 'https://the-official-worldbox-wiki.fandom.com/wiki/Economy?oldid=22956';
/** Pocket Overlord balance, not the obsolete annual-tax formula. Gold is a stored
 * mineral. Recruitment checks a reserve and never withdraws it. Basic housing,
 * food production and the first store remain possible before finding gold. */
export const GOLD = {
  deposit: 20, stockTarget: 20, recruitThreshold: 10, recruitFood: 1,
  tradeIncome: 5, biologicalPeriod: 1800, biologicalChance: 0.2,
  building: { market: 5, mill: 5, harbor: 6, houseUpgrade: 5 },
} as const;
