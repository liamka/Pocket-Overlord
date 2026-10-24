import type { ComponentKey, Components, EventKind, GameEvent, ToolControl, Vec2, WorldViewport } from '../core/types';
import type { Random } from '../core/random';
import type { World } from '../core/world';
import { orderSystems, type System } from '../core/systems';
import { isJson, record, type JsonValue, type RecordValue, type ValidationContext, type Validator } from '../core/validation';

export interface PixelSprite {
  pixels: readonly string[];
  palette: Readonly<Record<string, string>>;
  anchor: Vec2;
}
export type Sprite = 'person' | 'tree' | 'house' | 'dynamite' | 'rocket' | 'crate' | 'farm' | 'caravan' | 'dragon' | 'ufo' | 'ship' | 'harbor' | PixelSprite;
export type ToolIcon = 'human' | 'elf' | 'orc' | 'dwarf' | 'dynamite' | 'rain' | 'rocket' | 'dragon' | 'ufo' | 'ship' | 'harbor' | PixelSprite;
export interface EntityDefinition {
  id: string;
  sprite: Sprite;
  required?: readonly ComponentKey[];
  create: (position: Vec2, rng: Random) => Components;
}
export interface ToolDefinition {
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
  category?: 'biomes' | 'people' | 'nature' | 'destruction';
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

/** Assemble build-time content before creating worlds; no executable code is loaded from saves. */
export class Registry {
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
    this.entities.set(definition.id, definition);
    return this;
  }
  registerTool(definition: ToolDefinition): this {
    if (this.tools.has(definition.id)) throw new Error(`Duplicate tool: ${definition.id}`);
    this.tools.set(definition.id, definition);
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
  resolveSystems(): readonly System[] {
    return this.orderedSystems ??= orderSystems(this.systems.values());
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
