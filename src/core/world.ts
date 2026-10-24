import { aboardFerry, ferryRoutes } from './ferries';
import { createRegistry } from '../content/defaults';
import { refreshLegacySettlementNames } from '../content/settlement-names';
import type { Registry } from '../content/registry';
import { Random } from './random';
import { SpatialGrid } from './spatial';
import { generateTerrain, TerrainMap } from './terrain';
import type { BiomeId } from './biomes';
import type { NaturalBiome } from './natural-biomes';
import type { System } from './systems';
import { ENTITY_LIMIT, POPULATION_LIMIT, SAVE_VERSION, STEP, Terrain, isSimulationSpeed, newSociety, type SimulationSpeed, type Society, type ComponentKey, type Entity, type GameCommand, type GameEvent, type RainEffect, type Vec2, type VisualEvent, type WorldSnapshot } from './types';

export class World {
  readonly entities = new Map<number, Entity>();
  readonly spatial = new SpatialGrid();
  private readonly componentIndex = new Map<ComponentKey, Set<number>>();
  readonly rng: Random;
  readonly terrain: TerrainMap;
  readonly events: GameEvent[] = [];
  readonly effects: RainEffect[] = [];
  readonly visuals: VisualEvent[] = [];
  readonly systems: readonly System[];
  readonly society: Society;
  readonly scenarios: WorldSnapshot['scenarios'] = [];
  tick = 0;
  nextEntityId = 1;
  paused = false;
  speed: SimulationSpeed = 1;

  constructor(readonly seed: number, readonly registry: Registry = createRegistry(), snapshot?: WorldSnapshot, systems: readonly System[] = registry.resolveSystems(), biome?: BiomeId, nature?: NaturalBiome) {
    this.systems = systems;
    this.society = snapshot ? structuredClone(snapshot.society) : newSociety();
    if (snapshot) refreshLegacySettlementNames(seed, this.society.villages);
    this.rng = new Random(snapshot?.rngState ?? seed);
    this.terrain = snapshot ? new TerrainMap(snapshot.terrain.width, snapshot.terrain.height, snapshot.terrain) : generateTerrain(seed, undefined, undefined, biome, nature);
    if (snapshot) {
      this.tick = snapshot.tick;
      this.nextEntityId = snapshot.nextEntityId;
      this.paused = snapshot.paused;
      this.speed = snapshot.speed;
      for (const entity of structuredClone(snapshot.entities)) this.insert(entity);
      for (const event of structuredClone(snapshot.events)) this.events.push(event);
      this.effects.push(...structuredClone(snapshot.effects));
      this.scenarios.push(...structuredClone(snapshot.scenarios));
    } else {
      for (let y = 4; y < this.terrain.height - 4; y += 2) {
        for (let x = 4; x < this.terrain.width - 4; x += 2) {
          const p = { x: x + this.rng.range(-0.4, 0.4), y: y + this.rng.range(-0.4, 0.4) };
          const grove = Math.sin(x * 0.13) * Math.cos(y * 0.12);
          if (this.terrain.at(p.x, p.y) === Terrain.Grass && !this.terrain.surfaceAt(p.x, p.y) && this.rng.next() < this.terrain.biomeAt(p.x, p.y).trees * (1 + grove * 0.9)) this.spawn('core:tree', p);
        }
      }
    }
  }
  get population(): number { return this.componentIndex.get('person')?.size ?? 0; }
  get houseCount(): number { return this.componentIndex.get('dwelling')?.size ?? 0; }
  *query(...keys: ComponentKey[]): IterableIterator<Entity> {
    if (!keys.length) { yield* this.entities.values(); return; }
    let smallest: Set<number> | undefined;
    for (const key of keys) {
      const index = this.componentIndex.get(key);
      if (!index) return;
      if (!smallest || index.size < smallest.size) smallest = index;
    }
    for (const id of smallest ?? []) {
      const entity = this.entities.get(id)!;
      if (keys.every(key => entity.components[key] !== undefined)) yield entity;
    }
  }
  private insert(entity: Entity): void {
    this.entities.set(entity.id, entity);
    for (const key of Object.keys(entity.components) as ComponentKey[]) {
      let index = this.componentIndex.get(key);
      if (!index) this.componentIndex.set(key, index = new Set());
      index.add(entity.id);
    }
    this.spatial.update(entity);
  }
  spawn(typeId: string, point: Vec2): Entity | undefined {
    const definition = this.registry.entities.get(typeId);
    if (!definition) throw new Error(`Unknown entity type: ${typeId}`);
    if (this.entities.size >= ENTITY_LIMIT) return;
    const previousState = this.rng.state;
    const components = definition.create(point, this.rng);
    if (components.person && this.population >= POPULATION_LIMIT) { this.rng.state = previousState; return; }
    const entity = { id: this.nextEntityId++, typeId, components };
    this.insert(entity);
    return entity;
  }
  remove(id: number): void {
    const entity = this.entities.get(id);
    if (!entity) return;
    if (entity.components.person && entity.components.citizen?.villageId) {
      for (const war of this.society.wars) {
        if (war.attackers.includes(entity.components.citizen.villageId)) war.lossesAttackers++;
        if (war.defenders.includes(entity.components.citizen.villageId)) war.lossesDefenders++;
      }
    }
    for (const key of Object.keys(entity.components) as ComponentKey[]) this.componentIndex.get(key)?.delete(id);
    this.spatial.remove(id);
    this.entities.delete(id);
    for (const { ferry } of ferryRoutes(this)) ferry.passengers = ferry.passengers.filter(passenger => passenger !== id);
    for (const group of this.society.migrations) {
      group.members = group.members.filter(member => member !== id);
      group.homeIds = group.homeIds.filter(home => home !== id);
    }
    this.society.migrations = this.society.migrations.filter(group => group.members.length > 0);
    if (entity.components.dwelling) {
      for (const resident of this.query('person')) {
        if (resident.components.person!.homeId === id) resident.components.person!.homeId = null;
      }
    }
    for (const other of this.query('citizen')) {
      const citizen = other.components.citizen!;
      if (citizen.partnerId === id) citizen.partnerId = null;
      if (citizen.targetId === id) { citizen.targetId = null; citizen.path = []; citizen.reconsiderIn = 0; citizen.task = 'idle'; }
      if (citizen.emergency?.targetId === id) { delete citizen.emergency; citizen.reconsiderIn = 0; }
    }
  }
  nearby(point: Vec2, radius: number): Entity[] { return this.spatial.query(point, radius, this.entities); }
  canStand(point: Vec2, radius = 0.35, ignoreId?: number, allowWater = false): boolean {
    if (!this.terrain.inside(point.x, point.y) || !allowWater && !this.terrain.isLand(point.x, point.y)) return false;
    return !this.nearby(point, radius + 1.2).some(entity => {
      if (entity.id === ignoreId || aboardFerry(this, entity.id)) return false;
      const p = entity.components.position!;
      const otherRadius = entity.components.solid?.radius ?? (entity.components.person ? 0.25 : entity.components.caravan ? 0.4 : 0);
      return otherRadius > 0 && Math.hypot(p.x - point.x, p.y - point.y) < radius + otherRadius;
    });
  }
  findFreePosition(point: Vec2, radius = 0.35, allowWater = false): Vec2 | undefined {
    if (!this.terrain.inside(point.x, point.y) || !allowWater && !this.terrain.isLand(point.x, point.y)) return;
    if (this.canStand(point, radius, undefined, allowWater)) return point;
    // Search nearby rings without consuming simulation randomness; also used by the cursor.
    for (let ring = 1; ring <= 6; ring++) {
      const distance = ring * 0.5;
      const samples = Math.ceil(Math.PI * 2 * distance / 0.5);
      for (let i = 0; i < samples; i++) {
        const angle = i * Math.PI * 2 / samples;
        const candidate = { x: point.x + Math.cos(angle) * distance, y: point.y + Math.sin(angle) * distance };
        if (this.canStand(candidate, radius, undefined, allowWater)) return candidate;
      }
    }
  }
  safeLand(point: Vec2, radius = 1): boolean {
    return this.terrain.isLand(point.x - radius, point.y - radius) && this.terrain.isLand(point.x + radius, point.y - radius)
      && this.terrain.isLand(point.x - radius, point.y + radius) && this.terrain.isLand(point.x + radius, point.y + radius);
  }
  addRain(point: Vec2, radius: number, duration: number): void {
    const existing = this.effects.find(e => Math.hypot(e.x - point.x, e.y - point.y) < radius * 0.4);
    if (existing) { existing.x = point.x; existing.y = point.y; existing.remaining = duration; return; }
    if (this.effects.length < 64) this.effects.push({ ...point, kind: 'rain', radius, remaining: duration });
  }
  command(command: GameCommand): string | undefined {
    if (command.kind === 'release-tool') { this.registry.tools.get(command.toolId)?.release?.(this); return; }
    if (command.kind === 'control-tool') {
      if (Number.isFinite(command.x) && Number.isFinite(command.y) && Math.abs(command.x) <= 1 && Math.abs(command.y) <= 1
        && typeof command.attacking === 'boolean' && typeof command.active === 'boolean') this.registry.tools.get(command.toolId)?.control?.(this, command);
      return;
    }
    if (command.kind === 'start-scenario') { this.startScenario(command.scenarioId); return; }
    if (command.kind === 'pause') { this.paused = command.paused; return; }
    if (command.kind === 'speed') {
      if (command.speed !== 0 && !isSimulationSpeed(command.speed)) return;
      this.paused = command.speed === 0;
      if (command.speed !== 0) this.speed = command.speed;
      return;
    }
    if (!Number.isFinite(command.x) || !Number.isFinite(command.y) || !this.terrain.inside(command.x, command.y)) {
      return command.kind === 'aim-tool' ? undefined : 'Выберите точку на карте';
    }
    if (command.kind === 'aim-tool') {
      this.registry.tools.get(command.toolId)?.aim?.(this, { x: command.x, y: command.y });
      return;
    }
    const result = this.registry.tools.get(command.toolId)?.apply(this, { x: command.x, y: command.y }, command.viewport);
    return typeof result === 'string' ? result : undefined;
  }
  step(): void {
    if (this.paused) return;
    this.tick++;
    // Scenario decisions run before the ordinary systems and share the same event budget.
    for (let i = 0, remaining = this.scenarios.length; remaining > 0; remaining--) {
      const scenario = this.scenarios[i];
      const definition = this.registry.scenarios.get(scenario.id)!;
      if (definition.update(this, scenario.state, STEP) === 'complete') this.scenarios.splice(i, 1);
      else i++;
    }
    for (const system of this.systems) system.update(this, STEP);
  }
  startScenario(id: string): boolean {
    const definition = this.registry.scenarios.get(id);
    if (!definition) throw new Error(`Unknown scenario: ${id}`);
    if (this.scenarios.some(scenario => scenario.id === id) || this.scenarios.length >= 64) return false;
    const state = definition.create(this);
    if (!definition.validate(state)) throw new Error(`Invalid initial scenario state: ${id}`);
    this.scenarios.push({ id, state });
    return true;
  }
  visual(event: VisualEvent): void { if (this.visuals.length < 128) this.visuals.push(event); }
  announce(text: string): void {
    this.society.history.push({ tick: this.tick, text: text.length > 300 ? `${text.slice(0, 299)}…` : text });
    if (this.society.history.length > 40) this.society.history.shift();
  }
  snapshot(): WorldSnapshot {
    return structuredClone({ version: SAVE_VERSION, seed: this.seed, rngState: this.rng.state, tick: this.tick, nextEntityId: this.nextEntityId,
      paused: this.paused, speed: this.speed, terrain: this.terrain.snapshot(), entities: [...this.entities.values()], effects: this.effects, events: this.events, society: this.society,
      contentPacks: this.registry.packIds, scenarios: this.scenarios });
  }
}
