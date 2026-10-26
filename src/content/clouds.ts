import type { PixelSprite, Registry } from './registry';
import { CLOUDS, CLOUD_TYPES, cancelCloud, cloudDefinitions, clouds, cloudState, isCloudType, summonCloud, validCloudState, type CloudState, type CloudType } from '../core/clouds';
import { applyPrecipitation, updateClouds } from '../systems/clouds';
import { bool, integer, number } from '../core/validation';

function icon(type: CloudType): PixelSprite {
  const pixels = ['....aaa.....', '..aabbaa....', '.abbbbbbaa..', 'abbbbbbbbaa.', '.aaaaaaaaa..', '..c..c..c...', '.c..c..c....'];
  return { pixels: pixels.flatMap(row => { const expanded = [...row].map(pixel => pixel.repeat(2)).join(''); return [expanded, expanded]; }),
    palette: { a: '#414657', b: cloudDefinitions[type].color, c: cloudDefinitions[type].drop }, anchor: { x: 12, y: 7 } };
}
export function registerClouds(registry: Registry): void {
  registry.registerScenario<CloudState>({ id: CLOUDS.id, create: () => ({ clouds: [], nextId: 1, cursor: 0 }), validate: validCloudState, update: updateClouds });
  registry.registerEvent({ kind: 'precipitation', validate: (v, c) => number(v.x, 0, c.width) && number(v.y, 0, c.height)
    && isCloudType(v.type) && integer(v.seed, 0, 0xffffffff) && bool(v.player) && (v.cloudId === undefined || integer(v.cloudId, 1)),
  apply: (world, event) => {
    const cloud = cloudState(world)?.clouds.find(c => c.id === event.cloudId);
    if (event.cloudId !== undefined && !cloud) return;
    const result = applyPrecipitation(world, event);
    if (cloud) cloud.result = result;
  } });
  for (const type of CLOUD_TYPES) registry.registerTool({ id: type === 'lightning' ? 'core:rain' : `core:cloud-${type}`,
    category: 'destruction', label: cloudDefinitions[type].label, icon: icon(type), radius: 3.5, color: cloudDefinitions[type].drop, continuous: true,
    hint: 'Summon a moving cloud for 60 seconds. Inspect the ground below it to see its last effect.',
    apply: (world, p) => { const result = summonCloud(world, type, p); if (typeof result === 'string') return result; },
  });
  registry.registerTool({ id: 'core:disperse-clouds', category: 'destruction', label: 'Disperse clouds', icon: icon('snow'), radius: 8, color: '#d1dfdf',
    hint: 'Remove cloud sources in this area. Effects already applied remain.',
    apply: (world, p) => {
      const targets = clouds(world).filter(c => Math.hypot(c.x - p.x, c.y - p.y) <= 8);
      for (const c of targets) cancelCloud(world, c.id);
      if (!targets.length) return 'No clouds here';
    },
  });
}
