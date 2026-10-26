// Compatibility for the existing toolbar ID and renderer. All weather has one owner.
import { CLOUDS, clouds, type Cloud } from '../core/clouds';
import type { World } from '../core/world';
export { registerClouds as registerThunderstorms } from './clouds';
export type { LightningBolt } from '../core/clouds';
export type StormCloud = Cloud;
export const STORM = { id: CLOUDS.id, toolId: 'core:rain', radius: 3.5, duration: CLOUDS.lifetime,
  firstStrike: CLOUDS.firstDrop, interval: CLOUDS.interval, boltLife: CLOUDS.boltLife, hitRadius: 1.25, limit: CLOUDS.limit } as const;
export const stormClouds = (world: World): readonly Cloud[] => clouds(world).filter(c => c.type === 'lightning');
