import { Registry, type ContentPack } from './registry';
import { componentValidators } from './components';
import { defaultSystems } from '../systems';
import { registerEffects } from '../systems/effects';
import { registerNapalm } from './napalm';
import { registerSuperweapons } from './superweapons';
import { registerDragons } from './dragons';
import { registerUfos } from './ufos';
import { registerKaiju } from './kaiju';
import { registerNaturalBiomes } from './natural-biomes';
import { registerTerraforming } from './terraforming';
import { registerPeoples } from './peoples';
import { registerThunderstorms } from './thunderstorms';
import { registerSeafaring } from './seafaring';
import { registerVillageLife } from './village-life';
import { registerStone } from './stone';
import { registerCataclysms } from './cataclysms';
import { registerAfflictions } from './afflictions';
import { registerGeohazards } from './geohazards';
import { type ComponentKey, type Components, type Vec2 } from '../core/types';

function burnable(position: Vec2, health: number, fuel: number, ignition: number): Components {
  return { position: { ...position }, health: { current: health, max: health }, combustible: { fuel, ignition }, thermal: { temperature: 0, wetness: 0, burning: false } };
}

export const coreContent: ContentPack = {
  id: 'core',
  install(registry) {
    for (const [key, validate] of Object.entries(componentValidators)) registry.registerComponent(key as ComponentKey, validate);
    registerEffects(registry);
    for (const system of defaultSystems) registry.registerSystem(system);
    registerPeoples(registry);
    registry
    .registerEntity({ id: 'core:tree', sprite: 'tree', create: (p, rng) => ({
      ...burnable(p, 80, 45, 28), solid: { radius: 0.5 }, appearance: { variant: Math.floor(rng.range(0, 4)) },
    }) })
    .registerEntity({ id: 'core:house', sprite: 'house', create: (p, rng) => ({
      ...burnable(p, 180, 70, 42), solid: { radius: 1.1 }, dwelling: { race: 'human', capacity: 5, villageId: null }, appearance: { variant: Math.floor(rng.range(0, 3)) },
    }) })
    .registerEntity({ id: 'core:farm', sprite: 'farm', create: p => ({
      ...burnable(p, 55, 35, 30), farm: { villageId: 0, growth: 0, harvests: 0 },
    }) })
    .registerEntity({ id: 'core:ruin', sprite: 'house', create: p => ({
      position: { ...p }, appearance: { variant: 0 },
      ruin: { race: 'human', villageId: null, homeId: 1, capacity: 5, destroyedAt: 0 },
    }) })
    .registerEntity({ id: 'core:caravan', sprite: 'caravan', create: p => ({
      ...burnable(p, 100, 40, 35),
      caravan: { fromId: 0, toId: null, food: 0, path: [], next: 0, returning: false, retryIn: 0 },
    }) })
    .registerEntity({ id: 'core:dynamite', sprite: 'dynamite', create: p => ({
      ...burnable(p, 16, 1, 15), explosive: { fuse: 2, radius: 2.75, power: 190, heat: 100 },
    }) })
    .registerEntity({ id: 'core:rocket', sprite: 'rocket', create: (p, rng) => ({
      position: { ...p }, projectile: { remaining: 1.25, duration: 1.25, heading: Math.floor(rng.range(0, 8)) * Math.PI / 4 }, explosive: { fuse: 1.25, radius: 4.5, power: 350, heat: 130 },
    }) })
    .registerTool({ id: 'core:dynamite', category: 'destruction', icon: 'dynamite', label: 'Динамит', radius: 2.75, color: '#f5b18a', hint: 'Щёлкните для установки. Взрыв через 2 секунды.', apply: (world, p) => {
      if (!world.spawn('core:dynamite', p)) return 'В мире слишком много объектов';
    } })
    .registerTool({ id: 'core:rocket', category: 'destruction', icon: 'rocket', label: 'Ракета', radius: 4.5, color: '#e5b8e8', hint: 'Choose a target. A rocket flies in from a random direction.', apply: (world, p) => { if (!world.spawn('core:rocket', p)) return 'В мире слишком много объектов'; } });
    registerThunderstorms(registry);
    registerSeafaring(registry);
    registerVillageLife(registry);
    registerStone(registry);
    registerDragons(registry);
    registerUfos(registry);
    registerKaiju(registry);
    registerTerraforming(registry);
    registerNaturalBiomes(registry);
    registerNapalm(registry);
    registerSuperweapons(registry);
    registerCataclysms(registry);
    registerAfflictions(registry);
    registerGeohazards(registry);
  },
};

export function createRegistry(packs: readonly ContentPack[] = []): Registry {
  const registry = new Registry().use(coreContent);
  for (const pack of packs) registry.use(pack);
  registry.resolveSystems();
  return registry;
}
