import type { StatValues } from '../core/unit-stats';
import type { HappinessEvent } from './happiness';

export interface StatusDefinition {
  label: string; seconds: number | null; tier: 'basic' | 'advanced';
  reapply: 'refresh' | 'replace' | 'ignore'; period?: number;
  flat?: Partial<StatValues>; percent?: Partial<StatValues>;
  stops?: 'movement' | 'decisions'; blocks?: readonly string[];
  onEnter?: HappinessEvent; onExit?: HappinessEvent; onTick?: 'damage' | 'transmission' | 'fireworks'; damageInterrupts?: boolean;
  dispellable?: boolean; curable?: boolean; future?: string;
}
const status = (label: string, seconds: number | null, options: Partial<StatusDefinition> = {}): StatusDefinition =>
  ({ label, seconds, tier: 'basic', reapply: 'refresh', ...options });
const emotion = { tier: 'advanced', damageInterrupts: true } as const;
/** Numeric reference: plan 28. Local speed units are tiles/s: +/-100 reference speed
 * is adapted to +/-1 tile/s. Unimplemented owners are rejected, not simulated by a timer. */
export const statusDefinitions = {
  'plot-recovery': status('Plot recovery', 60, { blocks: ['plot'] }),
  'spell-recovery': status('Spell recovery', 5, { blocks: ['spell'] }),
  'social-recovery': status('Social recovery', 60, { blocks: ['conversation'] }),
  'combat-recovery': status('Combat action recovery', 1, { blocks: ['combat-action'] }),
  dodge: status('Dodging', 1), dash: status('Dashing', 2, { percent: { speed: 155 } }),
  laughing: status('Laughing', 60, emotion), singing: status('Singing', 60, emotion),
  swearing: status('Swearing', 60, emotion), crying: status('Crying', 60, emotion),
  inspired: status('Inspired', 60, { percent: { speed: 30, attackSpeed: 30, criticalMultiplier: 30 }, onExit: 'inspired' }),
  confused: status('Confused', 10, { blocks: ['evolve'] }),
  angry: status('Angry', 60), tantrum: status('Tantrum', 120, { onExit: 'tantrum' }),
  festive: status('Festive spirit', 100, { period: 1800, onTick: 'fireworks', future: 'Fireworks require a completed purchase' }),
  suspicious: status('Being suspicious', 20), invincible: status('Invincible', 5, { dispellable: true }),
  stunned: status('Stunned', 4, { tier: 'advanced', stops: 'decisions' }),
  'just-ate': status('Just ate', 200), starving: status('Starving', 60, { period: 150, onTick: 'damage' }),
  sleeping: status('Sleeping', 60, { tier: 'advanced', stops: 'decisions', damageInterrupts: true, onExit: 'rest' }),
  'good-dream': status('Had a good dream', 90, { onEnter: 'good-dream' }),
  'bad-dream': status('Had a bad dream', 90, { onEnter: 'bad-dream' }),
  nightmare: status('Had a nightmare', 90, { onEnter: 'nightmare' }),
  silenced: status('Silenced', 60, { blocks: ['spell'] }),
  'spell-boost': status('Spell boost', 180, { flat: { mana: 100 }, percent: { spellcasting: 20 }, dispellable: true }),
  enchanted: status('Enchanted', 120, { flat: { lifespan: 10 }, percent: { damage: 77, speed: 10, diplomacy: 10, critical: 10 }, onEnter: 'enchanted', dispellable: true }),
  cursed: status('Cursed', 300, { flat: { lifespan: -10 }, percent: { speed: -20, damage: -50, health: -50, diplomacy: -90 }, onEnter: 'curse', curable: true }),
  coughing: status('Coughing', 200, { tier: 'advanced', flat: { lifespan: -15 }, percent: { speed: -10, health: -10 }, curable: true }),
  'ash-fever': status('Ash fever', 500, { tier: 'advanced', period: 300, onTick: 'damage', flat: { warfare: 5, diplomacy: -5, stewardship: -5, intelligence: -5, lifespan: -45 }, percent: { speed: -10, health: -60 }, curable: true }),
  rage: status('Rage', 300, { percent: { damage: 100 } }),
  powerup: status('Empowered', 300, { flat: { damage: 5, armor: 1 }, percent: { damage: 50, critical: 50, scale: 10 }, dispellable: true }),
  caffeinated: status('Caffeinated', 60, { flat: { intelligence: 222, speed: 2 } }),
  shield: status('Shielded', 60, { tier: 'advanced', flat: { mass: 100, armor: 90 }, dispellable: true }),
  slowness: status('Slowed', 30, { flat: { speed: -1 }, dispellable: true }),
  frozen: status('Frozen', 15, { flat: { mass: 100, armor: -20 }, stops: 'decisions' }),
  burning: status('Burning', 30, { tier: 'advanced', period: 60, onTick: 'damage' }),
  poisoned: status('Poisoned', 90, { tier: 'advanced', period: 30, onTick: 'damage', curable: true }),
  egg: status('Egg', 5, { reapply: 'ignore', flat: { armor: 10 }, stops: 'decisions' }),
  'soul-harvested': status('Soul harvested', 666),
  pregnant: status('Pregnant', 45, { reapply: 'ignore', percent: { speed: -20 }, blocks: ['breed'] }),
  afterglow: status('Afterglow', 90, { blocks: ['breed'] }),
  'fell-in-love': status('In love', 180, { reapply: 'ignore' }),
  budding: status('Budding', 60, { percent: { diplomacy: 100, warfare: 100, stewardship: 100, intelligence: 100 } }),
  'taking-roots': status('Taking roots', 120, { tier: 'advanced', flat: { mass: 100, armor: -10 }, percent: { damage: -30, health: -30 }, stops: 'decisions' }),
  uprooting: status('Uprooting', 120, { tier: 'advanced', flat: { armor: 20 }, percent: { damage: -30, health: -30 }, stops: 'decisions' }),
  possessed: status('Possessed', 10, { blocks: ['conversation'], onEnter: 'possession', future: 'Direct unit control is not available' }),
  'possessed-follower': status('Possessed follower', 200, { reapply: 'replace', future: 'Direct unit control is not available' }),
  'strange-urge': status('Strange urge', 100, { future: 'Direct unit control is not available' }),
  magnetized: status('Magnetized', 4, { onEnter: 'magnet' }),
  voices: status('Voices in my head', 180, { flat: { diplomacy: -5 } }),
  surprised: status('Surprised', 2, { onEnter: 'fear' }), 'on-guard': status('On guard', 60),
  motivated: status('Motivated', 120, { flat: { speed: 0.1, attackSpeed: 2 } }),
  flicked: status('Flicked', 3), drowning: status('Drowning', null, { tier: 'advanced', period: 4, onTick: 'damage', blocks: ['attack'] }),
  'handsome-migrant': status('Handsome migrant', 360),
  // Existing Pocket Overlord diseases retain their own mechanics; they are not Ash Fever/Rage.
  plague: status('Plague', null, { tier: 'advanced', reapply: 'ignore', period: 24, onTick: 'transmission', curable: true }),
  madness: status('Madness', null, { reapply: 'ignore', curable: true }),
} as const;
export type StatusId = keyof typeof statusDefinitions;
export const STATUS_IDS = Object.keys(statusDefinitions) as StatusId[];
export const isStatusId = (value: unknown): value is StatusId => typeof value === 'string' && Object.hasOwn(statusDefinitions, value);
/** Explicit, symmetric conflicts. The winner is independent of application/system order.
 * Heat and ice neutralize each other; neither pulse is dealt during that transition. */
export const STATUS_CONFLICTS: readonly { a: StatusId; b: StatusId; winner: StatusId | null }[] = [
  { a: 'burning', b: 'frozen', winner: null },
  ...(['burning', 'frozen'] as const).map(b => ({ a: 'shield' as const, b, winner: 'shield' as const })),
  { a: 'caffeinated', b: 'frozen', winner: 'caffeinated' }, { a: 'slowness', b: 'caffeinated', winner: 'slowness' },
  { a: 'enchanted', b: 'cursed', winner: 'enchanted' },
  ...(['sleeping', 'tantrum', 'surprised', 'singing', 'laughing', 'suspicious', 'angry'] as const).map(b => ({ a: 'stunned' as const, b, winner: 'stunned' as const })),
  ...(['tantrum', 'surprised'] as const).map(b => ({ a: 'sleeping' as const, b, winner: 'sleeping' as const })),
  { a: 'frozen', b: 'tantrum', winner: 'frozen' },
];
