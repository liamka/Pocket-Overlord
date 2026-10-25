import { aboardFerry, ferryRoutes } from '../core/ferries';
import { drawFerries } from './ferries';
import { drawResident } from './residents';
import { drawConstruction } from './construction';
import { drawRuin } from './recovery';
import type { ToolDefinition } from '../content/registry';
import { noise } from '../core/random';
import { recoveryStage, roadWearStage } from '../core/terrain';
import { isBridge, ROAD_REPAIR_SECONDS, Terrain, type Vec2 } from '../core/types';
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
  readonly camera = new Camera();
  private readonly ctx: CanvasRenderingContext2D;
  private readonly ground = document.createElement('canvas');
  private readonly terrainCtx: CanvasRenderingContext2D;
  private readonly ocean = new Ocean();
  private particles: Particle[] = [];
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
  cursor: Vec2 | undefined;
  tool: ToolDefinition | undefined;
  frameMs = 0;
  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.terrainCtx = this.ground.getContext('2d', { alpha: false })!;
    const bubble = (kind: StatusIcon): HTMLCanvasElement => {
      const sprite = document.createElement('canvas'); sprite.width = 19; sprite.height = 22;
      drawStatusBubble(sprite.getContext('2d')!, kind);
      return sprite;
    };
    this.statusSprites = { heart: bubble('heart'), weapon: bubble('weapon') };
  }
  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    this.canvas.width = Math.round(width * dpr); this.canvas.height = Math.round(height * dpr);
    this.camera.width = width; this.camera.height = height;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
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
        ctx.fillStyle = '#765237'; ctx.fillRect(0, 0, TILE, 1); ctx.fillRect(0, 6, TILE, 1);
        ctx.restore();
        continue;
      }
      const n = noise(x, y, world.seed);
      const biome = world.terrain.biomeAt(x, y);
      const surface = world.terrain.surfaceAt(x, y), cold = biome.id === NaturalBiome.Permafrost;
      const palette = tile === Terrain.Grass ? surface?.colors ?? biome.colors
        : tile === Terrain.Mountain ? surface?.colors ?? (cold ? ['#9bb8b8', '#a6c1bf', '#b5ceca'] : palettes[tile]) : palettes[tile];
      this.terrainCtx.fillStyle = palette[Math.floor(n * palette.length)];
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
      const recovery = world.terrain.recovery.get(i);
      if (recovery) {
        const stage = recoveryStage(tile, recovery.age);
        this.terrainCtx.fillStyle = tile === Terrain.Crater ? '#8b8063' : recovery.target === Terrain.Sand ? '#c7b980' : surface?.detail ?? biome.detail;
        for (let mark = 0; mark < stage; mark++) {
          this.terrainCtx.fillRect(x * TILE + 1 + mark * 2, y * TILE + (mark % 2 ? 2 : 5), 2, tile === Terrain.Crater ? 2 : 1);
        }
      }
    }
    world.terrain.dirty.clear();
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
    for (const entity of world.query('kaiju', 'position')) {
      const p = entity.components.position!, state = entity.components.kaiju!;
      if (origin.x + p.x * TILE * camera.zoom < -100 || origin.x + p.x * TILE * camera.zoom > camera.width + 100
        || origin.y + p.y * TILE * camera.zoom < -100 || origin.y + p.y * TILE * camera.zoom > camera.height + 100) continue;
      const force = state.phase === 'beam' ? 1 : kaijuImpact(state) * 1.8;
      shake.x += Math.round(Math.sin(state.age * 43) * force); shake.y += Math.round(Math.cos(state.age * 37) * force);
    }
    ctx.save(); ctx.translate(Math.round(origin.x) + this.destruction.shakeX + shake.x, Math.round(origin.y) + this.destruction.shakeY + shake.y); ctx.scale(camera.zoom, camera.zoom);
    ctx.drawImage(this.ground, 0, 0);
    this.terraforming.ground(ctx);
    this.superweapons.ground(ctx, world);
    this.ocean.drawWaves(ctx, world, false);
    this.collapses.ground(ctx);
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
    const entities = [...world.query('position')].sort((a, b) => a.components.position!.y - b.components.position!.y || a.id - b.id);
    for (const entity of entities) {
      this.collapses.drawBefore(ctx, entity.components.position!.y * TILE);
      if (entity.components.harbor || entity.components.ship) {
        const owner = entity.components.harbor?.villageId ?? world.entities.get(entity.components.ship?.homeId ?? -1)?.components.harbor?.villageId;
        const color = owner ? villageColor(owner) : undefined;
        if (entity.components.harbor) drawHarbor(ctx, entity, time, color);
        else drawShip(ctx, entity, time, color);
        if (entity.components.thermal?.burning) this.flame(entity.components.position!.x * TILE, entity.components.position!.y * TILE, time + entity.id);
        continue;
      }
      if (entity.components.dragon || entity.components.ufo) continue;
      if (entity.components.kaiju) {
        const p = entity.components.position!;
        drawKaiju(ctx, p, entity.components.kaiju, !world.terrain.isLand(p.x, p.y));
        continue;
      }
      const { position: p, appearance, person, thermal, projectile, explosive, citizen, dwelling, farm, caravan } = entity.components;
      const sprite = world.registry.entities.get(entity.typeId)?.sprite;
      if (!sprite) continue;
      const submerged = !projectile && !aboardFerry(world, entity.id) && !world.terrain.isLand(p!.x, p!.y);
      const offset = deckOffsets.get(entity.id);
      const x = Math.round(p!.x * TILE) + (offset?.x ?? 0), y = Math.round(p!.y * TILE) + (offset?.y ?? 0);
      if (projectile) {
        this.destruction.target(ctx, x, y, projectile.remaining, projectile.duration);
        continue;
      }
      const screenX = origin.x + x * camera.zoom, screenY = origin.y + y * camera.zoom;
      if (screenX < -40 || screenX > camera.width + 40 || screenY < -40 || screenY > camera.height + 60) continue;
      if (entity.typeId === NAPALM_FIRE_ID) {
        if (thermal?.burning && !submerged) this.napalm.fire(ctx, x, y, entity.components.combustible!.fuel, time, entity.id);
        continue;
      }
      if (entity.typeId === DRAGON_FIRE_ID) {
        if (thermal?.burning && !submerged) drawDragonGroundFire(ctx, p!, entity.components.combustible!.fuel, time, entity.id);
        continue;
      }
      ctx.save(); ctx.translate(x, y);
      if (submerged && person) {
        ctx.beginPath(); ctx.rect(-20, -40, 40, 40); ctx.clip(); ctx.translate(0, person.age < 18 ? 4 : 6);
      } else if (submerged) {
        ctx.globalAlpha = 0.65;
        if (explosive) { ctx.beginPath(); ctx.rect(-20, -9, 40, 30); ctx.clip(); }
      }
      const villageId = citizen?.villageId ?? dwelling?.villageId ?? caravan?.fromId ?? entity.components.animal?.villageId ?? entity.components.workplace?.villageId;
      if (caravan?.path[caravan.next] && caravan.path[caravan.next].x < p!.x) ctx.scale(-1, 1);
      const race = caravan ? world.society.villages.find(v => v.id === caravan.fromId)?.race ?? 'human' : raceOf(entity);
      if (person) drawResident(ctx, world, entity, villageId ? villageColor(villageId) : undefined);
      else if (entity.components.animal) drawAnimal(ctx, entity.components.animal, villageId ? villageColor(villageId) : undefined);
      else if (entity.components.ruin) drawRuin(ctx, entity);
      else if (dwelling?.construction) drawConstruction(ctx, entity, world.tick, villageId ? villageColor(villageId) : undefined);
      else if (sprite !== 'tree' || !drawBiomeTree(ctx, world.terrain.biomeAt(p!.x, p!.y).id, appearance?.variant)) {
        drawSprite(ctx, sprite, appearance?.variant, time + entity.id, false, caravan ? caravan.food / 12 : farm?.growth, villageId ? villageColor(villageId) : undefined, race);
      }
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
      if (dwelling?.villageId && !dwelling.construction) {
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
      if (thermal?.burning && !submerged) this.flame(x, y, time + entity.id);
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
      if (this.cursor && camera.zoom >= 0.8 && Math.hypot(this.cursor.x - village.x, this.cursor.y - village.y) < 4) {
        const g = village.government, e = village.economy;
        const herd = [...world.query('animal')].filter(a => a.components.animal!.villageId === village.id);
        const lines = [g?.leaderId ? translate('Elder: {name} · Trust: {trust}%', language, { name: residentName(g.leaderId), trust: Math.round(g.trust) }) : translate('No elder elected', language),
          translate('Sheep: {sheep} · Dogs: {dogs}', language, { sheep: herd.filter(a => a.components.animal!.kind === 'sheep').length, dogs: herd.filter(a => a.components.animal!.kind === 'dog').length }),
          ...(e ? [translate('Grain: {grain} · Flour: {flour} · Bread: {bread}', language, { grain: Math.floor(e.stocks.grain), flour: Math.floor(e.stocks.flour), bread: Math.floor(e.stocks.bread) }),
            translate('Wood: {wood} · Tools: {tools} · Deliveries: {count}', language, { wood: Math.floor(e.stocks.wood), tools: Math.floor(e.stocks.tools), count: e.deliveries })] : [])];
        ctx.save(); ctx.translate(x, y + 13); ctx.scale(1 / camera.zoom, 1 / camera.zoom);
        ctx.font = ctx.font.replace('10px', '12px');
        const panelWidth = Math.max(...lines.map(line => ctx.measureText(line).width)) + 20, panelHeight = lines.length * 18 + 12;
        const screenX = origin.x + x * camera.zoom, screenY = origin.y + (y + 13) * camera.zoom;
        const left = Math.max(6 - screenX, Math.min(-panelWidth / 2, camera.width - screenX - panelWidth - 6));
        const top = screenY + panelHeight > camera.height - 6 ? -panelHeight - 24 : 0;
        ctx.fillStyle = '#1d2e28f2'; ctx.fillRect(left, top, panelWidth, panelHeight);
        ctx.fillStyle = '#eee3bf'; lines.forEach((line, i) => ctx.fillText(line, left + panelWidth / 2, top + 18 + i * 18));
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
    this.destruction.draw(ctx);
    this.napalm.drawImpacts(ctx);
    this.napalm.airborne(ctx, airstrikes, world.terrain.width, world.terrain.height);
    this.superweapons.airborne(ctx, world, -origin.y / camera.zoom - 80);
    for (const visual of visuals) {
      if (visual.kind !== 'birth' && visual.kind !== 'build') continue;
      const count = 12;
      const serial = this.visualSerial++;
      for (let i = 0; i < count && this.particles.length < PARTICLE_LIMIT; i++) {
        const n = noise(i, serial), angle = n * Math.PI * 2;
        this.particles.push({ x: visual.x * TILE, y: visual.y * TILE, vx: Math.cos(angle) * 10, vy: Math.sin(angle) * 10 - 12, age: 0, life: 0.7, color: '#e8dfad', size: 2 });
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
    // Overlay badges after the scene so houses and trees cannot cover them.
    // Only residents are visited; the two cached bitmaps need one draw call each.
    for (const person of world.query('person', 'position')) {
      const kind = this.statuses.icon(person), p = person.components.position!;
      if (!kind || !world.terrain.isLand(p.x, p.y)) continue;
      const x = Math.round(p.x * TILE) - 9, y = Math.round(p.y * TILE) - 37;
      if (origin.x + (x + 19) * camera.zoom < 0 || origin.x + x * camera.zoom > camera.width
        || origin.y + (y + 22) * camera.zoom < 0 || origin.y + y * camera.zoom > camera.height) continue;
      if (kind === 'heart' && !this.statuses.placeHeart(p)) continue;
      ctx.drawImage(this.statusSprites[kind], x, y);
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
    }
    ctx.restore();
    this.superweapons.flash(ctx, world, camera.width, camera.height, origin, camera.zoom);
    ctx.save(); ctx.scale(camera.width, camera.height);
    const vignette = ctx.createRadialGradient(0.55, 0.54, 0.12, 0.55, 0.54, 0.74);
    vignette.addColorStop(0, '#102c5000'); vignette.addColorStop(0.4, '#102c5014');
    vignette.addColorStop(0.7, '#102c5066'); vignette.addColorStop(1, '#102c50cc');
    ctx.fillStyle = vignette; ctx.fillRect(0, 0, 1, 1); ctx.restore();
    this.frameMs = performance.now() - started;
  }
  private flame(x: number, y: number, time: number): void {
    const flicker = Math.floor((Math.sin(time * 19) + 1) * 2);
    this.ctx.fillStyle = '#d97537'; this.ctx.fillRect(x - 4, y - 10 - flicker, 8, 10 + flicker);
    this.ctx.fillStyle = '#efb44d'; this.ctx.fillRect(x - 2, y - 12 - flicker, 4, 11 + flicker);
    this.ctx.fillStyle = '#ffe59b'; this.ctx.fillRect(x - 1, y - 5, 2, 4);
    this.ctx.fillStyle = '#63726f90'; this.ctx.fillRect(x + 2, y - 19 - flicker * 2, 4, 4);
  }
}
