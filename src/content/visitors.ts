import type { Registry } from './registry';
import { SHIP_ID } from '../core/seafaring';
import { HUNTER_ID, VISITORS, VISITORS_ID, VISITOR_SHIP_ID, type VisitorSchedule } from '../core/visitors';
import { integer, number, point, record, reference } from '../core/validation';
import { validBundle } from '../core/resources';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../core/types';
import { visitors } from '../systems/visitors';

export function registerVisitors(registry: Registry): void {
  registry.registerComponent('foreignVoyage', v => ['merchants', 'hunters'].includes(String(v.kind))
    && ['arriving', 'visiting', 'departing'].includes(String(v.phase)) && point(v.entry) && point(v.berth) && point(v.shore)
    && reference(v.portId) && reference(v.villageId) && reference(v.monsterId) && validBundle(v.goods, 100) && validBundle(v.purchases, 100)
    && number(v.wait, 0, VISITORS.stay) && number(v.retryIn, 0, 5) && integer(v.leaveAt)
    && typeof v.traded === 'boolean');
  registry.registerComponent('monsterHunter', v => reference(v.shipId) && reference(v.targetId) && point(v.exit)
    && typeof v.returning === 'boolean' && typeof v.moving === 'boolean'
    && Array.isArray(v.path) && v.path.length <= WORLD_WIDTH * WORLD_HEIGHT && v.path.every(point)
    && number(v.rethink, 0, 2) && number(v.cooldown, 0, VISITORS.attackDelay) && number(v.heading, -Math.PI, Math.PI)
    && number(v.stride, 0, Math.PI * 2) && validBundle(v.loot, 30));
  const ship = registry.entities.get(SHIP_ID)!;
  registry.registerEntity({ id: VISITOR_SHIP_ID, sprite: 'ship', create: (p, rng) => ({
    ...ship.create(p, rng),
    foreignVoyage: { kind: 'merchants', phase: 'arriving', entry: { ...p }, berth: { ...p }, shore: { ...p },
      portId: null, villageId: null, monsterId: null, goods: {}, purchases: {}, wait: 0, retryIn: 0,
      leaveAt: 0, traded: false },
  }) });
  registry.registerEntity({ id: HUNTER_ID, sprite: 'person', create: p => ({
    position: { ...p }, health: { current: 160, max: 160 }, combustible: { fuel: 20, ignition: 35 },
    thermal: { temperature: 0, wetness: 0, burning: false },
    monsterHunter: { shipId: null, targetId: null, returning: false, exit: { ...p }, path: [], rethink: 0,
      cooldown: 0, heading: 0, stride: 0, moving: false, loot: {} },
  }) });
  registry.registerScenario<VisitorSchedule>({ id: VISITORS_ID,
    create: world => ({ tradeAt: world.tick + VISITORS.firstTrade, huntAt: world.tick }),
    validate: (v): v is VisitorSchedule => record(v) && integer(v.tradeAt) && integer(v.huntAt), update: () => {},
  });
  registry.registerSystem({ id: 'core:visitors', after: ['core:seafaring'], before: ['core:caravans'], update: visitors });
}
