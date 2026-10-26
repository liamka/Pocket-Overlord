import { noise } from './random';
import { TEMPERATURE, validTileTemperature } from './temperature';
import type { DamageContext } from './death';
import { tileCell, TILE_TOPS, type TileLayers, type TileTraveler } from './tiles';
import { NaturalBiome, NATURAL_BIOMES, biomeDefinition, biomeSurface, naturalBiomeForSeed, surfacePatchNoise } from './natural-biomes';
import { BIOMES, biomeForSeed, outlineDistance, ridgeDistance, type BiomeId } from './biomes';
import { isBridge, isRoadSurface, ROAD_OVERGROWTH_SECONDS, Terrain, WORLD_WIDTH, WORLD_HEIGHT, type RoadWear, type TerrainData, type TerrainRecovery } from './types';

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
  readonly layers = new Map<number, TileLayers>();
  readonly burning = new Set<number>();
  /** Derived from saved layers; fixed index buckets preserve scheduling across reloads. */
  readonly thermalBuckets = Array.from({ length: TEMPERATURE.buckets }, () => new Set<number>());
  readonly thermalActive = new Set<number>();
  readonly visualSeed: number;
  onChange?: (indices: ReadonlySet<number>) => void;
  private editing = 0;
  private readonly changes = new Set<number>();
  readonly recovery = new Map<number, TerrainRecovery>();
  readonly roadTiles = new Set<number>();
  readonly roadWear = new Map<number, RoadWear>();
  constructor(readonly width: number, readonly height: number, data?: TerrainData, visualSeed = 0) {
    this.tiles = data?.tiles.slice() ?? new Array(width * height).fill(Terrain.DeepWater);
    this.moisture = data?.moisture.slice() ?? new Array(width * height).fill(0);
    this.biomes = data?.biomes?.slice() ?? new Array(width * height).fill(NaturalBiome.Grassland);
    this.surfaces = data?.surfaces?.slice() ?? new Array(width * height).fill(0);
    this.visualSeed = data?.visualSeed ?? visualSeed;
    for (const layer of data?.layers ?? []) {
      this.layers.set(layer.index, structuredClone(layer)); if (layer.burning) this.burning.add(layer.index);
      this.trackTemperature(layer.index);
    }
    for (const state of data?.recovery ?? []) this.recovery.set(state.index, { ...state });
    for (const state of data?.roadWear ?? []) {
      this.roadWear.set(state.index, { ...state });
      if (state.age < ROAD_OVERGROWTH_SECONDS) this.roadTiles.add(state.index);
    }
    // Preserve saved entry order; only legacy surfaces missing metadata get a default.
    for (let i = 0; i < this.tiles.length; i++) if (isRoadSurface(this.tiles[i])) {
      this.roadTiles.add(i);
      if (!this.roadWear.has(i)) this.roadWear.set(i, { index: i, age: 0,
        target: isBridge(this.tiles[i]) ? Terrain.Water : Terrain.Grass,
        ...(isBridge(this.tiles[i]) && this.layers.get(i)?.waterDepth ? { waterDepth: this.layers.get(i)!.waterDepth } : {}) });
    }
    this.markAllDirty();
  }
  index(x: number, y: number): number { return Math.floor(y) * this.width + Math.floor(x); }
  inside(x: number, y: number): boolean { return x >= 0 && y >= 0 && x < this.width && y < this.height; }
  at(x: number, y: number): Terrain { return this.inside(x, y) ? this.tiles[this.index(x, y)] : Terrain.DeepWater; }
  cell(x: number, y: number, traveler: TileTraveler = {}) {
    const i = this.index(x, y);
    return tileCell(this.at(x, y), this.biomes[i] ?? NaturalBiome.Grassland, this.surfaces[i] ?? 0, this.layers.get(i), traveler);
  }
  isLand(x: number, y: number): boolean { return this.inside(x, y) && this.cell(x, y).land; }
  canWalk(x: number, y: number): boolean { return this.inside(x, y) && this.cell(x, y).movement.passable; }
  isOpenWater(x: number, y: number): boolean { return this.inside(x, y) && this.cell(x, y, { mode: 'sail' }).movement.passable; }
  /** A brush publishes one completed change set before returning to its caller. */
  edit<T>(action: () => T): T {
    this.editing++;
    try { return action(); } finally { if (--this.editing === 0) this.publish(); }
  }
  private publish(): void {
    if (!this.changes.size) return;
    const changes = new Set(this.changes); this.changes.clear(); this.onChange?.(changes);
  }
  private touch(i: number, gameplay = true): void {
    this.dirty.add(i);
    if (gameplay) { this.revision++; this.changes.add(i); if (!this.editing) this.publish(); }
  }
  trackTemperature(index: number): void {
    const layer = this.layers.get(index), bucket = this.thermalBuckets[index % TEMPERATURE.buckets];
    if (layer && (layer.temperature || layer.lavaStage || layer.thermalFrost)) { bucket.add(index); this.thermalActive.add(index); }
    else { bucket.delete(index); this.thermalActive.delete(index); }
  }
  /** Accumulation alone changes no route or pixel; physical transitions publish separately. */
  setTemperature(index: number, temperature: number, tick: number, source?: DamageContext): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.tiles.length || !Number.isFinite(temperature)) return;
    const layer = this.layers.get(index) ?? { index };
    layer.temperature = Math.max(TEMPERATURE.cellMin, Math.min(TEMPERATURE.cellMax, temperature));
    layer.thermalAt = tick;
    if (source) layer.heatSource = { ...source };
    this.layers.set(index, layer); this.trackTemperature(index);
  }
  /** Heat destroys local cover without replacing the world-wide biome catalogue. */
  clearCover(x: number, y: number): void {
    if (!this.inside(x, y)) return;
    const i = this.index(x, y);
    this.surfaces[i] = 0; this.biomes[i] = NaturalBiome.Grassland;
    const layer = this.layers.get(i); if (layer) delete layer.surfaceBiome;
    this.normalizeLayers(i); this.touch(i);
  }
  /** Validate the complete combination before publishing one synchronous change. */
  setLayers(x: number, y: number, patch: Partial<Omit<TileLayers, 'index'>>): boolean {
    if (!this.inside(x, y)) return false;
    if (Object.keys(patch).some(key => !['elevation', 'waterDepth', 'frost', 'top', 'variant', 'temperature', 'burning', 'thermalAt', 'thermalBand', 'thermalFrost', 'heatSource', 'thermalChange', 'lavaStage'].includes(key))) return false;
    const i = this.index(x, y), previous = this.layers.get(i), next = { ...previous, ...patch, index: i };
    for (const key of Object.keys(next) as (keyof TileLayers)[]) if (next[key] === undefined) delete next[key];
    if (!next.frost) delete next.thermalFrost;
    const base = tileCell(this.tiles[i], this.biomes[i], this.surfaces[i], { index: i, surfaceBiome: this.layers.get(i)?.surfaceBiome });
    const effective = tileCell(this.tiles[i], this.biomes[i], this.surfaces[i], next);
    if (next.top !== undefined && !(TILE_TOPS as readonly string[]).includes(next.top)
      || next.elevation !== undefined && (!Number.isInteger(next.elevation) || next.elevation < 0 || next.elevation > 5 || !base.land)
      || next.waterDepth !== undefined && (![1, 2, 3].includes(next.waterDepth) || !base.water && !isBridge(this.tiles[i]))
      || next.frost !== undefined && (next.frost !== 'ice' && next.frost !== 'snow' || (next.frost === 'ice') !== base.water || !base.land && !base.water || isBridge(this.tiles[i]))
      || next.variant !== undefined && (!Number.isSafeInteger(next.variant) || next.variant < 0 || next.variant > 65535)
      || !validTileTemperature(next) || next.lavaStage !== undefined && (!base.land || !!next.frost || base.water)
      || next.burning !== undefined && (!Number.isFinite(next.burning) || next.burning <= 0 || next.burning > 30 || !!next.frost || base.water || effective.burn.rate === 0)
      || next.top !== undefined && (!base.land && !base.water || base.water && next.top !== 'water-bomb')) return false;
    if (JSON.stringify(previous ?? { index: i }) === JSON.stringify(next)) return true;
    const road = this.roadWear.get(i);
    if (road && road.target < Terrain.Sand && Object.hasOwn(patch, 'waterDepth')) {
      if (patch.waterDepth === undefined) delete road.waterDepth; else road.waterDepth = patch.waterDepth;
    }
    if (Object.keys(next).length === 1) this.layers.delete(i); else this.layers.set(i, next);
    if (next.burning) this.burning.add(i); else this.burning.delete(i);
    this.trackTemperature(i);
    if (Object.keys(patch).some(key => !['temperature', 'thermalAt', 'thermalBand', 'heatSource', 'thermalChange'].includes(key)))
      this.touch(i, Object.keys(patch).some(key => key !== 'variant'));
    return true;
  }
  freeze(x: number, y: number): boolean { return this.cell(x, y).tools.freeze && this.setLayers(x, y, { frost: 'ice' }); }
  thaw(x: number, y: number): boolean { return this.setLayers(x, y, { frost: undefined }); }
  biomeAt(x: number, y: number) { return biomeDefinition(this.inside(x, y) ? this.biomes[this.index(x, y)] : NaturalBiome.Grassland); }
  surfaceAt(x: number, y: number) {
    const i = this.index(x, y);
    return this.inside(x, y) ? biomeSurface(this.layers.get(i)?.surfaceBiome ?? this.biomes[i], this.surfaces[i]) : undefined;
  }
  canSeed(x: number, y: number): boolean {
    const tile = this.at(x, y), i = this.index(x, y);
    return this.inside(x, y) && this.cell(x, y).tools.seed && (tile === Terrain.Grass || tile === Terrain.Road && this.roadWear.get(i)?.target !== Terrain.Sand
      || isDamagedTerrain(tile) && this.recovery.get(i)?.target === Terrain.Grass);
  }
  setBiome(x: number, y: number, biome: NaturalBiome): void {
    if (!this.canSeed(x, y) || !NATURAL_BIOMES[biome]) return;
    const i = this.index(x, y);
    if (this.biomes[i] === biome) return;
    if (this.surfaces[i]) {
      const layer = this.layers.get(i) ?? { index: i };
      layer.surfaceBiome ??= this.biomes[i]; this.layers.set(i, layer);
    }
    this.biomes[i] = biome;
    this.normalizeLayers(i); this.touch(i);
  }
  private normalizeLayers(i: number): void {
    const layer = this.layers.get(i); if (!layer) return;
    if (!this.surfaces[i]) delete layer.surfaceBiome;
    const base = tileCell(this.tiles[i], this.biomes[i], this.surfaces[i], { index: i, surfaceBiome: this.layers.get(i)?.surfaceBiome });
    if (!base.land && !base.water) { delete layer.top; delete layer.frost; delete layer.elevation; }
    if (layer.frost && ((layer.frost === 'ice') !== base.water || isBridge(base.tile))) delete layer.frost;
    if (!layer.frost) delete layer.thermalFrost;
    if (!base.water && !isBridge(base.tile)) delete layer.waterDepth;
    if (base.water) { delete layer.elevation; if (layer.top !== 'water-bomb') delete layer.top; }
    if (!base.land || base.water || layer.frost) delete layer.lavaStage;
    if (base.water || layer.frost || !tileCell(this.tiles[i], this.biomes[i], this.surfaces[i], layer).burn.rate) { delete layer.burning; this.burning.delete(i); }
    this.trackTemperature(i);
  }
  canPaintBiome(x: number, y: number): boolean {
    return this.inside(x, y) && this.cell(x, y).tools.seed && (this.at(x, y) <= Terrain.Sand || this.canSeed(x, y));
  }
  /** Manual seeds replace water, beaches and local cover with the chosen biome. */
  paintBiome(x: number, y: number, biome: NaturalBiome): void {
    if (!this.canPaintBiome(x, y)) return;
    this.edit(() => {
      const i = this.index(x, y);
      if (this.tiles[i] <= Terrain.Sand) this.set(x, y, Terrain.Grass);
      if (this.surfaces[i]) { this.surfaces[i] = 0; this.touch(i); }
      this.normalizeLayers(i);
      this.setLayers(x, y, { frost: undefined, waterDepth: undefined });
      this.setBiome(x, y, biome);
    });
  }
  set(x: number, y: number, tile: Terrain): void {
    if (!this.inside(x, y)) return;
    const i = this.index(x, y);
    const old = this.tiles[i], previous = this.roadWear.get(i), damage = isDamagedTerrain(tile);
    // Decks remember both the seabed and its depth. A blast never creates land.
    if (isBridge(old) && damage) tile = previous?.target === Terrain.DeepWater ? Terrain.DeepWater : Terrain.Water;
    if (isRoadSurface(tile)) {
      const target = isBridge(tile) ? previous?.target === Terrain.DeepWater || old === Terrain.DeepWater ? Terrain.DeepWater : Terrain.Water
        : previous?.target === Terrain.Sand || old === Terrain.Sand || this.recovery.get(i)?.target === Terrain.Sand ? Terrain.Sand : Terrain.Grass;
      this.roadWear.set(i, { index: i, age: 0, target, ...(isBridge(tile) ? { waterDepth: previous?.waterDepth ?? this.layers.get(i)?.waterDepth } : {}) });
      this.roadTiles.add(i);
      if (previous?.age) this.dirty.add(i);
    } else {
      this.roadTiles.delete(i);
      if (previous && (damage || isDamagedTerrain(old) && tile === previous.target)) this.roadWear.set(i, previous);
      else if (previous && (tile === Terrain.Sand || tile === Terrain.Grass)) this.roadWear.set(i, { index: i, target: tile, age: ROAD_OVERGROWTH_SECONDS });
      else if (previous && tile === previous.target) this.roadWear.set(i, { ...previous, age: ROAD_OVERGROWTH_SECONDS });
      else this.roadWear.delete(i);
      if ((this.roadWear.get(i)?.age ?? ROAD_OVERGROWTH_SECONDS) < ROAD_OVERGROWTH_SECONDS) this.roadTiles.add(i);
    }
    if (isDamagedTerrain(tile)) {
      const target = this.recovery.get(i)?.target ?? (previous?.target === Terrain.Sand || old === Terrain.Sand ? Terrain.Sand : Terrain.Grass);
      this.recovery.set(i, { index: i, age: 0, target }); this.dirty.add(i);
    } else this.recovery.delete(i);
    this.moisture[i] = 0;
    if (this.tiles[i] !== tile) {
      this.tiles[i] = tile;
      const layer = this.layers.get(i);
      if (layer) {
        const preserveCover = tile === Terrain.Road || old === Terrain.Road && !damage || previous && isDamagedTerrain(old) && tile === previous.target;
        if (!preserveCover || isBridge(tile) || isBridge(old)) delete layer.frost;
        if (isBridge(tile) || isBridge(old) && damage) layer.waterDepth = previous?.waterDepth ?? layer.waterDepth;
        else delete layer.waterDepth;
        delete layer.burning; delete layer.lavaStage; this.burning.delete(i);
        if (tile < Terrain.Sand) { delete layer.elevation; if (layer.top !== 'water-bomb') delete layer.top; }
      }
      this.normalizeLayers(i);
      this.trackTemperature(i);
      this.touch(i);
    }
  }
  /** Only real traffic clears weeds; a planned route does not count as use. */
  useRoad(x: number, y: number): void {
    if (!isRoadSurface(this.at(x, y))) return;
    const i = this.index(x, y), state = this.roadWear.get(i);
    if (!state?.age) return;
    if (roadWearStage(state.age)) this.dirty.add(i);
    state.age = 0;
  }
  ageRoads(): void {
    for (const i of this.roadTiles) this.ageRoad(i);
  }
  /** Active and damaged segments age together; only an existing surface is restored. */
  ageRoad(i: number): void {
    if (!isRoadSurface(this.tiles[i]) && !this.roadWear.has(i)) { this.roadTiles.delete(i); return; }
    let state = this.roadWear.get(i);
    if (!state) this.roadWear.set(i, state = { index: i, age: 0, target: isBridge(this.tiles[i]) ? Terrain.Water : Terrain.Grass });
    const previous = roadWearStage(state.age);
    state.age = Math.min(ROAD_OVERGROWTH_SECONDS, state.age + 1);
    if (state.age >= ROAD_OVERGROWTH_SECONDS) {
      this.roadTiles.delete(i); this.dirty.add(i);
      if (isRoadSurface(this.tiles[i])) this.edit(() => {
        this.set(i % this.width, Math.floor(i / this.width), state!.target);
        if (state!.waterDepth) this.setLayers(i % this.width, Math.floor(i / this.width), { waterDepth: state!.waterDepth });
      });
      // Keep a tombstone so repair workers do not rebuild an abandoned track.
      this.roadWear.set(i, state);
    } else if (previous !== roadWearStage(state.age)) this.dirty.add(i);
  }
  circle(x: number, y: number, radius: number, visit: (x: number, y: number, index: number) => void): void {
    for (let ty = Math.max(0, Math.floor(y - radius)); ty <= Math.min(this.height - 1, Math.ceil(y + radius)); ty++) {
      for (let tx = Math.max(0, Math.floor(x - radius)); tx <= Math.min(this.width - 1, Math.ceil(x + radius)); tx++) {
        if ((tx + 0.5 - x) ** 2 + (ty + 0.5 - y) ** 2 <= radius ** 2) visit(tx, ty, ty * this.width + tx);
      }
    }
  }
  markAllDirty(): void { for (let i = 0; i < this.tiles.length; i++) this.dirty.add(i); }
  /** A previous immutable checkpoint can be shared while every saved value agrees.
   * Revision alone is insufficient: moisture and recovery timers change in place. */
  snapshot(previous?: TerrainData): TerrainData {
    const equal = (a: number[], b: number[] | undefined): boolean => {
      if (!b || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    };
    if (previous && (previous.width !== this.width || previous.height !== this.height)) previous = undefined;
    const tiles = equal(this.tiles, previous?.tiles) ? previous!.tiles : this.tiles.slice();
    const moisture = equal(this.moisture, previous?.moisture) ? previous!.moisture : this.moisture.slice();
    const biomes = equal(this.biomes, previous?.biomes) ? previous!.biomes : this.biomes.slice();
    const surfaces = equal(this.surfaces, previous?.surfaces) ? previous!.surfaces : this.surfaces.slice();
    const layers = [...this.layers.values()].map(layer => structuredClone(layer));
    if (previous && previous.visualSeed === this.visualSeed && JSON.stringify(previous.layers) === JSON.stringify(layers)
      && tiles === previous.tiles && moisture === previous.moisture
      && biomes === previous.biomes && surfaces === previous.surfaces
      && previous.recovery.length === this.recovery.size && previous.recovery.every(state => {
        const current = this.recovery.get(state.index);
        return current?.age === state.age && current.target === state.target;
      }) && previous.roadWear?.length === this.roadWear.size && previous.roadWear.every(state => {
        const current = this.roadWear.get(state.index);
        return current?.age === state.age && current.target === state.target && current.waterDepth === state.waterDepth;
      })) return previous;
    return { width: this.width, height: this.height, tiles, moisture, biomes, surfaces, layers, visualSeed: this.visualSeed, recovery: [...this.recovery.values()].map(state => ({ ...state })), roadWear: [...this.roadWear.values()].map(state => ({ ...state })) };
  }
}

export function generateTerrain(seed: number, width = WORLD_WIDTH, height = WORLD_HEIGHT, biomeId: BiomeId = biomeForSeed(seed), nature: NaturalBiome = naturalBiomeForSeed(seed)): TerrainMap {
  const map = new TerrainMap(width, height, undefined, seed);
  // Include the seabed so raised land inherits the world's biome too.
  map.biomes.fill(nature);
  const biome = BIOMES.find(candidate => candidate.id === biomeId)!;
  const scale = Math.min(width, height) * 0.87 / 100;
  const region: { index: number; cover: number; material: number }[] = [];
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
        region.push({ index, cover: surfacePatchNoise(px, py, seed), material: surfacePatchNoise(px, py, seed + 419) });
      }
    }
  }
  // Reserve 15% of the biome for local surfaces, excluding water and beaches.
  region.sort((a, b) => a.cover - b.cover || a.index - b.index);
  const patches = region.slice(0, Math.ceil(region.length * 0.15));
  patches.sort((a, b) => a.material - b.material || a.index - b.index);
  for (let i = 0; i < patches.length; i++) map.surfaces[patches[i].index] = 1 + Math.floor(i * 3 / patches.length);
  return map;
}
