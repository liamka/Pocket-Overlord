import type { RaceId } from './races';

export interface Vec2 { x: number; y: number }
export interface WorldViewport { left: number; top: number; right: number; bottom: number }
export interface ToolControl { x: number; y: number; attacking: boolean; active: boolean }
export interface ResidentAnimation { stride: number; moving: number; heading: number; work: number }
export interface Construction { progress: number; struckAt: number }

export interface CoreComponents {
  position: Vec2;
  health: { current: number; max: number };
  combustible: { fuel: number; ignition: number };
  thermal: { temperature: number; wetness: number; burning: boolean };
  motion: { vx: number; vy: number; speed: number; heading: number; decisionIn: number };
  person: { race?: RaceId; age: number; sex: 'a' | 'b'; homeId: number | null; buildIn: number; reproduceIn: number; animation?: ResidentAnimation };
  citizen: { villageId: number | null; partnerId: number | null; parents: number[]; hunger: number; pregnancy: number; fatherId: number | null; task: 'idle' | 'farm' | 'eat' | 'visit' | 'fight' | 'repair' | 'build' | 'migrate'; targetId: number | null; path: Vec2[]; reconsiderIn: number; attackIn: number; repair: { tile: number; remaining: number } | null };
  dwelling: { race?: RaceId; capacity: number; villageId: number | null; construction?: Construction };
  farm: { villageId: number; growth: number; harvests: number };
  caravan: { fromId: number; toId: number | null; food: number; path: Vec2[]; next: number; returning: boolean; retryIn: number };
  solid: { radius: number };
  explosive: { fuse: number; radius: number; power: number; heat: number };
  projectile: { remaining: number; duration: number; heading?: number };
  appearance: { variant: number };
}
/** Content modules augment this map and register their validator alongside the system. */
export interface ComponentMap extends CoreComponents {}
export type ComponentKey = keyof ComponentMap;
export type Components = { [K in ComponentKey]?: ComponentMap[K] };
export interface Entity { id: number; typeId: string; components: Components }

export enum Terrain { DeepWater, Water, Sand, Grass, Scorched, Crater, Road, Mountain, BridgeHorizontal, BridgeVertical }
export const isBridge = (tile: number): boolean => tile === Terrain.BridgeHorizontal || tile === Terrain.BridgeVertical;
export const isRoadSurface = (tile: number): boolean => tile === Terrain.Road || isBridge(tile);
export const MAX_BRIDGE_SPAN = 3;
export const MAX_FERRY_SPAN = 24;
export const FERRY_CAPACITY = 6;
export const ROAD_OVERGROWTH_SECONDS = 480;
export const WORLD_WIDTH = 512;
export const WORLD_HEIGHT = 384;
export interface TerrainRecovery { index: number; age: number; target: Terrain.Sand | Terrain.Grass }
export interface RoadWear { index: number; age: number; target: Terrain.Sand | Terrain.Grass }
export interface TerrainData { width: number; height: number; tiles: number[]; moisture: number[]; recovery: TerrainRecovery[]; roadWear?: RoadWear[]; biomes?: number[]; surfaces?: number[] }
/** Content modules may augment this interface alongside their event handler. */
export interface GameEventMap {
  blast: { x: number; y: number; radius: number; power: number; heat: number; style?: 'napalm' | 'rocket' | 'dynamite' };
  damage: { target: number; amount: number };
  heat: { target: number; amount: number };
  wet: { target: number; amount: number };
  impulse: { target: number; x: number; y: number };
  surface: { x: number; y: number; radius: number; terrain: Terrain };
}
export type EventKind = keyof GameEventMap;
export type GameEvent<K extends EventKind = EventKind> = { [P in K]: { kind: P } & GameEventMap[P] }[K];
export interface RainEffect extends Vec2 { kind: 'rain'; radius: number; remaining: number }
export type VisualEvent = Vec2 & { radius: number } & (
  | { kind: 'blast'; style?: 'napalm' | 'rocket' | 'dynamite' }
  | { kind: 'birth' | 'build' }
  | { kind: 'love'; target: number }
);
export const SIMULATION_SPEEDS = [0.2, 1, 2, 4, 10, 40] as const;
export type SimulationSpeed = typeof SIMULATION_SPEEDS[number];
export const isSimulationSpeed = (value: unknown): value is SimulationSpeed => SIMULATION_SPEEDS.some(speed => speed === value);
export const speedLabel = (speed: SimulationSpeed): string => speed === 0.2 ? '⅕×' : `${speed}×`;
export type GameCommand =
  | ({ kind: 'control-tool'; toolId: string } & ToolControl)
  | { kind: 'use-tool'; toolId: string; x: number; y: number; viewport?: WorldViewport }
  | { kind: 'aim-tool'; toolId: string; x: number; y: number }
  | { kind: 'start-scenario'; scenarioId: string }
  | { kind: 'speed'; speed: 0 | SimulationSpeed }
  | { kind: 'pause'; paused: boolean };
export interface WorldSnapshot {
  version: number;
  seed: number;
  rngState: number;
  tick: number;
  nextEntityId: number;
  paused: boolean;
  speed: SimulationSpeed;
  terrain: TerrainData;
  entities: Entity[];
  effects: RainEffect[];
  events: GameEvent[];
  society: Society;
  contentPacks: string[];
  scenarios: { id: string; state: import('./validation').JsonValue }[];
}
export interface Village extends Vec2 { id: number; race?: RaceId; name: string; food: number; harvested: number; founded: number; migrationAfter: number }
export interface Migration {
  id: number; fromId: number; toId: number | null; destination: Vec2;
  members: number[]; homeIds: number[]; food: number; started: number;
}
export interface Relation { a: number; b: number; status: 'neutral' | 'alliance' | 'war'; affinity: number; since: number; nextDecision: number; roadAttempt: number }
export interface BridgeDeck { tile: number; terrain: Terrain.BridgeHorizontal | Terrain.BridgeVertical }
/** Endpoints are offsets into the owning road; progress runs from the first bank to the second. */
export interface Ferry { start: number; end: number; progress: number; target: 0 | 1; wait: number; passengers: number[] }
export interface Road { a: number; b: number; tiles: number[]; built: number; bridges?: BridgeDeck[]; ferries?: Ferry[] }
export interface War {
  id: number; attackers: number[]; defenders: number[]; started: number; musterUntil: number;
  attackTarget: number; rallyVillage: number; initialAttackers: number; initialDefenders: number; lossesAttackers: number; lossesDefenders: number;
}
export interface Society { nextVillageId: number; nextWarId: number; nextMigrationId: number; migrations: Migration[]; villages: Village[]; relations: Relation[]; roads: Road[]; wars: War[]; history: { tick: number; text: string }[] }
export const newCitizen = (): ComponentMap['citizen'] => ({ villageId: null, partnerId: null, parents: [], hunger: 15, pregnancy: 0, fatherId: null, task: 'idle', targetId: null, path: [], reconsiderIn: 0, attackIn: 0, repair: null });
export const newSociety = (): Society => ({ nextVillageId: 1, nextWarId: 1, nextMigrationId: 1, migrations: [], villages: [], relations: [], roads: [], wars: [], history: [] });
export const STEP = 1 / 30;
/** Frequency of autonomous social events relative to their original cadence. */
export const SOCIAL_EVENT_RATE = 0.5;
export const POPULATION_LIMIT = 300;
export const ENTITY_LIMIT = 6000;
export const EVENT_BUDGET = 256;
export const ROAD_REPAIR_SECONDS = 3;
export const SAVE_VERSION = 25;
