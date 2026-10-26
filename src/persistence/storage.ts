import type { Registry } from '../content/registry';
import type { WorldSnapshot } from '../core/types';
import type { World } from '../core/world';
import { decodeSave } from './schema';

export type LoadResult = { status: 'empty' } | { status: 'loaded'; snapshot: WorldSnapshot } | { status: 'unavailable'; message: string };
export interface SaveBackend { read(): Promise<unknown>; write(snapshot: WorldSnapshot, preservePrevious?: boolean): Promise<void> }
interface PackedArray { length: number; chunks: { offset: number; values: Float64Array<ArrayBuffer> }[] }
export type PackedSnapshot = Omit<WorldSnapshot, 'terrain'> & { terrainBase: boolean; terrain: Omit<WorldSnapshot['terrain'], 'tiles' | 'moisture' | 'biomes' | 'surfaces'> & {
  tiles: PackedArray; moisture: PackedArray; biomes?: PackedArray; surfaces?: PackedArray;
} };
/** Transfer changed blocks only; the worker still commits one complete, compatible save. */
export function packSnapshot(snapshot: WorldSnapshot, previous?: WorldSnapshot): { snapshot: PackedSnapshot; buffers: ArrayBuffer[] } {
  const t = snapshot.terrain, buffers: ArrayBuffer[] = [];
  const base = previous?.seed === snapshot.seed && previous.terrain.width === t.width && previous.terrain.height === t.height ? previous.terrain : undefined;
  const pack = (values: number[], old?: number[]): PackedArray => {
    const chunks: PackedArray['chunks'] = [];
    if (values !== old) for (let offset = 0; offset < values.length; offset += 1024) {
      const end = Math.min(offset + 1024, values.length);
      let changed = old?.length !== values.length;
      if (!changed) for (let i = offset; i < end; i++) if (values[i] !== old![i]) { changed = true; break; }
      if (changed) {
        const data = new Float64Array(end - offset);
        for (let i = offset; i < end; i++) data[i - offset] = values[i];
        chunks.push({ offset, values: data }); buffers.push(data.buffer);
      }
    }
    return { length: values.length, chunks };
  };
  return { snapshot: { ...snapshot, terrainBase: !!base, terrain: { ...t,
    tiles: pack(t.tiles, base?.tiles), moisture: pack(t.moisture, base?.moisture),
    biomes: t.biomes && pack(t.biomes, base?.biomes), surfaces: t.surfaces && pack(t.surfaces, base?.surfaces) } }, buffers };
}
export function unpackSnapshot(packed: PackedSnapshot, previous?: WorldSnapshot): WorldSnapshot {
  const { terrainBase, terrain: t, ...state } = packed;
  if (terrainBase && (!previous || previous.seed !== packed.seed || previous.terrain.width !== t.width || previous.terrain.height !== t.height)) throw new Error('Missing terrain checkpoint');
  const base = terrainBase ? previous?.terrain : undefined;
  const unpack = (data: PackedArray, old?: number[]): number[] => {
    if (!data.chunks.length && old?.length === data.length) return old;
    const values = old?.length === data.length ? old.slice() : new Array<number>(data.length);
    for (const chunk of data.chunks) for (let i = 0; i < chunk.values.length; i++) values[chunk.offset + i] = chunk.values[i];
    return values;
  };
  return { ...state, terrain: { ...t, tiles: unpack(t.tiles, base?.tiles), moisture: unpack(t.moisture, base?.moisture),
    biomes: t.biomes && unpack(t.biomes, base?.biomes), surfaces: t.surfaces && unpack(t.surfaces, base?.surfaces) } };
}

export class IndexedDBBackend implements SaveBackend {
  private database: Promise<IDBDatabase> | undefined;
  private worker: Worker | undefined;
  private serial = 0;
  private checkpoint?: WorldSnapshot;
  private backgroundChain: Promise<void> = Promise.resolve();
  private readonly pending = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();
  // Keep the original database name so existing worlds and backups remain accessible.
  constructor(private readonly name = 'little-world', private readonly background = false) {}
  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      this.database = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(this.name, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('worlds');
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => { db.close(); this.database = undefined; };
          resolve(db);
        };
        request.onerror = () => reject(request.error ?? new Error('Хранилище недоступно'));
        request.onblocked = () => reject(new Error('Закройте другую вкладку игры, чтобы открыть сохранение'));
      }).catch(error => { this.database = undefined; throw error; });
    }
    return this.database;
  }
  async read(): Promise<unknown> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('worlds', 'readonly');
      const request = transaction.objectStore('worlds').get('last');
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error('Не удалось прочитать мир'));
    });
  }
  async write(snapshot: WorldSnapshot, preservePrevious = false): Promise<void> {
    // A hidden/unloading page starts its checkpoint here; its worker may be suspended or terminated.
    if (this.background && typeof Worker !== 'undefined' && (typeof document === 'undefined' || !document.hidden)) {
      const next = this.backgroundChain.then(() => this.writeInBackground(snapshot, preservePrevious));
      this.backgroundChain = next.catch(() => {});
      return next;
    }
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('worlds', 'readwrite');
      const store = transaction.objectStore('worlds');
      if (preservePrevious) {
        const previous = store.get('last');
        previous.onsuccess = () => {
          if (previous.result !== undefined) store.add(previous.result, `backup:${crypto.randomUUID()}`);
          store.put(snapshot, 'last');
        };
      } else store.put(snapshot, 'last');
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error('Не удалось сохранить мир'));
    });
  }
  private writeInBackground(snapshot: WorldSnapshot, preservePrevious: boolean): Promise<void> {
    if (!this.worker) {
      const worker = this.worker = new Worker(new URL('./storage-worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }: MessageEvent<{ id: number; error?: string }>) => {
        const pending = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (data.error) pending?.reject(new Error(data.error)); else pending?.resolve();
      };
      worker.onerror = () => {
        for (const pending of this.pending.values()) pending.reject(new Error('Не удалось сохранить мир'));
        this.pending.clear(); worker.terminate(); this.worker = undefined; this.checkpoint = undefined;
      };
    }
    const packed = packSnapshot(snapshot, this.checkpoint);
    return new Promise<void>((resolve, reject) => {
      const id = ++this.serial;
      this.pending.set(id, { resolve, reject });
      try { this.worker!.postMessage({ id, name: this.name, snapshot: packed.snapshot, preservePrevious }, packed.buffers); }
      catch (error) { this.pending.delete(id); reject(error); }
    }).then(() => { this.checkpoint = snapshot; });
  }
}

/** Failed loads preserve the old record atomically with the next automatic save. */
export class SaveService {
  private preservePrevious = true;
  private chain: Promise<void> = Promise.resolve();
  private terrainWorld?: World;
  private terrain?: WorldSnapshot['terrain'];
  constructor(private readonly backend: SaveBackend, private readonly registry: Registry) {}
  async load(): Promise<LoadResult> {
    try {
      const raw = await this.backend.read();
      if (raw === undefined) { this.preservePrevious = false; return { status: 'empty' }; }
      const snapshot = decodeSave(raw, this.registry);
      this.preservePrevious = false;
      return { status: 'loaded', snapshot };
    } catch (error) {
      this.preservePrevious = true;
      return { status: 'unavailable', message: error instanceof Error ? error.message : 'Не удалось загрузить мир' };
    }
  }
  saveWorld(world: World): Promise<void> {
    const terrain = world.terrain.snapshot(this.terrainWorld === world ? this.terrain : undefined);
    this.terrainWorld = world; this.terrain = terrain;
    // Capture mutable simulation state before entering the asynchronous write queue.
    return this.save(world.snapshot(terrain));
  }
  save(snapshot: WorldSnapshot): Promise<void> {
    return this.enqueue(async () => {
      await this.backend.write(snapshot, this.preservePrevious);
      this.preservePrevious = false;
    });
  }
  replace(snapshot: WorldSnapshot): Promise<void> {
    return this.save(snapshot);
  }
  private enqueue(action: () => Promise<void>): Promise<void> {
    const next = this.chain.then(action, action);
    this.chain = next.catch(() => {});
    return next;
  }
}
