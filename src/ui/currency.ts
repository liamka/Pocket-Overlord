import { CURRENCY, mealExemption, taxRate, type MoneyEntry } from '../core/currency';
import { stockOf } from '../core/resource-ledger';
import { GOLD } from '../core/gold';
import { residentName } from '../core/village-life';
import type { Entity, Village } from '../core/types';
import type { World } from '../core/world';
import { translate, type Language } from '../i18n';
import { calendarDate } from './calendar';

const escape = (text: string): string => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const signed = (n: number): string => n > 0 ? `+${n}` : String(n);
function entryLine(world: World, entry: MoneyEntry, id: number, language: Language): string {
  const actor = entry.actorId === id, loot = actor ? entry.loot : entry.otherLoot, money = actor ? entry.money : entry.otherMoney;
  const counterpart = actor ? entry.targetId : entry.actorId;
  return `${calendarDate(entry.tick, language)} · ${translate('money:' + entry.reason, language)} · ${translate('Untaxed income', language)} ${signed(loot)} · ${translate('Coins', language)} ${signed(money)}${counterpart === null ? '' : ` · ${residentName(counterpart, world)}`}`;
}
export function currencyInspector(world: World, entity: Entity, language: Language, open: boolean): string {
  const c = entity.components.citizen;
  if (!c) return '';
  const w = c.wallet, tr = (s: string, values?: Record<string, string | number>): string => escape(translate(s, language, values));
  const exemption = mealExemption(world, entity);
  const village = world.society.villages.find(v => v.id === c.villageId);
  const history = world.moneyHistory.filter(e => e.actorId === entity.id || e.targetId === entity.id).slice(-6).reverse();
  return `<section data-money><p><strong>${tr('Personal funds')}:</strong> ${tr('Coins')} ${w?.money ?? 0} · ${tr('Untaxed income')} ${w?.loot ?? 0}</p>
    ${village ? currencyVillageLines(world, village, language).map(line => `<p>${escape(line)}</p>`).join('') : ''}
    <p>${exemption ? tr('meal:' + exemption) : tr('Meal costs {cost} coins; no credit', { cost: CURRENCY.meal })}</p>
    ${!exemption && (w?.money ?? 0) < CURRENCY.meal ? `<p>${tr('Not enough coins; emergency food is free at 90% hunger')}</p>` : ''}
    ${w ? `<p>${tr('Next income settlement: {date}', { date: calendarDate(w.taxAfter, language) })}</p>` : ''}
    <details data-money-history${open ? ' open' : ''}><summary>${tr('Recent payments')}</summary>${history.length ? history.map(e => `<p>${escape(entryLine(world, e, entity.id, language))}</p>`).join('') : `<p>${tr('No payments yet')}</p>`}</details></section>`;
}
export function currencyVillageLines(world: World, village: Village, language: Language): string[] {
  const shipments = [...world.query('caravan')].filter(e => e.components.caravan!.fromId === village.id);
  return [translate('Village treasury (mineral gold): {gold} · Personal income tax: {rate}%', language, { gold: stockOf(village, 'gold'), rate: taxRate(village) }),
    translate('Recruitment needs more than {gold} gold and {food} food; gold is not spent', language, { gold: GOLD.recruitThreshold, food: GOLD.recruitFood }),
    translate('Gold is a mineral stock, separate from personal coins', language),
    translate('Food in transit: {food} · Gems: {gems} · Departure wait: {seconds}s', language, {
      food: Math.floor(shipments.reduce((n, e) => n + e.components.caravan!.food, 0)),
      gems: shipments.reduce((n, e) => n + (e.components.caravan!.gems ?? 0), 0),
      seconds: Math.ceil(Math.max(0, (village.economy?.supplyAfter ?? 0) - world.tick) / 30),
    })];
}
