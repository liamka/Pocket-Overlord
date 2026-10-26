import { canEatNow, consumeFood, nearbyMeal } from './food';
import { hasPhysiology, physiologyDiet } from './physiology';
import { MONTH_TICKS } from './calendar';
import { operational } from './buildings';
import { recordHappiness } from './happiness';
import { withdraw } from './resource-ledger';
import { type Diet } from './resources';
import { hasTrait } from './traits';
import { isAdult } from './unit-stats';
import type { Entity, Village } from './types';
import type { World } from './world';

/** Pocket Overlord balance. Gold remains a physical resource in the existing stores.
 * Work/household income mints loot; tax only transfers it; purchases retire coins.
 * No annual gold formula, credit, or conversion between gold and personal currency. */
export const CURRENCY = { limit: 1_000_000_000, history: 256, meal: 5, starving: 90,
  period: MONTH_TICKS, socialPeriod: 3 * MONTH_TICKS } as const;
export const TAX_RATES = [20, 50, 70] as const;
export type TaxRate = typeof TAX_RATES[number];
export const MONEY_REASONS = ['construction', 'road', 'farming', 'gathering', 'delivery', 'production', 'clearing',
  'housing', 'tax', 'meal', 'craft', 'repair', 'gift', 'theft', 'death'] as const;
export type MoneyReason = typeof MONEY_REASONS[number];
export type WageReason = 'construction' | 'road' | 'farming' | 'gathering' | 'delivery' | 'production' | 'clearing' | 'housing';
export interface Wallet {
  loot: number; money: number; taxAfter: number; homeAfter: number; socialAfter: number;
  /** Saved completion watermarks outlive the bounded history. At most one action per
   * reason/actor/tick; each caller commits its work/result in the same synchronous step. */
  completed: Partial<Record<MoneyReason, number>>;
}
export interface MoneyEntry {
  id: string; tick: number; reason: MoneyReason; actorId: number; targetId: number | null; villageId: number | null;
  loot: number; money: number; otherLoot: number; otherMoney: number;
}
export const newWallet = (tick: number): Wallet => ({ loot: 0, money: 0, taxAfter: tick + CURRENCY.period,
  homeAfter: tick + CURRENCY.period, socialAfter: tick + CURRENCY.socialPeriod, completed: {} });
export const walletOf = (world: World, entity: Entity): Wallet => entity.components.citizen!.wallet ??= newWallet(world.tick);
export const taxRate = (village: Village): TaxRate => village.economy?.taxRate ?? 50;
const alive = (world: World, e: Entity | undefined): e is Entity => !!e?.components.citizen
  && world.entities.get(e.id) === e && (e.components.health?.current ?? 0) > 0;
const room = (w: Wallet, amount: number): boolean => Number.isSafeInteger(amount) && amount >= 0
  && w.money + w.loot + amount <= CURRENCY.limit;
const fresh = (world: World, e: Entity, reason: MoneyReason): boolean => (walletOf(world, e).completed[reason] ?? -1) < world.tick;
function journal(world: World, actor: Entity, reason: MoneyReason, loot: number, money: number,
  target: Entity | undefined = undefined, otherLoot = 0, otherMoney = 0): void {
  walletOf(world, actor).completed[reason] = world.tick;
  world.moneyHistory.push({ id: `${reason}:${actor.id}:${world.tick}`, tick: world.tick, reason,
    actorId: actor.id, targetId: target?.id ?? null, villageId: actor.components.citizen!.villageId,
    loot, money, otherLoot, otherMoney });
  world.moneyHistory.splice(0, Math.max(0, world.moneyHistory.length - CURRENCY.history));
}
export function payWork(world: World, worker: Entity, reason: WageReason, amount = 1): boolean {
  if (world.paused || !alive(world, worker) || !Number.isSafeInteger(amount) || amount <= 0 || !fresh(world, worker, reason)) return false;
  const wallet = walletOf(world, worker);
  if (!room(wallet, amount)) return false;
  wallet.loot += amount; journal(world, worker, reason, amount, 0); return true;
}
/** Resolves the recipient at settlement time. Missing/dead/migrating leaders mean no tax. */
export function settleIncome(world: World, actor: Entity): boolean {
  if (world.paused || !alive(world, actor) || !fresh(world, actor, 'tax')) return false;
  const wallet = walletOf(world, actor), village = world.society.villages.find(v => v.id === actor.components.citizen!.villageId);
  if (!wallet.loot) return false;
  const candidate = world.entities.get(village?.government?.leaderId ?? -1);
  const leader = alive(world, candidate) && candidate.id !== actor.id && candidate.components.citizen!.villageId === village?.id
    && candidate.components.citizen!.task !== 'migrate' ? candidate : undefined;
  const rate = village ? taxRate(village) : 50;
  const tax = leader ? Math.floor(wallet.loot * rate / 100) : 0;
  // No disappearing overflow: postpone the whole settlement if the recipient is full.
  if (leader && !room(walletOf(world, leader), tax)) return false;
  const income = wallet.loot;
  wallet.loot = 0; wallet.money += income - tax;
  if (leader) walletOf(world, leader).loot += tax;
  journal(world, actor, 'tax', -income, income - tax, tax ? leader : undefined, tax);
  if (leader && tax) recordHappiness(world, actor, rate === 70 ? 'high-tax' : 'tax', leader);
  return true;
}
export function canSpend(world: World, actor: Entity, amount: number): boolean {
  return alive(world, actor) && Number.isSafeInteger(amount) && amount >= 0 && walletOf(world, actor).money >= amount;
}
/** Only call after revalidating the action's material/target conditions. No debts. */
export function spendMoney(world: World, actor: Entity, amount: number, reason: 'craft' | 'repair'): boolean {
  if (world.paused || !canSpend(world, actor, amount) || !fresh(world, actor, reason)) return false;
  walletOf(world, actor).money -= amount; journal(world, actor, reason, 0, -amount); return true;
}
export function mealExemption(world: World, actor: Entity): 'child' | 'leader' | 'starving' | undefined {
  if (!isAdult(actor)) return 'child';
  if (world.society.villages.some(v => v.id === actor.components.citizen?.villageId && v.government?.leaderId === actor.id)) return 'leader';
  if ((actor.components.citizen?.hunger ?? 0) >= CURRENCY.starving) return 'starving';
}
/** Payment and the existing food withdrawal commit together; failed payment takes no food.
 * A penniless adult can always eat once starving. Reassignment cannot renew an exemption. */
export function buyMeal(world: World, actor: Entity, village: Village, portions = 1, diet: Diet = physiologyDiet(actor)): number {
  if (!canEatNow(world, actor) || !alive(world, actor) || actor.components.citizen!.villageId !== village.id
    || actor.components.citizen!.hunger < 55 || !Number.isSafeInteger(portions) || portions < 1 || portions > 2 || !fresh(world, actor, 'meal')) return 0;
  const cost = mealExemption(world, actor) ? 0 : CURRENCY.meal;
  if (!canSpend(world, actor, cost)) { if (actor.components.food) actor.components.food.problem = 'Not enough money'; return 0; }
  const meal = nearbyMeal(world, actor, village, diet);
  if (!meal) { if (actor.components.food) actor.components.food.problem = 'Food is unreachable'; return 0; }
  // A second portion is optional; the first is never blocked by missing surplus.
  const amount = portions === 2 && withdraw(village, { [meal.good]: 2 }, 'consume', meal.building.id) ? 2
    : withdraw(village, { [meal.good]: 1 }, 'consume', meal.building.id) ? 1 : 0;
  if (!amount) return 0;
  walletOf(world, actor).money -= cost; journal(world, actor, 'meal', 0, -cost);
  consumeFood(world, actor, { [meal.good]: amount }); return amount;
}
function contact(world: World, a: Entity, b: Entity): boolean {
  const p = a.components.position, q = b.components.position;
  return !world.paused && alive(world, a) && alive(world, b) && a.id !== b.id && !!p && !!q
    && Math.hypot(p.x - q.x, p.y - q.y) <= 2.1;
}
export function giveMoney(world: World, giver: Entity, receiver: Entity, amount: number): boolean {
  if (!contact(world, giver, receiver) || !Number.isSafeInteger(amount) || amount <= 0 || !canSpend(world, giver, amount)
    || !room(walletOf(world, receiver), amount) || !fresh(world, giver, 'gift')) return false;
  walletOf(world, giver).money -= amount; walletOf(world, receiver).money += amount;
  journal(world, giver, 'gift', 0, -amount, receiver, 0, amount);
  recordHappiness(world, giver, 'gift-sent', receiver); recordHappiness(world, receiver, 'gift-received', giver); return true;
}
export function stealMoney(world: World, thief: Entity, victim: Entity): boolean {
  if (!contact(world, thief, victim) || !(hasTrait(thief, 'thief') || hasPhysiology(thief, 'shiny-love')) || !fresh(world, thief, 'theft')) return false;
  const from = walletOf(world, victim), to = walletOf(world, thief), amount = from.money + from.loot;
  if (!amount || !room(to, amount)) return false;
  const loot = from.loot, money = from.money; from.loot = from.money = 0; to.loot += amount;
  journal(world, thief, 'theft', amount, 0, victim, -loot, -money);
  recordHappiness(world, victim, 'robbed', thief); return true;
}
/** Called before references are removed. Without a living killer or heir, cash is lost;
 * it never becomes village gold, a second corpse reward, or a posthumous wallet. */
export function releaseMoney(world: World, actor: Entity, killerId?: number): void {
  const wallet = actor.components.citizen?.wallet;
  if (!wallet || !wallet.loot && !wallet.money) return;
  const c = actor.components.citizen!;
  const candidates = [world.entities.get(killerId ?? -1), world.entities.get(c.partnerId ?? -1),
    ...[...world.query('citizen')].filter(e => e.components.citizen!.parents.includes(actor.id))];
  const heir = candidates.find(e => alive(world, e) && e.id !== actor.id && room(walletOf(world, e), wallet.money + wallet.loot));
  const loot = wallet.loot, money = wallet.money; wallet.loot = wallet.money = 0;
  if (heir) { const next = walletOf(world, heir); next.loot += loot; next.money += money; }
  journal(world, actor, 'death', -loot, -money, heir, heir ? loot : 0, heir ? money : 0);
}
export function householdIncome(world: World, actor: Entity): number {
  const c = actor.components.citizen, home = world.entities.get(actor.components.person?.homeId ?? -1), p = home?.components.position;
  if (!c || !isAdult(actor) || c.task === 'migrate' || !home?.components.dwelling || !p || !operational(home)
    || home.components.thermal?.burning || home.components.dwelling.villageId !== c.villageId) return 0;
  const bonus = world.terrain.biomeAt(p.x, p.y).ecology.income;
  return Math.max(0, (home.components.dwelling.level ?? 1) + bonus);
}
/** Uses saved deadlines, coalesces missed cycles, and never consumes random numbers. */
export function currency(world: World): void {
  if (world.paused || world.tick % 30 !== 0) return;
  const leaders = new Set(world.society.villages.map(v => v.government?.leaderId));
  const residents = [...world.query('citizen')].filter(e => alive(world, e)).sort((a, b) => Number(leaders.has(a.id)) - Number(leaders.has(b.id)) || a.id - b.id);
  for (const actor of residents) {
    const w = walletOf(world, actor), c = actor.components.citizen!;
    if (world.tick >= w.homeAfter) { w.homeAfter = world.tick + CURRENCY.period; payWork(world, actor, 'housing', householdIncome(world, actor)); }
    if (world.tick >= w.taxAfter) { w.taxAfter = world.tick + CURRENCY.period; settleIncome(world, actor); }
    if (world.tick < w.socialAfter || !actor.components.position || c.emergency || actor.components.thermal?.burning) continue;
    const nearby = world.nearby(actor.components.position, 2.1).filter(e => e.id !== actor.id && alive(world, e)).sort((a, b) => a.id - b.id);
    let transferred = false;
    if ((hasTrait(actor, 'thief') || hasPhysiology(actor, 'shiny-love')) && c.hunger >= 55 && w.money < CURRENCY.meal) transferred = nearby.some(e => stealMoney(world, actor, e));
    else if (c.task === 'socialize' && w.money >= 10) {
      const friend = nearby.find(e => e.id === c.partnerId || e.id === actor.components.unit?.bestFriendId);
      if (friend) transferred = giveMoney(world, actor, friend, Math.max(1, Math.floor(w.money * 0.05)));
    }
    if (transferred) w.socialAfter = world.tick + CURRENCY.socialPeriod;
  }
}
