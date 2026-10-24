import { NaturalBiome, biomeDefinition, type BiomeSurface } from '../core/natural-biomes';

/** Original pixel vegetation, anchored at the same ground point as existing trees. */
export function drawBiomeTree(ctx: CanvasRenderingContext2D, biome: NaturalBiome, variant = 0): boolean {
  if (biome === NaturalBiome.Grassland) return false;
  const r = (color: string, x: number, y: number, w: number, h: number): void => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
  r('#234d3a35', -6, 0, 15, 4);
  if (biome === NaturalBiome.Desert) {
    r('#326b4e', -2, -17, 5, 19); r('#73a66a', -1, -16, 2, 17);
    r('#326b4e', -7, -11, 3, 7); r('#326b4e', -6, -6, 5, 3);
    r('#56905a', -6, -11, 1, 6); r('#326b4e', 5, -14, 3, 8); r('#326b4e', 2, -8, 4, 3);
    r('#73a66a', 6, -13, 1, 5); r('#d6c392', 1, -12, 1, 1); r('#d6c392', -1, -5, 1, 1);
    if (variant % 2) r('#e3a686', 0, -18, 3, 2);
  } else if (biome === NaturalBiome.Savanna) {
    r('#79583a', -1, -14, 3, 16); r('#aa8351', 0, -12, 1, 13);
    r('#79583a', -5, -14, 5, 3); r('#79583a', 2, -16, 5, 3);
    r('#526b3b', -11, -20, 24, 7); r('#71884a', -10, -22, 22, 6);
    r('#94a35a', -7, -23, 12, 3); r('#a8af66', -9, -20, 6, 2);
    r('#84974e', 6, -21, 7, 3);
  } else if (biome === NaturalBiome.Jungle) {
    r('#695536', -1, -17, 4, 19); r('#a1844d', 0, -15, 2, 16);
    r('#355e3c', -11, -19, 23, 5); r('#2c6944', -8, -24, 17, 9);
    r('#3b8551', -12, -22, 11, 5); r('#4d9b5b', -8, -25, 10, 5);
    r('#4d9b5b', 1, -23, 12, 4); r('#76af67', -5, -25, 8, 2);
    r('#337347', -12, -17, 3, 6); r('#337347', 10, -19, 3, 7);
    r('#88ac61', -7, -16, 1, 8); r('#518044', -6, -9, 3, 1);
    r('#bb9955', 2, -16, 2, 3); r('#d1b46a', 4, -15, 2, 2);
  } else if (biome === NaturalBiome.Swamp) {
    r('#605b45', -2, -13, 5, 15); r('#8e8663', -1, -11, 2, 12);
    r('#605b45', -5, -2, 4, 2); r('#605b45', -7, 0, 3, 2); r('#605b45', 3, -3, 3, 3); r('#605b45', 5, 0, 4, 2);
    r('#3b6555', -8, -19, 18, 10); r('#4f7c60', -9, -20, 16, 7);
    r('#6a9471', -5, -23, 10, 7); r('#82a77a', -4, -22, 6, 2);
    for (const x of [-8, -4, 5, 8]) { r('#547c61', x, -14, 2, 7 + variant % 3); r('#8caa7c', x, -11, 1, 3); }
  } else {
    r('#716454', -1, -10, 3, 12);
    r('#386a62', -8, -8, 17, 5); r('#386a62', -6, -15, 13, 7); r('#386a62', -3, -21, 7, 7);
    r('#558b7b', -7, -9, 13, 4); r('#558b7b', -5, -16, 9, 5); r('#558b7b', -2, -23, 4, 8);
    r('#ebf2e9', -6, -10, 12, 2); r('#dcebe4', -4, -17, 8, 3); r('#f6f7ed', -1, -24, 2, 7);
    r('#c1d9d6', -8, -5, 5, 2); r('#dcebe4', -2, 1, 6, 2);
  }
  return true;
}

export function drawBiomeDetails(ctx: CanvasRenderingContext2D, biome: NaturalBiome, x: number, y: number, n: number, surface?: BiomeSurface): void {
  if (surface) {
    ctx.fillStyle = surface.detail;
    if (surface.kind === 'ice') {
      if (n > 0.65) { ctx.fillRect(x + 1, y + 2, 5, 1); ctx.fillRect(x + 4, y + 3, 2, 1); }
      if (n < 0.18) { ctx.fillStyle = '#6e9fae'; ctx.fillRect(x + 2, y + 1, 1, 3); ctx.fillRect(x + 3, y + 4, 3, 1); }
    } else if (surface.kind === 'stone') {
      if (n > 0.5) { ctx.fillRect(x + 1, y + 2, 3, 2); ctx.fillRect(x + 5, y + 5, 2, 1); }
    } else if (surface.kind === 'water' || surface.kind === 'mud') {
      if (n > 0.7) { ctx.fillRect(x + 1, y + 3, 4, 1); ctx.fillRect(x + 4, y + 5, 2, 1); }
    } else if (surface.kind === 'sand') {
      if (n > 0.65) { ctx.fillRect(x + 1, y + 4, 5, 1); ctx.fillRect(x + 4, y + 3, 2, 1); }
    } else if (n > 0.55) {
      ctx.fillRect(x + 2, y + 5, 2, 1); ctx.fillRect(x + 5, y + 2, 1, 1);
    }
    return;
  }
  const definition = biomeDefinition(biome);
  ctx.fillStyle = definition.detail;
  if (biome === NaturalBiome.Desert) {
    if (n > 0.7) { ctx.fillRect(x + 1, y + 4, 5, 1); ctx.fillRect(x + 3, y + 3, 3, 1); }
  } else if (biome === NaturalBiome.Swamp && n > 0.7) {
    ctx.fillStyle = '#4b7774'; ctx.fillRect(x + 1, y + 2, 5, 3);
    ctx.fillStyle = '#85aaa0'; ctx.fillRect(x + 2, y + 2, 3, 1);
    if (n > 0.92) { ctx.fillStyle = '#adc07b'; ctx.fillRect(x + 1, y + 1, 1, 3); }
  } else if (biome === NaturalBiome.Permafrost) {
    if (n > 0.65) { ctx.fillRect(x + 2, y + 5, 4, 1); ctx.fillStyle = '#f0f3e9'; ctx.fillRect(x + 1, y + 2, 3, 1); }
  } else if (n > 0.75) {
    ctx.fillStyle = n > 0.985 ? '#ded592' : definition.detail;
    ctx.fillRect(x + 2, y + 4, 2, 1);
    if (n < 0.9) ctx.fillRect(x + 5, y + 2, 1, 2);
  }
}
