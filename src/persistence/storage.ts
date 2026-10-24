import type { Registry } from '../content/registry';
import type { WorldSnapshot } from '../core/types';
import { decodeSave } from './schema';

export type LoadResult = { status: 'empty' } | { status: 'loaded'; snapshot: WorldSnapshot } | { status: 'unavailable'; message: string };
export interface SaveBackend { read(): Promise<unknown>; write(snapshot: WorldSnapshot, preservePrevious?: boolean): Promise<void> }

export class IndexedDBBackend implements SaveBackend {
  private database: Promise<IDBDatabase> | undefined;
  // Keep the original database name so existing worlds and backups remain accessible.
  constructor(private readonly name = 'little-world') {}
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
}

/** Failed loads preserve the old record atomically with the next automatic save. */
export class SaveService {
  private preservePrevious = true;
  private chain: Promise<void> = Promise.resolve();
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
