import type { Entity, Vec2 } from './types';

export class SpatialGrid {
  private cells = new Map<string, Set<number>>();
  private locations = new Map<number, string>();
  constructor(readonly cellSize = 5) {}
  private key(x: number, y: number): string { return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`; }
  update(entity: Entity): void {
    const p = entity.components.position;
    if (!p) return;
    const key = this.key(p.x, p.y);
    if (this.locations.get(entity.id) === key) return;
    this.remove(entity.id);
    let bucket = this.cells.get(key);
    if (!bucket) this.cells.set(key, bucket = new Set());
    bucket.add(entity.id);
    this.locations.set(entity.id, key);
  }
  remove(id: number): void {
    const key = this.locations.get(id);
    if (key !== undefined) {
      const bucket = this.cells.get(key);
      bucket?.delete(id);
      if (!bucket?.size) this.cells.delete(key);
      this.locations.delete(id);
    }
  }
  query(point: Vec2, radius: number, entities: ReadonlyMap<number, Entity>): Entity[] {
    const found: Entity[] = [];
    for (let y = Math.floor((point.y - radius) / this.cellSize); y <= Math.floor((point.y + radius) / this.cellSize); y++) {
      for (let x = Math.floor((point.x - radius) / this.cellSize); x <= Math.floor((point.x + radius) / this.cellSize); x++) {
        for (const id of this.cells.get(`${x},${y}`) ?? []) {
          const entity = entities.get(id);
          const p = entity?.components.position;
          if (entity && p && (p.x - point.x) ** 2 + (p.y - point.y) ** 2 <= radius ** 2) found.push(entity);
        }
      }
    }
    return found;
  }
}
