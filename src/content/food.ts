import type { Registry } from './registry';
import { foodPlants, plantFood } from '../core/food-plants';
import { validFood, validFoodPlant } from '../persistence/food';

export function registerFood(registry: Registry): void {
  registry.registerComponent('food', validFood);
  registry.registerComponent('foodPlant', validFoodPlant);
  registry.registerEntity({ id: 'core:food-plant', sprite: {
    pixels: ['  ll   ', ' lllld ', 'llllldd', ' dddd  ', '  bb   '],
    palette: { l: '#699144', d: '#385938', b: '#6f5139' }, anchor: { x: 3, y: 4 },
  }, create: p => ({ position: { ...p }, health: { current: 20, max: 20 },
    combustible: { ignition: 80, fuel: 8, burnRate: 2 },
    foodPlant: { good: 'berries', remaining: 0, ripeAt: 10800, createdAt: 0, harvestedAt: -1 } }) });
  registry.registerSystem({ id: 'core:food-plants', after: ['core:landscape'], before: ['core:economy'], update: foodPlants });
  registry.registerTool({ id: 'core:food-plant', category: 'nature', label: 'Fruit plants', radius: 1, color: '#a7bc67',
    hint: 'Plant food suited to this ground. Wait for the harvest.', apply: (world, p) => {
      if (!plantFood(world, p)) return 'No room for a food plant';
    } });
}
