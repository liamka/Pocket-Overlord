import type { Entity, Vec2 } from './types';

export class SpatialGrid {
  private rows = new Map<number, Map<number, Set<number>>>();
  private locations = new Map<number, { x: number; y: number }>();
  constructor(readonly cellSize = 5) {}
  update(entity: Entity): void {
    const p = entity.components.position;
    if (!p) return;
    const x = Math.floor(p.x / this.cellSize), y = Math.floor(p.y / this.cellSize), previous = this.locations.get(entity.id);
    if (previous?.x === x && previous.y === y) return;
    this.remove(entity.id);
    let row = this.rows.get(y);
    if (!row) this.rows.set(y, row = new Map());
    let bucket = row.get(x);
    if (!bucket) row.set(x, bucket = new Set());
    bucket.add(entity.id);
    this.locations.set(entity.id, { x, y });
  }
  remove(id: number): void {
    const key = this.locations.get(id);
    if (key !== undefined) {
      const row = this.rows.get(key.y), bucket = row?.get(key.x);
      bucket?.delete(id);
      if (!bucket?.size) row?.delete(key.x);
      if (!row?.size) this.rows.delete(key.y);
      this.locations.delete(id);
    }
  }
  query(point: Vec2, radius: number, entities: ReadonlyMap<number, Entity>): Entity[] {
    const found: Entity[] = [];
    const radiusSquared = radius * radius;
    for (let y = Math.floor((point.y - radius) / this.cellSize); y <= Math.floor((point.y + radius) / this.cellSize); y++) {
      const row = this.rows.get(y);
      if (!row) continue;
      for (let x = Math.floor((point.x - radius) / this.cellSize); x <= Math.floor((point.x + radius) / this.cellSize); x++) {
        const bucket = row.get(x);
        if (!bucket) continue;
        for (const id of bucket) {
          const entity = entities.get(id);
          const p = entity?.components.position;
          if (entity && p && (p.x - point.x) ** 2 + (p.y - point.y) ** 2 <= radiusSquared) found.push(entity);
        }
      }
    }
    return found;
  }
  some(point: Vec2, radius: number, entities: ReadonlyMap<number, Entity>, matches: (entity: Entity) => boolean): boolean {
    const radiusSquared = radius * radius;
    for (let y = Math.floor((point.y - radius) / this.cellSize); y <= Math.floor((point.y + radius) / this.cellSize); y++) {
      const row = this.rows.get(y);
      if (!row) continue;
      for (let x = Math.floor((point.x - radius) / this.cellSize); x <= Math.floor((point.x + radius) / this.cellSize); x++) {
        const bucket = row.get(x);
        if (!bucket) continue;
        for (const id of bucket) {
          const entity = entities.get(id), p = entity?.components.position;
          if (entity && p && (p.x - point.x) ** 2 + (p.y - point.y) ** 2 <= radiusSquared && matches(entity)) return true;
        }
      }
    }
    return false;
  }
}
