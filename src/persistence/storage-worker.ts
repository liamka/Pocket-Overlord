import { IndexedDBBackend, unpackSnapshot, type PackedSnapshot } from './storage';
import type { WorldSnapshot } from '../core/types';

const backends = new Map<string, IndexedDBBackend>();
const checkpoints = new Map<string, WorldSnapshot>();
self.onmessage = async ({ data }: MessageEvent<{ id: number; name: string; snapshot: PackedSnapshot; preservePrevious: boolean }>) => {
  try {
    let backend = backends.get(data.name);
    if (!backend) backends.set(data.name, backend = new IndexedDBBackend(data.name));
    const snapshot = unpackSnapshot(data.snapshot, checkpoints.get(data.name));
    await backend.write(snapshot, data.preservePrevious);
    checkpoints.set(data.name, snapshot);
    self.postMessage({ id: data.id });
  } catch (error) {
    self.postMessage({ id: data.id, error: error instanceof Error ? error.message : 'Не удалось сохранить мир' });
  }
};
