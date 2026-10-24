import type { System } from '../core/systems';
export type { System } from '../core/systems';
import { explosives, fire, processEvents, rain, water } from './effects';
import { intentions, movement, settlement } from './people';
import { agriculture, diplomacy, roads, villages } from './society';
import { landscape } from './landscape';
import { caravans } from './caravans';
import { ferries } from './ferries';
import { migrations } from './migration';
import { construction } from './construction';
import { emergencies } from './emergencies';

/** Ordering is part of the save/replay contract. New systems get explicit positions. */
export const defaultSystems: readonly System[] = [
  { id: 'core:rain', update: rain },
  { id: 'core:water', after: ['core:rain'], update: water },
  { id: 'core:fire', after: ['core:water'], update: fire },
  { id: 'core:landscape', after: ['core:fire'], update: landscape },
  { id: 'core:ferries', after: ['core:landscape'], update: ferries },
  { id: 'core:emergencies', after: ['core:ferries'], update: emergencies },
  { id: 'core:movement', after: ['core:emergencies'], update: movement },
  { id: 'core:settlement', after: ['core:movement'], update: settlement },
  { id: 'core:villages', after: ['core:settlement'], update: villages },
  { id: 'core:roads', after: ['core:villages'], update: roads },
  { id: 'core:agriculture', after: ['core:roads'], update: agriculture },
  { id: 'core:diplomacy', after: ['core:agriculture'], update: diplomacy },
  { id: 'core:caravans', after: ['core:diplomacy'], update: caravans },
  { id: 'core:migrations', after: ['core:caravans'], update: migrations },
  { id: 'core:intentions', after: ['core:migrations'], update: intentions },
  { id: 'core:construction', after: ['core:intentions'], update: construction },
  { id: 'core:explosives', after: ['core:construction'], update: explosives },
  { id: 'core:events', after: ['core:explosives'], update: processEvents },
];
