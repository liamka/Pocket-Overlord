import { CURRENCY, MONEY_REASONS, newWallet, TAX_RATES, type MoneyEntry } from '../core/currency';
import { EQUIPMENT } from '../core/equipment-catalog';
import { integer, record, reference, type RecordValue } from '../core/validation';
import type { WorldSnapshot } from '../core/types';

export function validWallet(value: unknown, tick = Number.MAX_SAFE_INTEGER): boolean {
  return record(value) && integer(value.loot, 0, CURRENCY.limit) && integer(value.money, 0, CURRENCY.limit)
    && value.loot + value.money <= CURRENCY.limit && integer(value.taxAfter) && integer(value.homeAfter) && integer(value.socialAfter)
    && record(value.completed) && Object.entries(value.completed).every(([key, at]) => MONEY_REASONS.includes(key as never) && integer(at, 0, tick));
}
export function migrateCurrency(save: RecordValue): RecordValue {
  if (!Array.isArray(save.entities) || !integer(save.tick)) throw new Error('Invalid saved currency');
  for (const entity of save.entities) if (record(entity) && record(entity.components) && record(entity.components.citizen))
    entity.components.citizen.wallet = newWallet(save.tick);
  // Existing orders keep their inputs, progress and paid result; no retroactive charge.
  if (record(save.crafting) && Array.isArray(save.crafting.orders)) for (const order of save.crafting.orders)
    if (record(order) && typeof order.recipe === 'string' && Object.hasOwn(EQUIPMENT, order.recipe)) order.coins = EQUIPMENT[order.recipe].recipe.coins;
  return { ...save, version: 64, moneyHistory: [] };
}
export function validCurrencySave(save: WorldSnapshot): boolean {
  if (!Array.isArray(save.moneyHistory) || save.moneyHistory.length > CURRENCY.history) return false;
  for (const e of save.entities) if (e.components.citizen) {
    const wallet = e.components.citizen.wallet;
    if (!validWallet(wallet, save.tick) || !wallet || wallet.taxAfter > save.tick + CURRENCY.period
      || wallet.homeAfter > save.tick + CURRENCY.period || wallet.socialAfter > save.tick + CURRENCY.socialPeriod) return false;
  }
  for (const v of save.society.villages) {
    const e = v.economy;
    if (e?.taxRate !== undefined && !TAX_RATES.includes(e.taxRate)
      || e?.supplyAfter !== undefined && !integer(e.supplyAfter)
      || !integer(e?.stocks.gold ?? 0, 0, 2000)
      || e?.storage?.some(s => !integer(s.goods.gold ?? 0, 0, 2000))) return false;
  }
  const ids = new Set<string>();
  let last = -1;
  for (const entry of save.moneyHistory) {
    const e: unknown = entry;
    if (!record(e) || !integer(e.tick, last, save.tick) || !MONEY_REASONS.includes(e.reason as never)
      || !integer(e.actorId, 1, save.nextEntityId - 1) || !reference(e.targetId)
      || e.targetId !== null && (!integer(e.targetId, 1, save.nextEntityId - 1) || e.targetId === e.actorId)
      || !reference(e.villageId) || e.villageId !== null && !integer(e.villageId, 1, save.society.nextVillageId - 1)
      || e.id !== `${e.reason}:${e.actorId}:${e.tick}` || ids.has(String(e.id))
      || !['loot', 'money', 'otherLoot', 'otherMoney'].every(key => integer(e[key], -CURRENCY.limit, CURRENCY.limit))) return false;
    const row = e as unknown as MoneyEntry;
    if (row.targetId === null && (row.otherLoot || row.otherMoney)) return false;
    if (['tax', 'gift', 'theft'].includes(row.reason) && row.loot + row.money + row.otherLoot + row.otherMoney !== 0) return false;
    const actor = save.entities.find(actor => actor.id === row.actorId);
    if (actor?.components.citizen && (actor.components.citizen.wallet!.completed[row.reason] ?? -1) < row.tick) return false;
    last = row.tick; ids.add(row.id);
  }
  return true;
}
