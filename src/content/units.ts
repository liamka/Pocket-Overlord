import type { Registry } from './registry';
import { validUnitIdentity } from '../persistence/units';

export function registerUnits(registry: Registry): void {
  registry.registerComponent('unit', validUnitIdentity);
  registry.registerTool({ id: 'core:inspect', label: 'Inspect unit', hint: 'Select a resident, animal, vessel or creature to open its card.',
    category: 'people', icon: 'human', radius: 0.5, color: '#f4d378', showArea: false, apply: () => {} });
  registry.registerTool({ id: 'core:inspect-tile', label: 'Inspect cell', hint: 'Select ground to inspect its layers and movement rules.',
    category: 'biomes', radius: 0.5, color: '#a8d9e6', showArea: true, apply: () => {} });
}
