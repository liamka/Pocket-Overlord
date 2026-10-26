import { foodAt } from '../core/food';
import type { Registry } from './registry';
import { releaseBehaviourClaims, type TaskContext, type TaskDefinition, type TaskStage } from '../core/behaviour';
import { clearStorageApproach, storageOwner } from '../core/stockpiles';
import { atWar } from '../systems/society';
import { attackReach, combatStopped } from '../systems/equipment';
import { hasPhysiology } from '../core/physiology';

const available = ({ world, entity, state }: TaskContext): boolean => {
  const c = entity.components.citizen;
  return world.entities.get(entity.id) === entity && !!c && c.familyActionAt !== world.tick && !c.emergency && !entity.components.thermal?.burning
    && (!entity.components.health || entity.components.health.current > 0)
    && (state.targetId === null || world.entities.has(state.targetId))
    && (state.ownerId === null || world.society.villages.some(v => v.id === state.ownerId));
};
const target = ({ world, state }: TaskContext) => world.entities.get(state.targetId ?? -1);
const near = (context: TaskContext, reach: number): boolean => {
  const p = context.entity.components.position, q = target(context)?.components.position;
  return !!p && !!q && Math.hypot(p.x - q.x, p.y - q.y) <= reach;
};
const worker = (context: TaskContext): boolean => {
  const { world, entity, state } = context, c = entity.components.citizen!, p = entity.components.position;
  return available(context) && !!p && world.terrain.isLand(p.x, p.y) && c.targetId === state.targetId
    && (c.task === 'deliver' ? (c.work?.cargo?.villageId ?? (target(context) ? storageOwner(target(context)!) : null)) === state.ownerId : c.villageId === state.ownerId);
};
const delivery = (context: TaskContext): boolean => worker(context) && context.entity.components.citizen!.task === 'deliver'
  && !!target(context) && storageOwner(target(context)!) === context.state.ownerId;
const gather = (context: TaskContext): boolean => worker(context) && context.entity.components.citizen!.task === 'work';
const build = (context: TaskContext): boolean => worker(context) && context.entity.components.citizen!.task === 'build' && !!target(context)?.components.building?.project;
const eat = (context: TaskContext): boolean => worker(context) && context.entity.components.citizen!.task === 'eat'
  && !!target(context) && !!context.world.society.villages.find(v => v.id === context.state.ownerId
    && foodAt(context.world, context.entity, v, target(context)!));
const fight = (context: TaskContext): boolean => {
  const c = context.entity.components.citizen!, t = target(context);
  return worker(context) && c.task === 'fight' && !!t && !combatStopped(context.entity)
    && (t.components.health?.current ?? 0) > 0 && atWar(context.world, c.villageId, t.components.citizen?.villageId ?? t.components.dwelling?.villageId ?? null);
};
const atStorage = (context: TaskContext): boolean => !!target(context) && clearStorageApproach(context.world, context.entity.components.position!, target(context)!,
  context.entity.components.citizen?.task === 'deliver' && hasPhysiology(context.entity, 'good-throwers') ? 8.1 : 2.1);
const stage = (id: string, label: string, guard: TaskStage['canStart']): TaskStage => ({
  id, label, canStart: guard, canContinue: guard, complete: (_context, effect) => effect(), cancel: releaseBehaviourClaims,
});
const shoreStage = (id: string, label: string): TaskStage => ({
  ...stage(id, label, c => !!c.entity.components.motion && !!c.entity.components.position),
  complete: (c, effect) => c.world.terrain.isLand(c.entity.components.position!.x, c.entity.components.position!.y) && effect(),
});
const carry = stage('carry', 'Carrying supplies to storage', delivery), unload = stage('unload', 'Unloading supplies', c => delivery(c) && atStorage(c));
export const BEHAVIOUR_TASKS: readonly TaskDefinition[] = [
  { id: 'gather', label: 'Gathering supplies', stages: [stage('approach', 'Approaching the source', gather), stage('extract', 'Extracting supplies', c => gather(c) && near(c, 2.1)), carry, unload] },
  { id: 'delivery', label: 'Delivering supplies', stages: [carry, unload] },
  { id: 'construction', label: 'Building', stages: [stage('approach', 'Approaching the building site', build), stage('construct', 'Working on the building', c => build(c) && atStorage(c))] },
  { id: 'eating', label: 'Eating', stages: [stage('approach', 'Going to eat', eat), stage('consume', 'Eating a meal', c => eat(c) && atStorage(c))] },
  { id: 'combat', label: 'Fighting', stages: [stage('approach', 'Approaching the opponent', fight), stage('strike', 'Attacking the opponent', c => fight(c) && near(c, attackReach(c.world, c.entity, target(c))))] },
  { id: 'swim_to_island', label: 'Swimming to safety', stages: [shoreStage('find-shore', 'Looking for a safe shore'), shoreStage('swim', 'Swimming towards the shore')] },
  ...([['wait', 1, 1], ['wait5', 1, 5], ['wait10', 1, 10], ['random_wait_short_1', 0.1, 0.1]] as const).map(([id, min, max]): TaskDefinition => ({
    id, label: 'Waiting', waitSeconds: [min, max], stages: [stage('wait', 'Waiting before the next action', c => available(c) && c.entity.components.citizen!.task === 'idle')],
  })),
];

/** Published IDs only: WIP entries are not executable aliases for unrelated systems. */
export const BEHAVIOUR_CATALOG = [
  ['movement', 'random_move move_from_block swim_to_island check_if_stuck_on_small_land random_animal_move random_move_towards_civ_building random_swim city_idle_walking city_idle_walking_to_danger_zone farmer_random_move run_away_from_carnivore'],
  ['citizenship', 'check_join_city check_join_empty_nearby_city become_citizen end_job check_end_job check_city_destroyed build_city_here nomad_try_build_city citizen find_city_job try_to_return_home settler_same_island'],
  ['production', 'look_for_animals make_items cleaning put_out_fire build_new_building build_road collect_fruits collect_herbs chop_trees mine_deposit farmer_make_field farmer_plant_crops farmer_harvest mine'],
  ['army', 'fight check_warrior_limit warrior_check_city_army_group warrior_army_leader_move_random warrior_army_leader_move_to_attack_target warrior_army_follow_leader'],
  ['transport', 'check_warrior_transport embark_into_boat sit_inside_boat settler_check_transport'],
  ['special', 'pollinate print_start print_step tornado_move tornado_resize tornado_grow tornado_shrink tornado_split worm_move sandspider_move ant_black_island ant_black_sand ant_red_move ant_blue_move ant_green_move try_affect_dreams'],
  ['waiting', 'random_wait_short_1 wait wait5 wait10'],
].flatMap(([group, ids]) => ids.split(' ').map(id => ({ id, group,
  support: ['fight', 'swim_to_island'].includes(id) ? 'adapted' : ['wait', 'wait5', 'wait10', 'random_wait_short_1'].includes(id) ? 'implemented' : 'unavailable',
  taskId: id === 'fight' ? 'combat' : BEHAVIOUR_TASKS.some(t => t.id === id) ? id : null,
  alias: id === 'build_city_here' ? 'build_civ_city_here' : id === 'try_to_return_home' ? 'try_to_return_to_home_city' : null,
})));

export function registerBehaviour(registry: Registry): void {
  for (const definition of BEHAVIOUR_TASKS) registry.registerTask(definition);
}
