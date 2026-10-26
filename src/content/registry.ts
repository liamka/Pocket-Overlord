import { DEFAULT_BIOME_CLIMATE, type BiomeClimate } from '../core/biome-spread';
import type { ComponentKey, Components, Entity, EventKind, GameEvent, ToolControl, Vec2, WorldViewport } from '../core/types';
import { Random } from '../core/random';
import { CAPABILITIES, CAPABILITY_SYSTEMS, OWNER_SYSTEMS, supportsCapability, validateCapabilities, validateSpeciesComponents } from '../core/capabilities';
import { validCreatureFamily } from './creature-families';
import type { SpeciesProfile } from '../core/creatures';
import { validSpeciesParameters } from '../core/species-profiles';
import type { TaskDefinition } from '../core/behaviour';
import type { TransformationDefinition } from '../core/metamorphosis';
import type { World } from '../core/world';
import type { WorldProcessDefinition } from '../core/world-processes';
import { monthTicks } from '../core/calendar';
import { orderSystems, type System } from '../core/systems';
import { isJson, record, type JsonValue, type RecordValue, type ValidationContext, type Validator } from '../core/validation';

export interface PixelSprite {
  pixels: readonly string[];
  palette: Readonly<Record<string, string>>;
  anchor: Vec2;
}
export type Sprite = 'person' | 'tree' | 'house' | 'dynamite' | 'rocket' | 'crate' | 'farm' | 'caravan' | 'dragon' | 'ufo' | 'ship' | 'harbor' | 'sheep' | 'dog' | 'wolf' | 'market' | 'mill' | 'bakery' | 'workshop' | PixelSprite;
export type ToolIcon = 'human' | 'elf' | 'orc' | 'dwarf' | 'dynamite' | 'rain' | 'rocket' | 'dragon' | 'ufo' | 'ship' | 'harbor' | PixelSprite;
export interface EntityDefinition {
  id: string;
  speciesId?: string;
  sprite: Sprite;
  required?: readonly ComponentKey[];
  create: (position: Vec2, rng: Random) => Components;
}
export interface ToolDefinition {
  /** Exact spawn placement for a pure subspecies preview. */
  creaturePlacement?: (world: World, point: Vec2) => { typeId: string; point: Vec2 } | undefined;
  id: string;
  label: string;
  hint: string;
  shortcut?: string;
  radius: number;
  showArea?: boolean;
  color: string;
  continuous?: boolean;
  /** Left-drag paints the ground; right-drag still pans the camera. */
  paint?: boolean;
  paintHint?: string;
  category?: 'biomes' | 'people' | 'buildings' | 'nature' | 'destruction';
  icon?: ToolIcon;
  canApply?: (world: World, point: Vec2) => boolean;
  apply: (world: World, point: Vec2, viewport?: WorldViewport) => string | void;
  aim?: (world: World, point: Vec2) => void;
  /** Held powers stop on release, cancellation and loading a saved world. */
  release?: (world: World) => void;
  control?: (world: World, input: ToolControl) => void;
}

export interface EventDefinition<K extends EventKind> {
  kind: K;
  validate: (value: RecordValue, context: ValidationContext) => boolean;
  apply: (world: World, event: GameEvent<K>) => void;
}
export interface ScenarioDefinition<State extends JsonValue> {
  id: string;
  create: (world: World) => State;
  validate: (state: unknown) => state is State;
  update: (world: World, state: State, dt: number) => 'complete' | void;
}
export interface ContentPack { id: string; install: (registry: Registry) => void }
function freezeProfile<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freezeProfile(child); Object.freeze(value); }
  return value;
}

/** Assemble build-time content before creating worlds; no executable code is loaded from saves. */
export class Registry {
  /** Existing playable peoples are open; a discovery owner may narrow this gate. */
  cloudSapientUnlocked: (world: World, speciesId: string) => boolean = (_world, id) =>
    ['human', 'elf', 'orc', 'dwarf'].includes(id) && !!this.species.get(id)?.runtime;
  /** Clans supply their own saved traits, without a second clan store. */
  cloudGaiaBlood: (world: World, entity: Entity) => boolean = () => false;
  /** Disaster content may subscribe; mining itself never summons a creature. */
  mineExplored: (world: World, event: import('../core/mines').MineExplored) => void = () => {};
  /** Future ages read their own saved state here; ecology owns no second age clock. */
  biomeClimate: (world: World) => BiomeClimate = () => DEFAULT_BIOME_CLIMATE;
  readonly worldProcesses = new Map<string, WorldProcessDefinition>();
  readonly transformations = new Map<string, TransformationDefinition>();
  readonly tasks = new Map<string, TaskDefinition>();
  readonly species = new Map<string, SpeciesProfile>();
  readonly entities = new Map<string, EntityDefinition>();
  readonly tools = new Map<string, ToolDefinition>();
  readonly components = new Map<ComponentKey, Validator>();
  readonly scenarios = new Map<string, ScenarioDefinition<JsonValue>>();
  private readonly events = new Map<EventKind, EventDefinition<EventKind>>();
  private readonly systems = new Map<string, System>();
  private readonly packs = new Set<string>();
  private orderedSystems?: readonly System[];
  get packIds(): string[] { return [...this.packs]; }
  use(pack: ContentPack): this {
    if (this.packs.has(pack.id)) throw new Error(`Duplicate content pack: ${pack.id}`);
    pack.install(this);
    this.packs.add(pack.id);
    return this;
  }
  registerEntity(definition: EntityDefinition): this {
    if (this.entities.has(definition.id)) throw new Error(`Duplicate entity type: ${definition.id}`);
    if (definition.speciesId && !this.species.get(definition.speciesId)?.runtime) throw new Error(`Unavailable species: ${definition.speciesId}`);
    if (definition.speciesId) this.validateSpeciesEntity(definition, definition.speciesId);
    const registered = { ...definition, required: definition.required && [...definition.required] };
    this.entities.set(definition.id, definition.speciesId ? Object.freeze(registered) : registered);
    return this;
  }
  registerTask(definition: TaskDefinition): this {
    if (this.tasks.has(definition.id) || !definition.stages.length || new Set(definition.stages.map(s => s.id)).size !== definition.stages.length) throw new Error(`Invalid task definition: ${definition.id}`);
    this.tasks.set(definition.id, definition);
    return this;
  }
  registerTransformation(definition: TransformationDefinition): this {
    if (this.transformations.has(definition.id) || !Number.isSafeInteger(definition.priority)
      || definition.chance !== undefined && (!Number.isFinite(definition.chance) || definition.chance < 0 || definition.chance > 1)
      || definition.change !== 'body' && (definition.target !== 'self' || !definition.migrate)
      || definition.sources.length === 0 || definition.sources.some(id => !this.species.get(this.entities.get(id)?.speciesId ?? '')?.runtime)
      || definition.target !== 'self' && !this.species.get(this.entities.get(definition.target)?.speciesId ?? '')?.runtime
      || definition.additional && (definition.identity !== 'new' || definition.items !== 'leave')) throw new Error(`Invalid transformation: ${definition.id}`);
    this.transformations.set(definition.id, Object.freeze({ ...definition, sources: Object.freeze([...definition.sources]), remove: Object.freeze([...definition.remove]) }));
    return this;
  }
  registerTool(definition: ToolDefinition): this {
    if (this.tools.has(definition.id)) throw new Error(`Duplicate tool: ${definition.id}`);
    this.tools.set(definition.id, definition);
    return this;
  }
  registerSpecies(profile: SpeciesProfile): this {
    if (this.species.has(profile.id)) throw new Error(`Duplicate species: ${profile.id}`);
    if ((profile.support === 'partial') !== !!profile.runtime) throw new Error(`Invalid species support: ${profile.id}`);
    validateCapabilities(profile);
    if (profile.parameters && !validSpeciesParameters(profile.parameters)) throw new Error(`Invalid species parameters: ${profile.id}`);
    if (profile.runtime && (!Array.isArray(profile.runtime.families) || !profile.runtime.families.length || profile.runtime.families.some(id => !validCreatureFamily(id)))) throw new Error(`Species ${profile.id}: unknown or missing family`);
    this.species.set(profile.id, freezeProfile(structuredClone(profile)));
    return this;
  }
  bindSpecies(entityId: string, speciesId: string): this {
    const entity = this.entities.get(entityId), species = this.species.get(speciesId);
    if (!entity || !species?.runtime) throw new Error(`Unavailable species binding: ${entityId} / ${speciesId}`);
    if (entity.speciesId && entity.speciesId !== speciesId) throw new Error(`Species identity already bound: ${entityId} / ${entity.speciesId}`);
    this.validateSpeciesEntity(entity, speciesId);
    this.entities.set(entityId, Object.freeze({ ...entity, speciesId }));
    return this;
  }
  registerComponent(key: ComponentKey, validate: Validator): this {
    if (this.components.has(key)) throw new Error(`Duplicate component: ${key}`);
    this.components.set(key, validate);
    return this;
  }
  registerEvent<K extends EventKind>(definition: EventDefinition<K>): this {
    if (this.events.has(definition.kind)) throw new Error(`Duplicate event: ${definition.kind}`);
    // The map is indexed by the discriminant that selects this exact handler.
    this.events.set(definition.kind, definition as unknown as EventDefinition<EventKind>);
    return this;
  }
  applyEvent(world: World, event: GameEvent): void {
    const definition = this.events.get(event.kind);
    if (!definition) throw new Error(`Unknown event: ${event.kind}`);
    definition.apply(world, event);
  }
  validateEvent(value: unknown, context: ValidationContext): boolean {
    return record(value) && this.events.get(value.kind as EventKind)?.validate(value, context) === true;
  }
  registerSystem(system: System): this {
    if (this.systems.has(system.id)) throw new Error(`Duplicate system: ${system.id}`);
    this.systems.set(system.id, system);
    this.orderedSystems = undefined;
    return this;
  }
  registerWorldProcess(definition: WorldProcessDefinition): this {
    const [min, max] = definition.intervalMonths;
    if (this.worldProcesses.has(definition.id) || !definition.id || !Number.isFinite(min) || !Number.isFinite(max)
      || min <= 0 || max < min || !Number.isSafeInteger(monthTicks(max)) || !Number.isInteger(definition.budget)
      || definition.budget < 1 || definition.budget > 8192 || !['landscape', 'resources'].includes(definition.phase)
      || !['tiles', 'entities', 'samples', 'biomes'].includes(definition.scope)) throw new Error(`Invalid world process: ${definition.id}`);
    this.worldProcesses.set(definition.id, Object.freeze({ ...definition, intervalMonths: Object.freeze([...definition.intervalMonths]) as readonly [number, number],
      dependencies: Object.freeze({ laws: Object.freeze([...definition.dependencies.laws]), ages: Object.freeze([...definition.dependencies.ages]) }) }));
    return this;
  }
  resolveSystems(): readonly System[] {
    for (const species of this.species.values()) {
      const runtime = species.runtime; if (!runtime) continue;
      for (const id of OWNER_SYSTEMS[runtime.owner]) if (!this.systems.has(id)) throw new Error(`Species ${species.id}: ${runtime.owner} behavior requires system ${id}`);
      for (const capability of CAPABILITIES) {
        const id = CAPABILITY_SYSTEMS[capability];
        if (id && supportsCapability(runtime, capability) && !this.systems.has(id)) throw new Error(`Species ${species.id}: capability ${capability} requires system ${id}`);
      }
    }
    return this.orderedSystems ??= orderSystems(this.systems.values());
  }
  private validateSpeciesEntity(definition: EntityDefinition, speciesId: string): void {
    const profile = this.species.get(speciesId)!;
    // Factory validation has its own RNG, never the world's simulation state.
    validateSpeciesComponents(profile, definition, definition.create({ x: 16, y: 16 }, new Random(1)));
  }
  registerScenario<State extends JsonValue>(definition: ScenarioDefinition<State>): this {
    if (this.scenarios.has(definition.id)) throw new Error(`Duplicate scenario: ${definition.id}`);
    this.scenarios.set(definition.id, {
      id: definition.id,
      create: definition.create,
      validate: (state): state is State => isJson(state) && definition.validate(state),
      update: (world, state, dt) => definition.update(world, state as State, dt),
    });
    return this;
  }
}
