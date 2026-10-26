import { validWallet } from '../persistence/currency';
import { validReproduction } from '../persistence/reproduction';
import { validSubspeciesMember } from '../persistence/subspecies';
import { validTraits } from '../persistence/traits';
import { validStats } from '../persistence/unit-stats';
import { validStatuses } from '../persistence/status-effects';
import { validHappiness } from '../persistence/happiness';
import { ROAD_REPAIR_SECONDS, WORLD_WIDTH, WORLD_HEIGHT, type CoreComponents } from '../core/types';
import { bool, integer, number, point, record, reference, type Validator } from '../core/validation';
import { isRace } from '../core/races';
import { validIntegration, validWork } from './village-life';
import { PLAGUE } from '../core/afflictions';
import { validFoodGoods } from '../core/resources';
import { validBehaviour } from '../persistence/behaviour';
import { validNeurons } from '../persistence/neurons';
import { validJob, validJobProblem, validProfession } from '../core/jobs';
import { validKinship } from '../persistence/families';
import { validDamageContext } from '../core/death';
import { TEMPERATURE, validThermalChange } from '../core/temperature';

export const componentValidators: Record<keyof CoreComponents | 'traits' | 'reproduction', Validator> = {
  subspecies: validSubspeciesMember,
  reproduction: validReproduction,
  happiness: validHappiness,
  kinship: validKinship,
  stats: validStats,
  traits: validTraits,
  statuses: validStatuses,
  position: point,
  health: v => number(v.current, 0, 1e6) && number(v.max, 0.001, 1e6) && Number(v.current) <= Number(v.max),
  combustible: v => number(v.fuel, 0, 1e6) && number(v.ignition, 0, 1e6),
  thermal: v => number(v.temperature, TEMPERATURE.bodyCold, TEMPERATURE.cellMax) && number(v.wetness, 0, 1) && bool(v.burning) && validThermalChange(v.lastChange)
    && (v.ignition === undefined || validDamageContext(v.ignition, true) && record(v.ignition) && v.ignition.cause === 'fire'),
  motion: v => number(v.vx) && number(v.vy) && number(v.speed, 0, 100) && number(v.heading) && number(v.decisionIn),
  person: v => (v.race === undefined || isRace(v.race)) && number(v.age, 0, 1e8) && ['a', 'b'].includes(String(v.sex)) && (v.homeId === null || integer(v.homeId, 1)) && number(v.buildIn) && number(v.reproduceIn)
    && (v.plague === undefined || record(v.plague) && number(v.plague.age, 0, 1e8) && number(v.plague.spreadIn, 0, PLAGUE.interval))
    && (v.madness === undefined || record(v.madness) && number(v.madness.age, 0, 1e8))
    && (v.animation === undefined || record(v.animation) && number(v.animation.stride, 0, Math.PI * 2) && number(v.animation.moving, 0, 1)
      && number(v.animation.heading, -Math.PI, Math.PI) && number(v.animation.work, 0, 1))
    && (v.displaced === undefined || record(v.displaced) && integer(v.displaced.homeId, 1) && integer(v.displaced.since) && v.homeId === null),
  citizen: v => reference(v.villageId) && reference(v.partnerId) && Array.isArray(v.parents) && v.parents.length <= 2 && v.parents.every(id => integer(id, 1))
    && (v.wallet === undefined || validWallet(v.wallet))
    && validProfession(v.profession) && validJob(v.jobAssignment) && validJobProblem(v.jobProblem)
    && number(v.hunger, 0, 100) && number(v.pregnancy, 0, 8) && reference(v.fatherId) && (Number(v.pregnancy) === 0 || v.fatherId !== null) && ['idle', 'farm', 'eat', 'visit', 'socialize', 'fight', 'repair', 'build', 'migrate', 'work', 'deliver', 'tend', 'guard', 'equip'].includes(String(v.task))
    && (v.weapon === undefined || v.weapon === 'stone-axe')
    && validWork(v.work) && validIntegration(v.integration) && validBehaviour(v.behaviour) && validNeurons(v.neurons) && (v.reflectionAfter === undefined || integer(v.reflectionAfter)) && (v.familyActionAt === undefined || integer(v.familyActionAt)) && (v.service === undefined || number(v.service, 0, 1000))
    && (v.conversation === undefined || record(v.conversation) && integer(v.conversation.partnerId, 1) && integer(v.conversation.startedAt) && integer(v.conversation.contact, 0, 12))
    && reference(v.targetId) && Array.isArray(v.path) && v.path.length <= WORLD_WIDTH * WORLD_HEIGHT && v.path.every(point) && number(v.reconsiderIn) && number(v.attackIn, 0, 10)
    && (v.task === 'repair' ? v.targetId === null && record(v.repair) && integer(v.repair.tile, 0, WORLD_WIDTH * WORLD_HEIGHT - 1) && number(v.repair.remaining, 0.001, ROAD_REPAIR_SECONDS) : v.repair === null)
    && (v.emergency === undefined || record(v.emergency) && ['flee', 'extinguish', 'aid'].includes(String(v.emergency.kind))
      && (v.emergency.kind === 'flee' ? v.emergency.targetId === null : integer(v.emergency.targetId, 1))
      && Array.isArray(v.emergency.path) && v.emergency.path.length <= WORLD_WIDTH * WORLD_HEIGHT && v.emergency.path.every(point) && number(v.emergency.reconsiderIn)),
  dwelling: v => (v.race === undefined || isRace(v.race)) && integer(v.capacity, 1, 300) && reference(v.villageId) && (v.level === undefined || v.level === 2),
  ruin: v => isRace(v.race) && reference(v.villageId) && integer(v.homeId, 1) && integer(v.capacity, 1, 300) && integer(v.destroyedAt),
  farm: v => reference(v.villageId) && number(v.growth, 0, 1) && integer(v.harvests) && (v.grain === undefined || number(v.grain, 0, 2000)),
  caravan: v => integer(v.fromId, 1) && reference(v.toId) && v.toId !== v.fromId && number(v.food, 0, 12)
    && (v.gems === undefined || integer(v.gems, 0, 4) && (v.gems === 0 || v.food === 0))
    && validFoodGoods(v.foodGoods, Number(v.food))
    && Array.isArray(v.path) && v.path.length <= WORLD_WIDTH * WORLD_HEIGHT && v.path.every(point) && integer(v.next, 0, v.path.length)
    && (v.reroute === undefined || bool(v.reroute)) && bool(v.returning) && (v.toId !== null || v.returning === true) && number(v.retryIn, 0, 2),
  solid: v => number(v.radius, 0, 1.2),
  explosive: v => number(v.fuse, 0, 1e6) && number(v.radius, 0.1, 64) && number(v.power, 0, 1e6) && number(v.heat, 0, 1e6),
  projectile: v => number(v.remaining, 0, 1e6) && number(v.duration, 0.001, 1e6) && Number(v.remaining) <= Number(v.duration)
    && (v.heading === undefined || number(v.heading, 0, Math.PI * 2)),
  appearance: v => integer(v.variant, 0, 1e6),
};
