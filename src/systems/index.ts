import { currency } from '../core/currency';
import { reproductionSystem } from '../core/reproduction';
import { tileEffects } from './tiles';
import { temperatures } from './temperature';
import { traitsSystem } from './traits';
import { unitStatsSystem } from './unit-stats';
import { statusEffects } from '../core/status-effects';
import { happiness } from '../core/happiness';
import type { System } from '../core/systems';
export type { System } from '../core/systems';
import { explosives, fire, processEvents, rain, water } from './effects';
import { intentions, movement, settlement, residentCombat } from './people';
import { agriculture, diplomacy, roads, villages } from './society';
import { landscape } from './landscape';
import { forestry } from './forestry';
import { caravans } from './caravans';
import { ferries } from './ferries';
import { migrations } from './migration';
import { construction } from './construction';
import { emergencies } from './emergencies';
import { economy } from './economy';
import { husbandry } from './husbandry';
import { governance } from './governance';
import { territories } from './territory';
import { integration } from './integration';
import { reconcileOffices } from './capabilities';

/** Ordering is part of the save/replay contract. New systems get explicit positions. */
export const defaultSystems: readonly System[] = [
  { id: 'core:capabilities', before: ['core:rain'], update: reconcileOffices },
  { id: 'core:traits', after: ['core:unit-stats'], before: ['core:rain'], update: traitsSystem },
  { id: 'core:unit-stats', before: ['core:rain'], after: ['core:capabilities'], update: unitStatsSystem },
  { id: 'core:rain', update: rain },
  { id: 'core:water', after: ['core:rain'], update: water },
  { id: 'core:statuses', before: ['core:fire'], after: ['core:water'], update: statusEffects },
  { id: 'core:fire', after: ['core:statuses'], update: fire },
  { id: 'core:landscape', after: ['core:fire'], update: landscape },
  { id: 'core:forestry', after: ['core:landscape'], update: forestry },
  { id: 'core:ferries', after: ['core:forestry'], update: ferries },
  { id: 'core:emergencies', after: ['core:ferries'], update: emergencies },
  { id: 'core:movement', after: ['core:emergencies'], update: movement },
  { id: 'core:tiles', after: ['core:movement'], before: ['core:settlement'], update: tileEffects },
  { id: 'core:settlement', after: ['core:movement'], update: settlement },
  { id: 'core:reproduction', after: ['core:settlement'], before: ['core:villages'], update: reproductionSystem },
  { id: 'core:villages', after: ['core:reproduction'], update: villages },
  { id: 'core:roads', after: ['core:villages'], update: roads },
  { id: 'core:agriculture', after: ['core:roads'], update: agriculture },
  { id: 'core:diplomacy', after: ['core:agriculture'], update: diplomacy },
  { id: 'core:caravans', after: ['core:diplomacy'], update: caravans },
  { id: 'core:migrations', after: ['core:caravans'], update: migrations },
  { id: 'core:economy', after: ['core:migrations'], update: economy },
  { id: 'core:husbandry', after: ['core:economy'], update: husbandry },
  { id: 'core:governance', after: ['core:husbandry'], update: governance },
  { id: 'core:territory', after: ['core:governance'], before: ['core:integration'], update: territories },
  { id: 'core:currency', after: ['core:governance'], update: currency },
  { id: 'core:integration', after: ['core:currency'], update: integration },
  { id: 'core:happiness', after: ['core:integration'], update: happiness },
  { id: 'core:intentions', after: ['core:happiness'], update: intentions },
  { id: 'core:combat', after: ['core:intentions'], update: residentCombat },
  { id: 'core:construction', after: ['core:combat'], update: construction },
  { id: 'core:explosives', after: ['core:construction'], update: explosives },
  { id: 'core:events', after: ['core:explosives'], update: processEvents },
  { id: 'core:temperature', after: ['core:events'], update: temperatures },
];
