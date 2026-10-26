import type { Registry } from './registry';
import { validFoodGoods } from '../core/resources';
import { GOLD } from '../core/gold';
import { HARBOR_ID, SHIP_ID, canSail, harborSite } from '../core/seafaring';
import { integer, number, point, record, reference } from '../core/validation';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../core/types';
import { buildHarbor, seafaring } from '../systems/seafaring';

export function registerSeafaring(registry: Registry): void {
  registry.registerComponent('harbor', v => reference(v.villageId) && integer(v.direction, 0, 3)
    && number(v.built, 0, 1) && number(v.launchIn, 0, 60));
  registry.registerComponent('ship', v => ['fishing', 'trade'].includes(String(v.kind)) && reference(v.homeId) && reference(v.targetId)
    && (v.cargoOwnerId === undefined || integer(v.cargoOwnerId, 1)) && (v.targetOwnerId === undefined || reference(v.targetOwnerId))
    && (v.goldVoyage === undefined || v.kind === 'trade' && record(v.goldVoyage) && integer(v.goldVoyage.fromId, 1)
      && integer(v.goldVoyage.toId, 1) && v.goldVoyage.fromId !== v.goldVoyage.toId && integer(v.goldVoyage.departed)
      && typeof v.goldVoyage.settled === 'boolean' && integer(v.goldVoyage.income, 0, GOLD.tradeIncome)
      && (v.goldVoyage.settled || v.goldVoyage.income === 0))
    && number(v.heading, -Math.PI, Math.PI) && number(v.speed, 0, 3) && number(v.turn, -1, 1) && number(v.sail, 0, 1)
    && ['docked', 'sailing', 'fishing', 'returning', 'idle'].includes(String(v.phase)) && number(v.wait, 0, 30) && number(v.cargo, 0, 24) && validFoodGoods(v.foodGoods, Number(v.cargo))
    && Array.isArray(v.path) && v.path.length <= WORLD_WIDTH * WORLD_HEIGHT && v.path.every(point) && integer(v.next, 0, v.path.length)
    && Array.isArray(v.wake) && v.wake.length <= 24 && v.wake.every(p => record(p) && point(p) && number(p.heading, -Math.PI, Math.PI) && number(p.age, 0, 3)));
  registry.registerEntity({ id: HARBOR_ID, sprite: 'harbor', required: ['position', 'harbor', 'health'], create: p => ({
    position: { ...p }, harbor: { villageId: null, direction: 0, built: 0, launchIn: 2 },
    health: { current: 320, max: 320 }, solid: { radius: 1.1 }, combustible: { fuel: 120, ignition: 42 },
    thermal: { temperature: 0, wetness: 0, burning: false },
  }) });
  registry.registerEntity({ id: SHIP_ID, sprite: 'ship', required: ['position', 'ship', 'health'], create: (p, rng) => ({
    position: { ...p }, health: { current: 180, max: 180 }, combustible: { fuel: 65, ignition: 40 },
    thermal: { temperature: 0, wetness: 0, burning: false },
    ship: { kind: 'fishing', homeId: null, targetId: null, heading: rng.range(-Math.PI, Math.PI), speed: 0, turn: 0, sail: 0,
      phase: 'idle', wait: 0, cargo: 0, path: [], next: 0, wake: [] },
  }) });
  registry.registerTool({ id: HARBOR_ID, label: 'Harbor', hint: 'Place a harbor on an open coast. Coastal villages also build harbors and launch fishing and trade ships.',
    category: 'buildings', icon: 'harbor', color: '#e1bc76', radius: 3, canApply: (w, p) => harborSite(w, { x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5 }) !== undefined,
    apply: (world, p) => {
      const position = { x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5 };
      if (harborSite(world, position) === undefined) return 'Choose an open coast with room for a pier';
      if (!world.society.villages.some(v => Math.hypot(v.x - p.x, v.y - p.y) < 24)) return 'Place a harbor near a settlement';
      if (!buildHarbor(world, position)) return 'Choose an open coast with room for a pier';
    } });
  registry.registerTool({ id: SHIP_ID, label: 'Ship', hint: 'Launch a sailboat in open water. Ships fish and return to nearby harbors; larger ships trade between settlements.',
    category: 'buildings', icon: 'ship', color: '#d9edf1', radius: 2.6, canApply: canSail,
    apply: (world, p) => {
      if (!canSail(world, p)) return 'Choose open water away from the shore';
      if (!world.spawn(SHIP_ID, p)) return 'Too many objects in the world';
    } });
  registry.registerSystem({ id: 'core:seafaring', after: ['core:diplomacy'], before: ['core:caravans'], update: seafaring });
}
