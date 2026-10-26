import type { Registry } from './registry';
import { validPhysiologyState } from '../persistence/physiology';
import { physiologySystem } from '../systems/physiology';

export function registerPhysiology(registry: Registry): void {
  registry.registerComponent('physiology', validPhysiologyState);
  registry.registerSystem({ id: 'core:physiology', after: ['core:economy'], before: ['core:husbandry'], update: physiologySystem });
}
