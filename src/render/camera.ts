import type { Vec2 } from '../core/types';

export const TILE = 8;
export class Camera {
  x = 80;
  y = 56;
  zoom = 1;
  width = 1;
  height = 1;
  private minZoom = 0.175;
  fit(worldWidth: number, worldHeight: number): void {
    const fitZoom = Math.max(0.04, Math.min(2, this.width / (worldWidth * TILE * 0.93), (this.height - 220) / (worldHeight * TILE * 0.93)));
    this.minZoom = Math.min(0.175, fitZoom);
    this.zoom = fitZoom;
    this.x = worldWidth / 2;
    // Center the full silhouette in the area above the tool dock.
    this.y = worldHeight / 2 + (this.height * 0.46 - (this.height - 200) / 2) / (TILE * this.zoom);
  }
  get origin(): Vec2 { return { x: this.width / 2 - this.x * TILE * this.zoom, y: this.height * 0.46 - this.y * TILE * this.zoom }; }
  screenToWorld(x: number, y: number): Vec2 { const origin = this.origin; return { x: (x - origin.x) / (TILE * this.zoom), y: (y - origin.y) / (TILE * this.zoom) }; }
  worldToScreen(x: number, y: number): Vec2 { const origin = this.origin; return { x: origin.x + x * TILE * this.zoom, y: origin.y + y * TILE * this.zoom }; }
  zoomAt(factor: number, x: number, y: number): void {
    const before = this.screenToWorld(x, y);
    this.zoom = Math.min(5, Math.max(this.minZoom, this.zoom * factor));
    const after = this.screenToWorld(x, y);
    this.x += before.x - after.x; this.y += before.y - after.y;
  }
  pan(dx: number, dy: number, worldWidth: number, worldHeight: number): void {
    this.x = Math.min(worldWidth + 15, Math.max(-15, this.x - dx / (TILE * this.zoom)));
    this.y = Math.min(worldHeight + 15, Math.max(-15, this.y - dy / (TILE * this.zoom)));
  }
}
