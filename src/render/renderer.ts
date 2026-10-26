import { hasPhysiology } from '../core/physiology';
import { drawEgg, drawReproduction } from './reproduction';
import { drawTileLayers } from './tiles';
import { nearbySubspecies } from '../core/subspecies';
import { subspeciesOf } from '../core/subspecies-state';
import { hasTrait } from '../core/traits';
import { isAdult, unitStats } from '../core/unit-stats';
import { equippedItem } from '../core/equipment';
import { drawEquipmentLoot, drawEquipmentShots } from './equipment';
import { storageFor } from '../core/stockpiles';
import { drawStockpile } from './stockpiles';
import { drawFoodPlant, drawGemSource, resourceEntityLines, resourceVillageLines, wrapResourceLines } from './resources';
import { aboardFerry, ferryRoutes } from '../core/ferries';
import { drawFerries } from './ferries';
import { drawResident, drawResidentSprite } from './residents';
import { drawConstruction, drawStoneHouse } from './construction';
import { drawRuin } from './recovery';
import { drawTemple } from './temples';
import { drawMine } from './mines';
import { insideMine, mineWorkers } from '../core/mines';
import type { ToolDefinition } from '../content/registry';
import { noise } from '../core/random';
import { recoveryStage, roadWearStage } from '../core/terrain';
import { isBridge, ROAD_OVERGROWTH_SECONDS, ROAD_REPAIR_SECONDS, Terrain, type Entity, type Vec2 } from '../core/types';
import type { World } from '../core/world';
import { allianceGroups } from '../core/diplomacy';
import { Camera, TILE } from './camera';
import { drawSprite, drawStatusBubble, villageColor } from './sprites';
import { raceOf } from '../core/races';
import { StatusBubbles, type StatusIcon } from './status-bubbles';
import { DestructionAnimations } from './destruction';
import { HouseCollapseAnimations } from './house-collapse';
import { NapalmAnimations } from './napalm';
import { SuperweaponAnimations } from './superweapons';
import { NAPALM_FIRE_ID, napalmStrikes } from '../content/napalm';
import { rocketPose } from '../core/flight';
import { localizedSettlementName } from '../content/settlement-names';
import { translate, type Language } from '../i18n';
import { residentName } from '../core/village-life';
import { drawAnimal } from './village-life';
import { drawTerritories, territoryLines } from './territory';
import { phenotypeColors } from '../core/phenotypes';
import { drawAppearanceOverlay, drawBurningOverlay } from './appearance';
import { Ocean, OCEAN_COLOR } from './ocean';
import { drawDragon, drawDragonGroundFire, drawDragonShadow } from './dragons';
import { DRAGON_FIRE_ID, dragonGroundPosition } from '../content/dragons';
import { NaturalBiome } from '../core/natural-biomes';
import { drawBiomeDetails, drawBiomeTree } from './natural-biomes';
import { drawKaiju, drawKaijuBeam, drawKaijuGround } from './kaiju';
import { kaijuImpact } from '../content/kaiju';
import { drawThunderstorms } from './thunderstorms';
import { drawHarbor, drawMooring, drawShip, drawShipWake } from './seafaring';
import { drawUfo, drawUfoGround } from './ufos';
import { captureLandPatch, TerraformAnimations } from './terraforming';
import { liftedIds } from '../core/cataclysms';
import { cataclysmShake, drawCataclysmGround, drawCataclysms } from './cataclysms';
import { drawGeohazardGround, drawGeohazardAir, drawVolcano } from './geohazards';

interface Particle { x: number; y: number; vx: number; vy: number; age: number; life: number; color: string; size: number }
const PARTICLE_LIMIT = 600;
const palettes = [
  [OCEAN_COLOR], ['#529fe2'],
  ['#e2dba0', '#ded69a', '#e6dfa6'], ['#7b9d50', '#7d9f52', '#78994d', '#809f54'],
  ['#625d4a', '#6b6350', '#716850'], ['#6a695a', '#626153', '#73705e'],
  ['#baa071', '#c1a87a', '#b49a6c'],
  ['#5b6b59', '#60705b', '#596957'],
];

export class Renderer {
  selectedUnitId: number | null = null;
  readonly camera = new Camera();
  private readonly ctx: CanvasRenderingContext2D;
  private readonly ground = document.createElement('canvas');
  private readonly vignette = document.createElement('canvas');
  private readonly terrainCtx: CanvasRenderingContext2D;
  private readonly ocean = new Ocean();
  private particles: Particle[] = [];
  private readonly renderEntities: Entity[] = [];
  private world: World | undefined;
  private previous = 0;
  private visualSerial = 0;
  private readonly destruction = new DestructionAnimations();
  private readonly collapses = new HouseCollapseAnimations();
  private readonly terraforming = new TerraformAnimations();
  private readonly napalm = new NapalmAnimations();
  private readonly superweapons = new SuperweaponAnimations();
  private readonly statuses = new StatusBubbles();
  private readonly statusSprites: Record<StatusIcon, HTMLCanvasElement>;
  private readonly cloudSprites: HTMLCanvasElement[];
  cursor: Vec2 | undefined;
  tool: ToolDefinition | undefined;
  frameMs = 0;
  constructor(readonly canvas: HTMLCanvasElement, private readonly debugMode = false) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.terrainCtx = this.ground.getContext('2d', { alpha: false })!;
    const bubble = (kind: StatusIcon): HTMLCanvasElement => {
      const sprite = document.createElement('canvas'); sprite.width = 19; sprite.height = 22;
      drawStatusBubble(sprite.getContext('2d')!, kind);
      return sprite;
    };
    this.statusSprites = { heart: bubble('heart'), weapon: bubble('weapon') };
    this.cloudSprites = Array.from({ length: 32 }, (_, variant) => {
      const count = 3 + Math.floor(noise(variant, 7) * 6), length = 22 + noise(variant, 13) * 65;
      const tilt = (noise(variant, 17) - 0.5) * 0.55, bend = (noise(variant, 19) - 0.5) * 18;
      const fullness = 0.65 + noise(variant, 23) * 0.7;
      const puffs = Array.from({ length: count }, (_, puff) => {
        const progress = puff / (count - 1);
        const x = (progress - 0.5) * length + (noise(puff, variant + 31) - 0.5) * 12;
        return {
          x, y: x * tilt + Math.sin(progress * Math.PI) * bend + (noise(puff, variant + 41) - 0.5) * 16,
          rx: Math.max(length / (count - 1) * 0.6, 8 + noise(puff, variant + 53) * 16),
          ry: (6 + noise(puff, variant + 67) * 12) * fullness,
        };
      });
      const left = Math.floor(Math.min(...puffs.map(p => p.x - p.rx)) / 2) * 2 - 6;
      const top = Math.floor(Math.min(...puffs.map(p => p.y - p.ry)) / 2) * 2 - 6;
      const sprite = document.createElement('canvas');
      sprite.width = Math.ceil((Math.max(...puffs.map(p => p.x + p.rx)) - left + 6) / 2) * 2;
      sprite.height = Math.ceil((Math.max(...puffs.map(p => p.y + p.ry)) - top + 6) / 2) * 2;
      const ctx = sprite.getContext('2d')!, silhouette = new Path2D();
      for (const { x, y, rx, ry } of puffs) {
        for (let row = -Math.floor(ry / 2); row <= Math.floor(ry / 2); row++) {
          const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (row * 2 / ry) ** 2)) / 2) * 2;
          silhouette.rect(Math.round((x - left - half) / 2) * 2, Math.round((y - top) / 2) * 2 + row * 2, half * 2, 2);
        }
      }
      ctx.fillStyle = '#cbdde5'; ctx.fill(silhouette);
      ctx.translate(-2, -4); ctx.fillStyle = '#f4f7f2'; ctx.fill(silhouette);
      return sprite;
    });
  }
  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    this.canvas.width = Math.round(width * dpr); this.canvas.height = Math.round(height * dpr);
    this.camera.width = width; this.camera.height = height;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.vignette.width = this.canvas.width; this.vignette.height = this.canvas.height;
    const ctx = this.vignette.getContext('2d')!;
    ctx.scale(dpr * width, dpr * height);
    const gradient = ctx.createRadialGradient(0.55, 0.54, 0.12, 0.55, 0.54, 0.74);
    gradient.addColorStop(0, '#102c5000'); gradient.addColorStop(0.4, '#102c5014');
    gradient.addColorStop(0.7, '#102c5066'); gradient.addColorStop(1, '#102c50cc');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1, 1);
  }
  private drawClouds(world: World): void {
    const { ctx, camera } = this;
    const fade = Math.max(0, Math.min(1, (0.6 - camera.zoom) / 0.38));
    if (!fade) return;
    const opacity = fade * fade * (3 - 2 * fade), scale = camera.zoom * 11.5;
    const time = world.tick / 30;
    // A continuous layer above the world: slower camera movement gives the clouds depth.
    const offsetX = camera.width / 2 - camera.x * TILE * camera.zoom * 0.35 + time * 2.5 * scale;
    const offsetY = camera.height * 0.46 - camera.y * TILE * camera.zoom * 0.35 + time * 0.35 * scale;
    const left = Math.floor((-offsetX / scale - 200) / 190), right = Math.ceil(((camera.width - offsetX) / scale + 200) / 190);
    const top = Math.floor((-offsetY / scale - 140) / 120), bottom = Math.ceil(((camera.height - offsetY) / scale + 140) / 120);
    ctx.save();
    for (let row = top; row <= bottom; row++) for (let column = left; column <= right; column++) {
      const n = noise(column, row, world.seed + 801);
      if (n < 0.18) continue;
      const sprite = this.cloudSprites[Math.floor(noise(column, row, world.seed + 803) * this.cloudSprites.length)];
      const size = scale * (0.8 + noise(column, row, world.seed + 809) * 0.5);
      const x = offsetX + (column * 190 + noise(column, row, world.seed + 811) * 90) * scale;
      const y = offsetY + (row * 120 + noise(column, row, world.seed + 821) * 60) * scale;
      const width = sprite.width * size, height = sprite.height * size;
      if (x + width / 2 < 0 || x - width / 2 > camera.width || y + height / 2 < 0 || y - height / 2 > camera.height) continue;
      ctx.globalAlpha = opacity * (0.22 + n * 0.1);
      ctx.drawImage(sprite, Math.round(x - width / 2), Math.round(y - height / 2), Math.round(width), Math.round(height));
    }
    ctx.restore();
  }
  private terrain(world: World): void {
    if (this.world !== world) {
      this.world = world;
      this.ground.width = world.terrain.width * TILE; this.ground.height = world.terrain.height * TILE;
      world.terrain.markAllDirty(); this.particles = []; this.destruction.reset(); this.collapses.reset(); this.napalm.reset(); this.terraforming.reset();
    }
    this.ocean.update(world.terrain);
    // A changed ridge also changes the exposed edges of its adjacent tiles.
    for (const i of [...world.terrain.dirty]) {
      const x = i % world.terrain.width, y = Math.floor(i / world.terrain.width);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        if (world.terrain.inside(x + dx, y + dy)) world.terrain.dirty.add(world.terrain.index(x + dx, y + dy));
      }
    }
    for (const i of world.terrain.dirty) {
      const x = i % world.terrain.width, y = Math.floor(i / world.terrain.width);
      const tile = world.terrain.tiles[i];
      const layers = world.terrain.layers.get(i);
      if (tile >= Terrain.PitShallow) {
        this.terrainCtx.fillStyle = tile === Terrain.Hill ? '#929480' : tile === Terrain.Summit ? '#626e69'
          : tile === Terrain.PitShallow ? '#777e80' : tile === Terrain.PitClose ? '#545d63' : '#353e49';
        this.terrainCtx.fillRect(x * TILE, y * TILE, TILE, TILE); continue;
      }
      if (tile === Terrain.DeepWater || tile === Terrain.Water) {
        this.ocean.drawTile(this.terrainCtx, x, y, world.seed);
        continue;
      }
      if (isBridge(tile)) {
        this.ocean.drawTile(this.terrainCtx, x, y, world.seed);
        const ctx = this.terrainCtx;
        ctx.save(); ctx.translate(x * TILE, y * TILE);
        ctx.beginPath(); ctx.rect(0, 0, TILE, TILE); ctx.clip();
        if (tile === Terrain.BridgeVertical) { ctx.translate(TILE, 0); ctx.rotate(Math.PI / 2); }
        ctx.fillStyle = '#503d2c'; ctx.fillRect(0, 2, TILE, 6);
        ctx.fillStyle = '#af8752'; ctx.fillRect(0, 1, TILE, 5);
        for (let plank = 0; plank < TILE; plank += 3) {
          ctx.fillStyle = '#d5af74'; ctx.fillRect(plank, 1, 2, 5);
          ctx.fillStyle = '#8b623e'; ctx.fillRect(plank + 2, 1, 1, 5);
        }
        const stage = roadWearStage(world.terrain.roadWear.get(i)?.age ?? 0);
        ctx.fillStyle = '#534b39';
        for (let mark = 0; mark < stage; mark++) ctx.fillRect(1 + mark * 2, 2 + mark % 2, 1, 2);
        ctx.fillStyle = '#765237'; ctx.fillRect(0, 0, TILE, 1); ctx.fillRect(0, 6, TILE, 1);
        ctx.restore();
        continue;
      }
      const n = noise(x, y, world.terrain.visualSeed);
      const biome = world.terrain.biomeAt(x, y);
      const surface = world.terrain.surfaceAt(x, y), cold = biome.id === NaturalBiome.Permafrost;
      const palette = tile === Terrain.Grass ? surface?.colors ?? biome.colors
        : tile === Terrain.Mountain ? surface?.colors ?? (cold ? ['#9bb8b8', '#a6c1bf', '#b5ceca'] : palettes[tile]) : palettes[tile];
      this.terrainCtx.fillStyle = palette[layers?.variant !== undefined && layers.variant < palette.length ? layers.variant : Math.floor(n * palette.length)];
      this.terrainCtx.fillRect(x * TILE, y * TILE, TILE, TILE);
      if (tile === Terrain.Grass) {
        drawBiomeDetails(this.terrainCtx, biome.id, x * TILE, y * TILE, n, surface);
        // A few edge pixels soften the boundary without blurring the pixel art.
        for (const [dx, dy] of [[-1, 0], [0, -1]]) {
          const neighbor = world.terrain.biomeAt(x + dx, y + dy);
          const neighborSurface = world.terrain.surfaceAt(x + dx, y + dy);
          if (neighbor.id === biome.id && neighborSurface === surface || world.terrain.at(x + dx, y + dy) !== Terrain.Grass) continue;
          const colors = neighborSurface?.colors ?? neighbor.colors;
          this.terrainCtx.fillStyle = colors[Math.floor(n * colors.length)];
          this.terrainCtx.fillRect(x * TILE + (dx ? 0 : 2), y * TILE + (dy ? 0 : 2), dx ? 1 : 3, dy ? 1 : 3);
        }
      } else if (tile === Terrain.Mountain) {
        if (surface) drawBiomeDetails(this.terrainCtx, biome.id, x * TILE, y * TILE, n, surface);
        if (world.terrain.at(x, y - 1) !== Terrain.Mountain) {
          this.terrainCtx.fillStyle = cold ? '#bdcfd2' : '#829078';
          this.terrainCtx.fillRect(x * TILE, y * TILE, TILE, 2);
        }
        if (world.terrain.at(x, y + 1) !== Terrain.Mountain) {
          this.terrainCtx.fillStyle = cold ? '#627c8a' : '#465647';
          this.terrainCtx.fillRect(x * TILE, y * TILE + 6, TILE, 2);
        }
        if (n > 0.72) {
          this.terrainCtx.fillStyle = cold ? '#96aeb8' : '#71806a';
          this.terrainCtx.fillRect(x * TILE + 2, y * TILE + 2, 2, 2);
        }
      } else if (tile === Terrain.Sand && n > 0.6) {
        this.terrainCtx.fillStyle = '#b9ae80'; this.terrainCtx.fillRect(x * TILE + 3, y * TILE + 5, 1, 1);
      } else if (tile === Terrain.Crater && n > 0.5) {
        this.terrainCtx.fillStyle = '#55574c'; this.terrainCtx.fillRect(x * TILE + 1, y * TILE + 1, 4, 2);
      } else if (tile === Terrain.Road) {
        this.terrainCtx.fillStyle = '#d1b98a'; this.terrainCtx.fillRect(x * TILE + 2, y * TILE + 3, 3, 1);
        this.terrainCtx.fillStyle = '#99805c'; this.terrainCtx.fillRect(x * TILE + 6, y * TILE + 6, 1, 1);
        const wear = world.terrain.roadWear.get(i), stage = roadWearStage(wear?.age ?? 0);
        const colors = surface?.colors ?? biome.colors;
        this.terrainCtx.fillStyle = wear?.target === Terrain.Sand ? '#ded69a' : colors[Math.floor(n * colors.length)];
        for (let patch = 0; patch < stage * 3; patch++) {
          const px = Math.floor(noise(x + patch * 29, y, world.seed + 31) * 6);
          const py = Math.floor(noise(x, y + patch * 37, world.seed + 53) * 6);
          this.terrainCtx.fillRect(x * TILE + px, y * TILE + py, 3, 3);
        }
      }
      if (world.terrain.roadWear.get(i)?.age === ROAD_OVERGROWTH_SECONDS) {
        this.terrainCtx.fillStyle = tile === Terrain.Sand ? '#a99c77' : '#8a8762';
        this.terrainCtx.fillRect(x * TILE + 1, y * TILE + 4, 2, 1);
        this.terrainCtx.fillRect(x * TILE + 5, y * TILE + 3, 1, 1);
      }
      const recovery = world.terrain.recovery.get(i);
      if (recovery) {
        const stage = recoveryStage(tile, recovery.age);
        this.terrainCtx.fillStyle = tile === Terrain.Crater ? '#8b8063' : recovery.target === Terrain.Sand ? '#c7b980' : surface?.detail ?? biome.detail;
        for (let mark = 0; mark < stage; mark++) {
          this.terrainCtx.fillRect(x * TILE + 1 + mark * 2, y * TILE + (mark % 2 ? 2 : 5), 2, tile === Terrain.Crater ? 2 : 1);
        }
      }
    }
    for (const i of world.terrain.dirty) drawTileLayers(this.terrainCtx, world.terrain.layers.get(i), i % world.terrain.width, Math.floor(i / world.terrain.width));
    world.terrain.dirty.clear();
  }
  private visibleEntities(world: World, origin: Vec2, deckOffsets: ReadonlyMap<number, Vec2>): Entity[] {
    const { camera, renderEntities } = this;
    renderEntities.length = 0;
    for (const entity of world.query('position')) {
      const c = entity.components;
      // These effects have their own bounds, sometimes extending far beyond their origin.
      if (c.harbor || c.ship || c.kaiju || c.projectile) { renderEntities.push(entity); continue; }
      if (c.dragon || c.ufo) continue;
      const sprite = world.registry.entities.get(entity.typeId)?.sprite;
      if (!sprite) continue;
      const offset = deckOffsets.get(entity.id), p = c.position!;
      const x = origin.x + (Math.round(p.x * TILE) + (offset?.x ?? 0)) * camera.zoom;
      const y = origin.y + (Math.round(p.y * TILE) + (offset?.y ?? 0)) * camera.zoom;
      const margin = c.volcano ? 50 * camera.zoom : sprite === 'tree' ? 40 * camera.zoom : 40;
      if (x < -margin || x > camera.width + margin || y < -margin || y > camera.height + Math.max(60, margin)) continue;
      renderEntities.push(entity);
    }
    return renderEntities.sort((a, b) => a.components.position!.y - b.components.position!.y || a.id - b.id);
  }
  draw(world: World, now: number, language: Language = 'en'): void {
    const started = performance.now();
    const elapsed = this.previous && this.world === world ? Math.max(0, Math.min(0.05, (now - this.previous) / 1000)) : 0;
    const dt = elapsed * world.speed;
    this.previous = now;
    const visuals = world.visuals.splice(0);
    const edits = visuals.flatMap(event => event.kind === 'terraform'
      ? [{ event, before: this.world === world ? captureLandPatch(event, this.ground) : undefined }] : []);
    this.terrain(world);
    this.terraforming.update(elapsed);
    for (const edit of edits) this.terraforming.start(edit.event, this.ground, world, edit.before);
    this.statuses.update(world, visuals);
    const { ctx, camera } = this;
    // Keep blast phases readable at high speeds without delaying simulation damage.
    this.destruction.update(world.paused ? 0 : elapsed * Math.min(world.speed, 2));
    this.collapses.update(world.paused ? 0 : elapsed * Math.min(world.speed, 2));
    this.napalm.update(world.paused ? 0 : elapsed * Math.min(world.speed, 2));
    ctx.fillStyle = OCEAN_COLOR; ctx.fillRect(0, 0, camera.width, camera.height);
    const origin = camera.origin;
    const alliance = new Map<number, number>();
    for (const group of allianceGroups(world.society)) for (const id of group) alliance.set(id, group[0]);
    for (const visual of visuals) if (visual.kind === 'collapse') {
      const village = visual.house.components.dwelling?.villageId;
      this.collapses.start(visual, !world.terrain.isLand(visual.x, visual.y), village ? alliance.get(village) : undefined);
    }
    for (const visual of visuals) if (visual.kind === 'blast') {
      const x = visual.x * TILE, y = visual.y * TILE, radius = visual.radius * TILE;
      if (origin.x + (x + radius * 2) * camera.zoom < 0 || origin.x + (x - radius * 2) * camera.zoom > camera.width
        || origin.y + (y + radius * 2) * camera.zoom < 0 || origin.y + (y - radius * 2) * camera.zoom > camera.height) continue;
      const water = !world.terrain.isLand(visual.x, visual.y);
      if (visual.style === 'napalm' && !water) this.napalm.impact(x, y, radius);
      else this.destruction.explode(x, y, radius, water, visual.style === 'napalm' ? undefined : visual.style);
    }
    const shake = this.superweapons.shake(world);
    const clapShake = cataclysmShake(world, (x, y) => origin.x + x * TILE * camera.zoom >= 0 && origin.x + x * TILE * camera.zoom <= camera.width
      && origin.y + y * TILE * camera.zoom >= 0 && origin.y + y * TILE * camera.zoom <= camera.height);
    shake.x += clapShake.x; shake.y += clapShake.y;
    for (const entity of world.query('kaiju', 'position')) {
      const p = entity.components.position!, state = entity.components.kaiju!;
      if (origin.x + p.x * TILE * camera.zoom < -100 || origin.x + p.x * TILE * camera.zoom > camera.width + 100
        || origin.y + p.y * TILE * camera.zoom < -100 || origin.y + p.y * TILE * camera.zoom > camera.height + 100) continue;
      const force = state.phase === 'beam' ? 1 : kaijuImpact(state) * 1.8;
      shake.x += Math.round(Math.sin(state.age * 43) * force); shake.y += Math.round(Math.cos(state.age * 37) * force);
    }
    ctx.save(); ctx.translate(Math.round(origin.x) + this.destruction.shakeX + shake.x, Math.round(origin.y) + this.destruction.shakeY + shake.y); ctx.scale(camera.zoom, camera.zoom);
    this.ocean.drawBackground(ctx, camera, world.seed);
    ctx.drawImage(this.ground, 0, 0);
    this.terraforming.ground(ctx);
    this.superweapons.ground(ctx, world);
    drawCataclysmGround(ctx, world);
    drawGeohazardGround(ctx, world);
    this.ocean.drawWaves(ctx, world, false);
    this.collapses.ground(ctx);
    drawTerritories(ctx, world, camera.zoom);
    drawEquipmentLoot(ctx, world);
    for (const entity of world.query('kaiju', 'position')) {
      const p = entity.components.position!;
      drawKaijuGround(ctx, p, entity.components.kaiju!, !world.terrain.isLand(p.x, p.y));
    }
    drawFerries(ctx, world);
    for (const entity of world.query('ship', 'position')) {
      drawShipWake(ctx, entity);
      for (const harbor of world.query('harbor', 'position')) drawMooring(ctx, entity, harbor);
    }
    for (const entity of world.query('ufo', 'position')) {
      drawUfoGround(ctx, entity.components.position!, entity.components.ufo!);
    }
    const airstrikes = napalmStrikes(world);
    this.napalm.shadows(ctx, airstrikes, world.terrain.width, world.terrain.height);
    for (const entity of world.query('dragon', 'position')) {
      drawDragonShadow(ctx, dragonGroundPosition(entity.components.position!, entity.components.dragon!), entity.components.dragon!.heading, world.tick / 30 + entity.id * 0.173, entity.components.dragon!.breath > 0);
    }
    for (const entity of world.query('projectile', 'position')) {
      this.destruction.rocketShadow(ctx, entity.components.position!, entity.components.projectile!);
    }
    for (const group of world.society.migrations) {
      const leader = world.entities.get(group.members[0])?.components.position;
      if (!leader) continue;
      ctx.strokeStyle = '#e3cb8580'; ctx.lineWidth = 1 / camera.zoom; ctx.setLineDash([3, 6]);
      ctx.beginPath(); ctx.moveTo(leader.x * TILE, leader.y * TILE); ctx.lineTo(group.destination.x * TILE, group.destination.y * TILE); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeRect(group.destination.x * TILE - 10, group.destination.y * TILE - 10, 20, 20);
    }
    for (const war of world.society.wars) {
      const rally = world.society.villages.find(v => v.id === war.rallyVillage), target = world.society.villages.find(v => v.id === war.attackTarget);
      if (!rally || !target) continue;
      const gathering = world.tick < war.musterUntil, point = gathering ? rally : target;
      ctx.strokeStyle = gathering ? '#f1d385a0' : '#ed9177a0'; ctx.lineWidth = 1 / camera.zoom;
      ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(rally.x * TILE, rally.y * TILE); ctx.lineTo(target.x * TILE, target.y * TILE); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeRect(point.x * TILE - 16, point.y * TILE - 16, 32, 32);
    }
    const time = world.tick / 30;
    const deckOffsets = new Map<number, Vec2>();
    for (const { ferry } of ferryRoutes(world)) ferry.passengers.forEach((id, n) => {
      if (!world.entities.get(id)?.components.caravan) deckOffsets.set(id, { x: (n % 3 - 1) * 5, y: Math.floor(n / 3) * 4 - 2 });
    });
    const entities = this.visibleEntities(world, origin, deckOffsets);
    const lifted = liftedIds(world);
    for (const entity of entities) {
      if (lifted.has(entity.id)) continue;
      this.collapses.drawBefore(ctx, entity.components.position!.y * TILE);
      if (entity.components.harbor || entity.components.ship) {
        const owner = entity.components.harbor?.villageId ?? world.entities.get(entity.components.ship?.homeId ?? -1)?.components.harbor?.villageId;
        const color = entity.components.foreignVoyage ? entity.components.foreignVoyage.kind === 'merchants' ? '#d9a441' : '#658d72'
          : owner ? villageColor(owner) : undefined;
        if (entity.components.harbor) drawHarbor(ctx, entity, time, color);
        else drawShip(ctx, entity, time, color);
        if (entity.components.thermal?.burning) drawBurningOverlay(ctx, entity.components.position!.x * TILE, entity.components.position!.y * TILE, time + entity.id);
        continue;
      }
      if (entity.components.dragon || entity.components.ufo || insideMine(entity)) continue;
      if (entity.components.kaiju) {
        const p = entity.components.position!;
        drawKaiju(ctx, p, entity.components.kaiju, !world.terrain.isLand(p.x, p.y));
        continue;
      }
      const { position: p, appearance, person, thermal, projectile, explosive, citizen, dwelling, farm, caravan } = entity.components;
      const sprite = world.registry.entities.get(entity.typeId)?.sprite;
      if (!sprite) continue;
      const submerged = !projectile && !aboardFerry(world, entity.id) && world.terrain.isOpenWater(p!.x, p!.y);
      const offset = deckOffsets.get(entity.id);
      const x = Math.round(p!.x * TILE) + (offset?.x ?? 0), y = Math.round(p!.y * TILE) + (offset?.y ?? 0);
      if (projectile) {
        this.destruction.target(ctx, x, y, projectile.remaining, projectile.duration);
        continue;
      }
      const screenX = origin.x + x * camera.zoom, screenY = origin.y + y * camera.zoom;
      const margin = entity.components.volcano ? 50 * camera.zoom : sprite === 'tree' ? 40 * camera.zoom : 40;
      if (screenX < -margin || screenX > camera.width + margin || screenY < -margin || screenY > camera.height + Math.max(60, margin)) continue;
      if (entity.typeId === NAPALM_FIRE_ID) {
        if (thermal?.burning && !submerged) this.napalm.fire(ctx, x, y, entity.components.combustible!.fuel, time, entity.id);
        continue;
      }
      if (entity.typeId === DRAGON_FIRE_ID) {
        if (thermal?.burning && !submerged) drawDragonGroundFire(ctx, p!, entity.components.combustible!.fuel, time, entity.id);
        continue;
      }
      ctx.save(); ctx.translate(x, y);
      if (hasTrait(entity,'light-lamp') || hasTrait(entity,'shiny')) {
        ctx.save(); ctx.fillStyle = hasTrait(entity,'light-lamp') ? '#ffe6a450' : '#fff7cf';
        if (hasTrait(entity,'light-lamp')) { ctx.beginPath(); ctx.arc(0,-8,18,0,Math.PI*2); ctx.fill(); }
        if (hasTrait(entity,'shiny')) { const phase = Math.floor(world.tick / 12 + entity.id) % 4; ctx.fillRect(phase < 2 ? -9 : 7,-18+phase*3,2,2); }
        ctx.restore();
      }
      if (entity.components.stats) { const scale = unitStats(world, entity).values.scale; ctx.scale(scale, scale); }
      if (submerged && person) {
        ctx.beginPath(); ctx.rect(-20, -40, 40, 40); ctx.clip(); ctx.translate(0, !isAdult(entity) ? 4 : 6);
      } else if (submerged) {
        ctx.globalAlpha = 0.65;
        if (explosive) { ctx.beginPath(); ctx.rect(-20, -9, 40, 30); ctx.clip(); }
      }
      if (hasPhysiology(entity, 'bioluminescence')) {
        const light = ctx.createRadialGradient(0, -5, 2, 0, -5, 18);
        light.addColorStop(0, '#d8ffb980'); light.addColorStop(1, '#d8ffb900');
        ctx.fillStyle = light; ctx.fillRect(-18, -23, 36, 36);
      }
      const villageId = citizen?.villageId ?? dwelling?.villageId ?? caravan?.fromId ?? entity.components.animal?.villageId ?? entity.components.workplace?.villageId ?? entity.components.temple?.villageId ?? entity.components.ruin?.villageId;
      if (caravan?.path[caravan.next] && caravan.path[caravan.next].x < p!.x) ctx.scale(-1, 1);
      const race = caravan ? world.society.villages.find(v => v.id === caravan.fromId)?.race ?? 'human' : raceOf(entity);
      if (entity.components.monsterHunter) {
        const hunter = entity.components.monsterHunter, target = world.entities.get(hunter.targetId ?? -1);
        drawResidentSprite(ctx, { time, color: '#658d72', variant: entity.id % 5, heading: hunter.heading,
          stride: hunter.stride, moving: hunter.moving ? 1 : 0, action: hunter.moving ? 'walk' : hunter.cooldown > 0 && !hunter.returning ? 'fight' : 'idle',
          work: 1 - hunter.cooldown / 1.25, tool: 'bow', ...(Object.values(hunter.loot).some(n => n > 0) ? { load: 'pack' as const } : {}) });
        if (!hunter.returning && hunter.cooldown > 1.05 && target?.components.position) {
          const progress = (1.25 - hunter.cooldown) / 0.2, q = target.components.position;
          const dx = (q.x - p!.x) * TILE, dy = (q.y - p!.y) * TILE - (target.components.dragon ? 20 : 8);
          ctx.strokeStyle = '#ecd7ab'; ctx.lineWidth = 1; ctx.beginPath();
          ctx.moveTo(dx * Math.max(0, progress - 0.12), -8 + (dy + 8) * Math.max(0, progress - 0.12));
          ctx.lineTo(dx * progress, -8 + (dy + 8) * progress); ctx.stroke();
        }
      }
      else if (entity.components.reproduction?.egg) drawEgg(ctx, entity, world.tick);
      else if (person) drawResident(ctx, world, entity, villageId ? villageColor(villageId) : undefined);
      else if (entity.components.building?.kind === 'core:mine') drawMine(ctx, entity, mineWorkers(world, entity).some(insideMine), world.tick);
      else if (entity.components.building?.kind === 'core:temple') drawTemple(ctx, entity, world.tick, villageId ? villageColor(villageId) : undefined);
      else if (entity.components.building?.project && !entity.components.ruin) drawConstruction(ctx, entity, world.tick, villageId ? villageColor(villageId) : undefined, sprite);
      else if (entity.components.stockpile) drawStockpile(ctx, storageFor(world, entity.id), entity.components.stockpile.resistance);
      else if (entity.components.foodPlant) drawFoodPlant(ctx, entity);
      else if (entity.components.gemSource?.kind === 'plant') drawGemSource(ctx, true);
      else if (entity.components.volcano) drawVolcano(ctx, entity.components.volcano);
      else if (entity.components.animal) drawAnimal(ctx, entity.components.animal, villageId ? villageColor(villageId) : undefined, isAdult(entity), phenotypeColors(entity));
      else if (entity.components.ruin) drawRuin(ctx, entity);
      else if (dwelling?.level === 2) drawStoneHouse(ctx, entity, time, villageId ? villageColor(villageId) : undefined);
      else if (sprite === 'tree' && entity.components.tree) {
        const tree = entity.components.tree, scale = tree.age < 30 ? 0.35 : tree.age < 120 ? 0.65 : 1;
        ctx.scale(scale, scale);
        if (!drawBiomeTree(ctx, tree.biome, appearance?.variant)) drawSprite(ctx, sprite, appearance?.variant, time + entity.id);
      }
      else if (sprite !== 'tree' || !drawBiomeTree(ctx, world.terrain.biomeAt(p!.x, p!.y).id, appearance?.variant)) {
        drawSprite(ctx, sprite, appearance?.variant, time + entity.id, false, caravan ? caravan.gems ? caravan.gems / 4 : caravan.food / 12 : farm?.growth, villageId ? villageColor(villageId) : undefined, race);
      }
      if (entity.components.gemSource?.kind === 'ore') drawGemSource(ctx);
      if (caravan?.gems) { ctx.fillStyle = '#c3a4f2'; ctx.fillRect(-4, -9, 3, 4); ctx.fillRect(1, -11, 3, 5); }
      drawAppearanceOverlay(ctx, entity, world.tick / 30);
      drawReproduction(ctx, entity, world.tick);
      if (!entity.components.stockpile) drawStockpile(ctx, storageFor(world, entity.id));
      ctx.restore();
      if (person && world.society.villages.some(v => v.government?.leaderId === entity.id)) {
        ctx.fillStyle = '#775b2e'; ctx.fillRect(x - 4, y - 24, 9, 4);
        ctx.fillStyle = '#f4d475'; ctx.fillRect(x - 3, y - 24, 7, 3); ctx.fillRect(x, y - 27, 1, 6);
        ctx.fillRect(x - 3, y - 26, 1, 3); ctx.fillRect(x + 3, y - 26, 1, 3);
      }
      if (submerged) {
        const wave = Math.floor(Math.sin(time * 5 + entity.id) * 2);
        ctx.fillStyle = '#acdfe5b0'; ctx.fillRect(x - 6 - wave, y + 1, 4, 1); ctx.fillRect(x + 3 + wave, y + 1, 4, 1);
        if (person && entity.components.health) {
          ctx.fillStyle = '#203e50'; ctx.fillRect(x - 5, y - 12, 10, 2);
          ctx.fillStyle = '#a9dce8'; ctx.fillRect(x - 5, y - 12, 10 * entity.components.health.current / entity.components.health.max, 2);
        }
      }
      if (dwelling?.villageId && !entity.components.building?.project) {
        ctx.fillStyle = '#524a35'; ctx.fillRect(x + 11, y - 21, 1, 22);
        ctx.fillStyle = villageColor(dwelling.villageId); ctx.fillRect(x + 12, y - 21, 7, 5);
        const leader = alliance.get(dwelling.villageId);
        if (leader) { ctx.fillStyle = villageColor(leader); ctx.fillRect(x + 12, y - 14, 7, 3); }
      }
      if (citizen?.emergency) {
        const kind = citizen.emergency.kind;
        ctx.fillStyle = kind === 'flee' ? '#f5b45b' : kind === 'aid' ? '#9cddad' : '#95d9ef';
        if (kind === 'aid') { ctx.fillRect(x - 1, y - 19, 2, 6); ctx.fillRect(x - 3, y - 17, 6, 2); }
        else if (kind === 'flee') { ctx.fillRect(x, y - 20, 2, 5); ctx.fillRect(x, y - 13, 2, 1); }
        else { ctx.fillRect(x, y - 20, 1, 2); ctx.fillRect(x - 1, y - 18, 3, 3); }
      } else if (citizen?.task === 'fight') {
        ctx.fillStyle = '#ce6451'; ctx.fillRect(x - 3, y - 14, 7 * (entity.components.health!.current / entity.components.health!.max), 1);
      } else if (citizen?.task === 'repair' && citizen.repair) {
        ctx.fillStyle = '#454a38'; ctx.fillRect(x - 4, y - 15, 8, 2);
        ctx.fillStyle = '#e4c46f'; ctx.fillRect(x - 4, y - 15, 8 * (1 - citizen.repair.remaining / ROAD_REPAIR_SECONDS), 2);
      } else if (citizen && citizen.hunger >= 75) {
        ctx.fillStyle = '#edaa61'; ctx.fillRect(x, y - 16, 2, 4); ctx.fillRect(x, y - 10, 2, 1);
      }
      if (thermal?.burning && !submerged) drawBurningOverlay(ctx, x, y, time + entity.id);
      if (explosive && !projectile) {
        ctx.fillStyle = '#263b3c'; ctx.fillRect(x - 6, y - 17, 12, 2);
        ctx.fillStyle = '#f3d393'; ctx.fillRect(x - 6, y - 17, Math.max(0, explosive.fuse / 2) * 12, 2);
        if (sprite === 'dynamite') this.destruction.fuse(ctx, x, y, explosive.fuse, entity.id, submerged);
      }
    }
    this.collapses.drawBefore(ctx);
    if (camera.zoom >= 0.65) for (const village of world.society.villages) {
      const x = village.x * TILE, y = village.y * TILE - 38;
      const name = localizedSettlementName(world.seed, village, language);
      ctx.font = language === 'ja' ? '10px "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif'
        : language === 'zh-CN' ? '10px "PingFang SC", "Microsoft YaHei", sans-serif' : '10px "Ark Pixel 10", monospace';
      ctx.textAlign = 'center';
      const width = ctx.measureText(name).width + 12;
      ctx.fillStyle = '#21382bd9'; ctx.fillRect(x - width / 2, y - 10, width, 15);
      ctx.fillStyle = villageColor(village.id); ctx.fillText(name, x, y);
      if (village.government?.leaderId != null) {
        ctx.fillStyle = '#26382d'; ctx.fillRect(x - 16, y + 7, 32, 2);
        ctx.fillStyle = village.government.trust < 30 ? '#df885e' : '#a5c77b'; ctx.fillRect(x - 16, y + 7, 32 * village.government.trust / 100, 2);
      }
      if (this.debugMode && this.cursor && camera.zoom >= 0.65 && Math.hypot(this.cursor.x - village.x, this.cursor.y - village.y) < 4) {
        const g = village.government, e = village.economy;
        const herd = [...world.query('animal')].filter(a => a.components.animal!.villageId === village.id);
        let lines = [...territoryLines(world, village, language), g?.leaderId ? translate('Elder: {name} · Trust: {trust}%', language, { name: residentName(g.leaderId, world), trust: Math.round(g.trust) }) : translate('No elder elected', language),
          translate('Sheep: {sheep} · Dogs: {dogs}', language, { sheep: herd.filter(a => a.components.animal!.kind === 'sheep').length, dogs: herd.filter(a => a.components.animal!.kind === 'dog').length }),
          ...resourceVillageLines(world, village, language),
          ...(e ? [translate('Grain: {grain} · Flour: {flour} · Bread: {bread}', language, { grain: Math.floor(e.stocks.grain), flour: Math.floor(e.stocks.flour), bread: Math.floor(e.stocks.bread) }),
            translate('Wood: {wood} · Tools: {tools} · Deliveries: {count}', language, { wood: Math.floor(e.stocks.wood), tools: Math.floor(e.stocks.tools), count: e.deliveries }),
            translate('Stone: {stone} · Axes in stock: {axes}', language, { stone: Math.floor(e.stocks.stone), axes: e.stocks.stoneAxes }),
            translate('Stone homes: {homes} · Armed residents: {armed}', language, {
              homes: [...world.query('dwelling')].filter(e => e.components.dwelling!.villageId === village.id && e.components.dwelling!.level === 2).length,
              armed: [...world.query('citizen')].filter(e => e.components.citizen!.villageId === village.id && !!equippedItem(world, e.id, 'weapon')).length,
            })] : [])];
        ctx.save(); ctx.translate(x, y + 13); ctx.scale(1 / camera.zoom, 1 / camera.zoom);
        ctx.font = ctx.font.replace('10px', '12px');
        lines = wrapResourceLines(ctx, lines, Math.min(560, camera.width - 32));
        const panelWidth = Math.max(...lines.map(line => ctx.measureText(line).width)) + 20, panelHeight = lines.length * 18 + 12;
        const screenX = origin.x + x * camera.zoom, screenY = origin.y + (y + 13) * camera.zoom;
        const left = Math.max(6 - screenX, Math.min(-panelWidth / 2, camera.width - screenX - panelWidth - 6));
        const top = screenY + panelHeight > camera.height - 6 ? -panelHeight - 24 : 0;
        ctx.fillStyle = '#1d2e28f2'; ctx.fillRect(left, top, panelWidth, panelHeight);
        ctx.fillStyle = '#eee3bf'; lines.forEach((line, i) => ctx.fillText(line, left + panelWidth / 2, top + 18 + i * 18));
        ctx.restore();
      }
    }
    if (this.debugMode && this.cursor && camera.zoom >= 0.8) {
      const pointed = world.nearby(this.cursor, 1.2).filter(e => e.components.position && resourceEntityLines(e, language, world).length)
        .sort((a, b) => Math.hypot(a.components.position!.x - this.cursor!.x, a.components.position!.y - this.cursor!.y)
          - Math.hypot(b.components.position!.x - this.cursor!.x, b.components.position!.y - this.cursor!.y))[0];
      if (pointed) {
        ctx.save(); ctx.translate(this.cursor.x * TILE, this.cursor.y * TILE - 28); ctx.scale(1 / camera.zoom, 1 / camera.zoom);
        ctx.font = '12px monospace'; ctx.textAlign = 'left';
        const lines = wrapResourceLines(ctx, resourceEntityLines(pointed, language, world), Math.min(560, camera.width - 32));
        const width = Math.max(...lines.map(line => ctx.measureText(line).width)) + 16;
        const screenX = origin.x + this.cursor.x * TILE * camera.zoom;
        const screenY = origin.y + (this.cursor.y * TILE - 28) * camera.zoom;
        const left = Math.max(6 - screenX, Math.min(-width / 2, camera.width - screenX - width - 6));
        const top = Math.max(6 - screenY, -lines.length * 18 - 8);
        ctx.fillStyle = '#1d2e28f2'; ctx.fillRect(left, top, width, lines.length * 18 + 8);
        ctx.fillStyle = '#eee3bf'; lines.forEach((line, i) => ctx.fillText(line, left + 8, top + 14 + i * 18));
        ctx.restore();
      }
    }
    ctx.textAlign = 'start';
    this.ocean.drawWaves(ctx, world, true);
    this.terraforming.spray(ctx, world);
    for (const entity of world.query('kaiju', 'position')) {
      drawKaijuBeam(ctx, entity.components.position!, entity.components.kaiju!, world.terrain.width, world.terrain.height);
    }
    for (const entity of world.query('dragon', 'position')) {
      drawDragon(ctx, entity.components.position!, entity.components.dragon!, time + entity.id * 0.173);
    }
    // Airborne rockets and their exhaust stay above buildings and treetops.
    for (const entity of world.query('ufo', 'position')) {
      drawUfo(ctx, entity.components.position!, entity.components.ufo!);
    }
    for (const entity of world.query('projectile', 'position')) {
      const { position: p, projectile } = entity.components;
      const sprite = world.registry.entities.get(entity.typeId)?.sprite;
      if (!sprite) continue;
      const pose = rocketPose(p!, projectile!), x = pose.x * TILE, y = pose.y * TILE;
      if (origin.x + (x + 200) * camera.zoom < 0 || origin.x + (x - 200) * camera.zoom > camera.width
        || origin.y + (y + 200) * camera.zoom < 0 || origin.y + (y - 200) * camera.zoom > camera.height) continue;
      this.destruction.rocket(ctx, p!, projectile!, sprite, entity.components.appearance?.variant);
    }
    drawEquipmentShots(ctx, world);
    this.destruction.draw(ctx);
    this.napalm.drawImpacts(ctx);
    this.napalm.airborne(ctx, airstrikes, world.terrain.width, world.terrain.height);
    this.superweapons.airborne(ctx, world, -origin.y / camera.zoom - 80);
    for (const visual of visuals) {
      if (visual.kind !== 'birth' && visual.kind !== 'build' && visual.kind !== 'fireworks') continue;
      const fireworks = visual.kind === 'fireworks', count = fireworks ? 48 : 12;
      const serial = this.visualSerial++;
      for (let i = 0; i < count && this.particles.length < PARTICLE_LIMIT; i++) {
        const n = noise(i, serial), angle = n * Math.PI * 2;
        this.particles.push({ x: visual.x * TILE, y: visual.y * TILE - (fireworks ? 30 : 0), vx: Math.cos(angle) * (fireworks ? 40 : 10), vy: Math.sin(angle) * (fireworks ? 40 : 10) - 12,
          age: 0, life: fireworks ? 1.8 : 0.7, color: fireworks ? ['#ff8d94', '#a4dfab', '#a1ccff', '#ffe99e'][i % 4] : '#e8dfad', size: 2 });
      }
    }
    for (const particle of this.particles) {
      if (!world.paused) { particle.age += dt; particle.x += particle.vx * dt; particle.y += particle.vy * dt; particle.vy += dt * 20; }
      ctx.globalAlpha = Math.max(0, 1 - particle.age / particle.life);
      ctx.fillStyle = particle.color; ctx.fillRect(Math.round(particle.x), Math.round(particle.y), particle.size, particle.size);
    }
    this.particles = this.particles.filter(p => p.age < p.life);
    ctx.globalAlpha = 1;
    for (const effect of world.effects) {
      ctx.fillStyle = '#b8e6ee90';
      for (let i = 0; i < 80; i++) {
        const angle = noise(i, 7) * Math.PI * 2, distance = Math.sqrt(noise(i, 13)) * effect.radius * TILE;
        const x = effect.x * TILE + Math.cos(angle) * distance;
        const y = effect.y * TILE + Math.sin(angle) * distance + ((time * 80 + i * 7) % 15) - 7;
        ctx.fillRect(Math.round(x), Math.round(y), 1, 5);
      }
    }
    drawThunderstorms(ctx, world);
    drawGeohazardAir(ctx, world);
    drawCataclysms(ctx, world);
    // Overlay badges after the scene so houses and trees cannot cover them.
    // Only residents are visited; the two cached bitmaps need one draw call each.
    for (const person of world.query('person', 'position')) {
      if (lifted.has(person.id) || insideMine(person)) continue;
      const kind = this.statuses.icon(person), p = person.components.position!;
      if (!kind || !world.terrain.isLand(p.x, p.y)) continue;
      const x = Math.round(p.x * TILE) - 9, y = Math.round(p.y * TILE) - 37;
      if (origin.x + (x + 19) * camera.zoom < 0 || origin.x + x * camera.zoom > camera.width
        || origin.y + (y + 22) * camera.zoom < 0 || origin.y + y * camera.zoom > camera.height) continue;
      if (kind === 'heart' && !this.statuses.placeHeart(p)) continue;
      ctx.drawImage(this.statusSprites[kind], x, y);
    }
    const selected = world.entities.get(this.selectedUnitId ?? -1)?.components.position;
    if (selected) {
      ctx.strokeStyle = '#ffe99c'; ctx.lineWidth = 2 / camera.zoom;
      ctx.beginPath(); ctx.ellipse(selected.x * TILE, selected.y * TILE, 10 / camera.zoom, 5 / camera.zoom, 0, 0, Math.PI * 2); ctx.stroke();
    }
    if (this.cursor && this.tool && world.terrain.inside(this.cursor.x, this.cursor.y)) {
      const { x, y } = this.cursor;
      const valid = this.tool.canApply?.(world, this.cursor) ?? true;
      ctx.strokeStyle = valid ? this.tool.color : '#ed9c8c';
      ctx.fillStyle = valid ? `${this.tool.color}12` : '#ed9c8c18'; ctx.lineWidth = 1 / camera.zoom;
      if (this.tool.showArea !== false) {
        ctx.setLineDash([3 / camera.zoom, 3 / camera.zoom]);
        ctx.beginPath(); ctx.arc(x * TILE, y * TILE, Math.max(5 / camera.zoom, this.tool.radius * TILE), 0, Math.PI * 2);
        ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.fillStyle = valid ? this.tool.color : '#ed9c8c'; ctx.fillRect(x * TILE - 1, y * TILE - 1, 2, 2);
      const placement = this.debugMode && valid && this.tool.creaturePlacement?.(world, this.cursor);
      if (placement) {
        const speciesId = world.registry.entities.get(placement.typeId)?.speciesId;
        const donor = speciesId && nearbySubspecies(world, speciesId, placement.point);
        const shared = donor && subspeciesOf(donor);
        ctx.strokeStyle = '#d6edc3'; ctx.lineWidth = 1.5 / camera.zoom;
        if (donor) {
          const q = donor.components.position!;
          ctx.setLineDash([4 / camera.zoom, 3 / camera.zoom]); ctx.beginPath();
          ctx.moveTo(placement.point.x * TILE, placement.point.y * TILE); ctx.lineTo(q.x * TILE, q.y * TILE); ctx.stroke(); ctx.setLineDash([]);
        }
        const label = translate(shared ? 'Subspecies {id}' : 'New subspecies', language, { id: shared ? shared.id : 0 });
        ctx.save(); ctx.translate(x * TILE, y * TILE - 18 / camera.zoom); ctx.scale(1 / camera.zoom, 1 / camera.zoom);
        ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; const width = ctx.measureText(label).width + 12;
        ctx.fillStyle = '#172b2de8'; ctx.fillRect(-width / 2, -13, width, 19); ctx.fillStyle = '#e5f5d9'; ctx.fillText(label, 0, 0); ctx.restore();
      }
    }
    ctx.restore();
    this.drawClouds(world);
    this.superweapons.flash(ctx, world, camera.width, camera.height, origin, camera.zoom);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.vignette.width && this.vignette.height) ctx.drawImage(this.vignette, 0, 0);
    ctx.restore();
    this.frameMs = performance.now() - started;
  }
}
