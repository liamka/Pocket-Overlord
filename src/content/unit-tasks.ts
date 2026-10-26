import type { Registry } from './registry';
import { releaseBehaviourClaims, type TaskContext, type TaskStage } from '../core/behaviour';
import { canReflect } from '../core/unit-tasks';
import { operational } from '../core/buildings';
import { recordHappiness } from '../core/happiness';

const stage = (id: string, label: string, guard: (context: TaskContext) => boolean): TaskStage => ({
  id, label, canStart: guard, canContinue: guard, complete: (_context, effect) => effect(), cancel: releaseBehaviourClaims,
});
const migrating = ({ world, entity }: TaskContext): boolean => world.entities.get(entity.id) === entity
  && entity.components.citizen?.task === 'migrate' && !entity.components.citizen.emergency && !entity.components.thermal?.burning
  && world.society.migrations.some(group => group.members.includes(entity.id));

export function registerUnitTasks(registry: Registry): void {
  const atHome = ({ world, entity }: TaskContext): boolean => {
    const c = entity.components.citizen, p = entity.components.position;
    const home = world.entities.get(entity.components.person?.homeId ?? -1), q = home?.components.position;
    return !!c && !!p && !!home && !!q && c.task === 'visit' && c.targetId === home.id && c.hunger < 55
      && !c.emergency && !entity.components.thermal?.burning && !home.components.thermal?.burning && operational(home)
      && Math.hypot(p.x - q.x, p.y - q.y) < 2.4;
  };
  registry.registerTask({ id: 'home_rest', label: 'Resting at home', priority: 0, waitSeconds: [3, 6], stages: [
    { ...stage('rest', 'Resting at home', atHome), complete: ({ world, entity }, effect) => {
      if (!effect()) return false;
      const c = entity.components.citizen!, home = world.entities.get(entity.components.person!.homeId!);
      recordHappiness(world, entity, 'rest', home);
      c.task = 'idle'; c.targetId = null; c.reconsiderIn = 0;
      return true;
    } },
  ] });
  registry.registerTask({ id: 'reflection', label: 'Reflecting', priority: 0, waitSeconds: [1, 5], stages: [
    stage('wait', 'Taking a quiet moment', canReflect), stage('happy_laughing', 'Laughing', canReflect), stage('crying', 'Crying', canReflect),
    stage('singing', 'Singing', canReflect), stage('play_jump', 'Playing: jumping', canReflect),
    stage('play_spin', 'Playing: spinning', canReflect), stage('play_dance', 'Playing: dancing', canReflect), stage('tantrum', 'Tantrum', canReflect),
  ] });
  registry.registerTask({ id: 'migration', label: 'Migrating', priority: 40, stages: [
    stage('travel', 'Travelling to the new home', migrating), stage('boarding', 'Waiting to board', migrating),
    stage('crossing', 'Crossing by ferry', migrating), stage('waiting', 'Waiting for the household', migrating),
    stage('settle', 'Moving into the new home', c => migrating(c) && c.world.society.migrations.some(group => {
      const p = c.entity.components.position;
      return group.members.includes(c.entity.id) && !!p && c.world.terrain.isLand(p.x, p.y) && Math.hypot(p.x - group.destination.x, p.y - group.destination.y) <= 3.2;
    })),
  ] });
}

export interface UnitTaskCatalogEntry {
  id: string;
  group: string;
  /** Exclusive owner of the operation, including future integrations. */
  owner: string;
  support: 'adapted' | 'unavailable';
  behaviour: string | null;
}

// Source identifiers are catalogue entries, never empty executable handlers.
const groups: readonly (readonly [string, string, string])[] = [
  ["Init", "existing systems / future element owner", "nothing|fighting|move_from_block|swim_to_island|move_to_water|check_if_stuck_on_small_land|pollinate|bee_find_hive|bee_create_hive|random_move|random_fun_move|run_away|run_away_from_carnivore|print_start|print_step|worm_move|sandspider_move|ant_black_island|ant_black_sand|ant_red_move|ant_blue_move|ant_green_move|random_wait_short_1|investigate_curiosity|random_animal_move|random_move_towards_civ_building|stay_in_random_house|stay_in_own_home|generate_loot|random_swim|make_decision|try_new_plot|check_plot|progress_plot|try_to_eat_city_food|find_house|random_move_near_house|end_job|check_end_job|check_city_destroyed|build_civ_city_here|try_to_start_new_civilization|check_join_city|try_to_read|citizen|try_to_take_city_item|city_idle_walking|city_walking_to_danger_zone|find_city_job|give_tax|do_hunting|make_items|cleaning|manure_cleaning|put_out_fire|try_build_building|build_building|build_road|collect_fruits|collect_honey|claim_land|collect_herbs|chop_trees|mine_deposit|farmer_make_field|farmer_plant_crops|farmer_harvest|farmer_fertilize_crops|farmer_random_move|store_resources|mine|try_to_return_to_home_city|force_into_a_boat|embark_into_boat|sit_inside_boat|wait|wait5|wait10|replenish_energy|repair_equipment"],
  ["ThinkingReflectionHappiness", "reflection", "try_to_steal_money|reflection|madness_random_emotion|happy_laughing|singing|swearing|crying|possessed_following|start_tantrum|do_tantrum|punch_a_tree|punch_a_building|start_fire"],
  ["ClanLeader", "clans (plan 64)", "kill_unruly_clan_members|banish_unruly_clan_members"],
  ["Poop", "food (plan 52)", "try_to_poop|try_to_launch_fireworks|poop_inside|poop_outside"],
  ["Sleep", "sleep owner", "decide_where_to_sleep|sleep_inside|sleep_outside"],
  ["Kings", "rulers (plan 66)", "king_check_new_city_foundation|king_change_kingdom_language|king_change_kingdom_culture|king_change_kingdom_religion"],
  ["Warriors", "army owner", "warrior_random_move|warrior_army_captain_idle_walking_city|warrior_army_captain_waiting|check_warrior_limit|warrior_try_join_army_group|warrior_army_leader_move_random|warrior_army_leader_move_to_attack_target|warrior_army_follow_leader|check_warrior_transport|warrior_train_with_dummy"],
  ["Leaders", "settlement governance", "leader_change_city_language|leader_change_city_culture|leader_change_city_religion"],
  ["StatusRelated", "status effects (plan 28)", "strange_urge_finish|status_confused|status_soul_harvested"],
  ["Mobs", "species owner; herd membership: families (plan 23)", "diet_tiles|diet_wood|diet_minerals|diet_fruits|diet_vegetation|diet_flowers|diet_nectar|diet_crops|diet_grass|diet_meat|diet_blood|diet_meat_insect|diet_same_species|diet_algae|diet_fish|family_alpha_move|family_group_follow|family_check_existence|family_group_leave|family_group_join_or_new_herd|follow_desire_target|crab_eat|crab_danger_check|crab_burrow|make_skeleton|skeleton_move|spawn_fertilizer|check_cure|burn_tumors|check_heal|random_teleport|teleport_back_home|run_to_water_when_on_fire|short_move"],
  ["Fingers", "god finger owner", "godfinger_find_target|godfinger_draw|godfinger_move|godfinger_random_fun_move|godfinger_circle_move|godfinger_circle_move_small|godfinger_circle_move_big"],
  ["Dragons", "dragons", "dragon_fly|dragon_sleep|dragon_wakeup|dragon_slide|dragon_land|dragon_land_attack|dragon_up|dragon_idle"],
  ["UFOs", "ufos", "ufo_idle|ufo_hit|ufo_flee|ufo_fly|ufo_explore|ufo_chase|ufo_attack"],
  ["Boats", "seafaring", "boat_check_existence|boat_check_limits|boat_idle|boat_danger_check|boat_transport_check|boat_transport_check_taxi|boat_transport_go_load|boat_transport_go_unload|boat_trading|boat_fishing|boat_return_to_dock"],
  ["ReproductionAsexual", "reproduction (plan 32)", "asexual_reproduction_budding|asexual_reproduction_divine|asexual_reproduction_spores|asexual_reproduction_fission|asexual_reproduction_vegetative|asexual_reproduction_parthenogenesis"],
  ["ReproductionSexual", "settlement; future reproduction (plan 32)", "check_lover_city|find_lover|sexual_reproduction_try|sexual_reproduction_check_outside|sexual_reproduction_inside|sexual_reproduction_outside|sexual_reproduction_civ_go|sexual_reproduction_civ_action|sexual_reproduction_civ_wait"],
  ["Children", "family (plan 23)", "child_random_flips|child_play_at_one_spot|child_random_jump|child_follow_parent"],
  ["SubspeciesTraits", "subspecies traits (plan 31)", "try_affect_dreams"],
  ["Socializing", "integration", "socialize_initial_check|socialize_try_to_start_near_bonfire|socialize_try_to_start_immediate|socialize_go_to_target|socialize_do_talk|socialize_receiving"],
  ["Deliver Resources", "economy", "Deliver Resources"],
];
const adapters: Record<string, string> = {
  fighting: 'combat', swim_to_island: 'swim_to_island', try_to_eat_city_food: 'eating',
  mine: 'gather', mine_deposit: 'gather', chop_trees: 'gather', store_resources: 'delivery', 'Deliver Resources': 'delivery',
  try_build_building: 'construction', build_building: 'construction',
  reflection: 'reflection', happy_laughing: 'reflection', crying: 'reflection',
  wait: 'wait', wait5: 'wait5', wait10: 'wait10', random_wait_short_1: 'random_wait_short_1',
};
export const UNIT_TASK_CATALOG: readonly UnitTaskCatalogEntry[] = groups.flatMap(([group, owner, ids]) =>
  ids.split('|').map(id => ({ id, group, owner, support: adapters[id] ? 'adapted' : 'unavailable', behaviour: adapters[id] ?? null })));
