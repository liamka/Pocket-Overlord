import { noise } from './random';
import { NaturalBiome, NATURAL_BIOMES, biomeDefinition, biomeSurface, naturalBiomeFor, surfacePatchNoise } from './natural-biomes';
import { BIOMES, biomeForSeed, outlineDistance, ridgeDistance, type BiomeId } from './biomes';
import { isBridge, ROAD_OVERGROWTH_SECONDS, Terrain, WORLD_WIDTH, WORLD_HEIGHT, type RoadWear, type TerrainData, type TerrainRecovery } from './types';

// Scale progress rather than saved ages so existing worlds keep their recovery stage.
export const LANDSCAPE_RECOVERY_RATE = 0.25;
export const isDamagedTerrain = (tile: number): boolean => tile === Terrain.Scorched || tile === Terrain.Crater;
export const recoveryStage = (tile: number, age: number): number => Math.min(3, Math.floor(age / (tile === Terrain.Crater ? 12 : 6)));
export const roadWearStage = (age: number): number => Math.min(3, Math.floor(age / (ROAD_OVERGROWTH_SECONDS / 4)));
export function recoveryDuration(tile: number, x: number, y: number, seed: number): number {
  const variation = noise(x, y, seed);
  return tile === Terrain.Crater ? 36 + Math.floor(variation * 20) : 18 + Math.floor(variation * 18);
}

export class TerrainMap {
  revision = 0;
  readonly dirty = new Set<number>();
  readonly tiles: number[];
  readonly moisture: number[];
  readonly biomes: number[];
  readonly surfaces: number[];
  readonly recovery = new Map<number, TerrainRecovery>();
  readonly roadTiles = new Set<number>();
  readonly roadWear = new Map<number, RoadWear>();
  constructor(readonly width: number, readonly height: number, data?: TerrainData) {
    this.tiles = data?.tiles.slice() ?? new Array(width * height).fill(Terrain.DeepWater);
    this.moisture = data?.moisture.slice() ?? new Array(width * height).fill(0);
    this.biomes = data?.biomes?.slice() ?? new Array(width * height).fill(NaturalBiome.Grassland);
    this.surfaces = data?.surfaces?.slice() ?? new Array(width * height).fill(0);
    for (const state of data?.recovery ?? []) this.recovery.set(state.index, { ...state });
    for (let i = 0; i < this.tiles.length; i++) if (this.tiles[i] === Terrain.Road) this.roadTiles.add(i);
    for (const state of data?.roadWear ?? []) {
      if (this.tiles[state.index] === Terrain.Road || state.age === ROAD_OVERGROWTH_SECONDS && this.tiles[state.index] === state.target) this.roadWear.set(state.index, { ...state });
    }
    this.markAllDirty();
  }
  index(x: number, y: number): number { return Math.floor(y) * this.width + Math.floor(x); }
  inside(x: number, y: number): boolean { return x >= 0 && y >= 0 && x < this.width && y < this.height; }
  at(x: number, y: number): Terrain { return this.inside(x, y) ? this.tiles[this.index(x, y)] : Terrain.DeepWater; }
  isLand(x: number, y: number): boolean { return this.inside(x, y) && this.at(x, y) >= Terrain.Sand; }
  biomeAt(x: number, y: number) { return biomeDefinition(this.inside(x, y) ? this.biomes[this.index(x, y)] : NaturalBiome.Grassland); }
  surfaceAt(x: number, y: number) {
    const i = this.index(x, y);
    return this.inside(x, y) ? biomeSurface(this.biomes[i], this.surfaces[i]) : undefined;
  }
  canSeed(x: number, y: number): boolean {
    const tile = this.at(x, y), i = this.index(x, y);
    return tile === Terrain.Grass || tile === Terrain.Road && this.roadWear.get(i)?.target !== Terrain.Sand
      || isDamagedTerrain(tile) && this.recovery.get(i)?.target === Terrain.Grass;
  }
  setBiome(x: number, y: number, biome: NaturalBiome): void {
    if (!this.canSeed(x, y)) return;
    const i = this.index(x, y);
    if (this.biomes[i] === biome) return;
    this.biomes[i] = biome; this.dirty.add(i); this.revision++;
  }
  set(x: number, y: number, tile: Terrain): void {
    if (!this.inside(x, y)) return;
    const i = this.index(x, y);
    // A broken wooden deck exposes the river; it never becomes permanent land.
    if (isBridge(this.tiles[i]) && isDamagedTerrain(tile)) tile = Terrain.Water;
    if (tile === Terrain.Road) {
      const previous = this.roadWear.get(i);
      this.roadWear.set(i, { index: i, age: 0, target: previous?.target ?? (this.tiles[i] === Terrain.Sand ? Terrain.Sand : Terrain.Grass) });
      this.roadTiles.add(i);
      if (previous?.age) this.dirty.add(i);
    } else { this.roadWear.delete(i); this.roadTiles.delete(i); }
    if (isDamagedTerrain(tile)) {
      const previous = this.recovery.get(i);
      const target = previous?.target ?? (this.tiles[i] === Terrain.Sand ? Terrain.Sand : Terrain.Grass);
      this.recovery.set(i, { index: i, age: 0, target });
      this.dirty.add(i);
    } else this.recovery.delete(i);
    this.moisture[i] = 0;
    if (this.tiles[i] !== tile) { this.tiles[i] = tile; this.dirty.add(i); this.revision++; }
  }
  /** Only real traffic clears weeds; a planned route does not count as use. */
  useRoad(x: number, y: number): void {
    if (this.at(x, y) !== Terrain.Road) return;
    const i = this.index(x, y), state = this.roadWear.get(i);
    if (!state?.age) return;
    if (roadWearStage(state.age)) this.dirty.add(i);
    state.age = 0;
  }
  ageRoads(): void {
    for (const i of this.roadTiles) {
      if (this.tiles[i] !== Terrain.Road) { this.roadTiles.delete(i); this.roadWear.delete(i); continue; }
      let state = this.roadWear.get(i);
      if (!state) this.roadWear.set(i, state = { index: i, age: 0, target: Terrain.Grass });
      const previous = roadWearStage(state.age);
      state.age++;
      if (state.age >= ROAD_OVERGROWTH_SECONDS) {
        this.set(i % this.width, Math.floor(i / this.width), state.target);
        // Keep a tombstone so repair workers do not rebuild an abandoned track.
        this.roadWear.set(i, state);
      } else if (previous !== roadWearStage(state.age)) this.dirty.add(i);
    }
  }
  circle(x: number, y: number, radius: number, visit: (x: number, y: number, index: number) => void): void {
    for (let ty = Math.max(0, Math.floor(y - radius)); ty <= Math.min(this.height - 1, Math.ceil(y + radius)); ty++) {
      for (let tx = Math.max(0, Math.floor(x - radius)); tx <= Math.min(this.width - 1, Math.ceil(x + radius)); tx++) {
        if ((tx + 0.5 - x) ** 2 + (ty + 0.5 - y) ** 2 <= radius ** 2) visit(tx, ty, ty * this.width + tx);
      }
    }
  }
  markAllDirty(): void { for (let i = 0; i < this.tiles.length; i++) this.dirty.add(i); }
  snapshot(): TerrainData { return { width: this.width, height: this.height, tiles: [...this.tiles], moisture: [...this.moisture], biomes: [...this.biomes], surfaces: [...this.surfaces], recovery: [...this.recovery.values()].map(state => ({ ...state })), roadWear: [...this.roadWear.values()].map(state => ({ ...state })) }; }
}

export function generateTerrain(seed: number, width = WORLD_WIDTH, height = WORLD_HEIGHT, biomeId: BiomeId = biomeForSeed(seed), nature?: NaturalBiome): TerrainMap {
  const map = new TerrainMap(width, height);
  const biome = BIOMES.find(candidate => candidate.id === biomeId)!;
  const scale = Math.min(width, height) * 0.87 / 100;
  const regions = NATURAL_BIOMES.map(() => [] as { index: number; cover: number; material: number }[]);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = (x + 0.5 - width / 2) / scale + 50, py = (y + 0.5 - height / 2) / scale + 50;
      const land = Math.min(...biome.land.map(outline => outlineDistance(px, py, outline))) + (biome.landInset ?? 0);
      const lake = Math.min(...biome.lakes.map(outline => outlineDistance(px, py, outline)));
      const island = Math.min(...(biome.lakeIslands ?? []).map(outline => outlineDistance(px, py, outline)));
      const distance = Math.min(Math.max(land, -lake), island) + (noise(x, y, seed) - 0.5) * 0.32;
      let tile = distance > 3.5 ? Terrain.DeepWater : distance > 0 ? Terrain.Water : distance > -0.65 ? Terrain.Sand
        : ridgeDistance(px, py, biome) < (noise(x, y, seed + 19) - 0.5) * 0.15 ? Terrain.Mountain : Terrain.Grass;
      if (tile === Terrain.Grass) tile = biome.surfaces?.find(surface => outlineDistance(px, py, surface.outline) < 0)?.terrain ?? tile;
      map.set(x, y, tile);
      if (tile === Terrain.Grass || tile === Terrain.Mountain) {
        const index = map.index(x, y);
        map.biomes[index] = nature ?? naturalBiomeFor(px, py, seed);
        regions[map.biomes[index]].push({ index, cover: surfacePatchNoise(px, py, seed), material: surfacePatchNoise(px, py, seed + 419) });
      }
    }
  }
  // Reserve 15% of each biome for local surfaces, excluding water and beaches.
  for (const region of regions) {
    region.sort((a, b) => a.cover - b.cover || a.index - b.index);
    const patches = region.slice(0, Math.ceil(region.length * 0.15));
    patches.sort((a, b) => a.material - b.material || a.index - b.index);
    for (let i = 0; i < patches.length; i++) map.surfaces[patches[i].index] = 1 + Math.floor(i * 3 / patches.length);
  }
  return map;
}
