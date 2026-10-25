export type Point = readonly [number, number];

/** Integer-grid painting keeps every edge crisp at whole-number display scales. */
export class Pixels {
  readonly size = 48;
  data: (string | undefined)[] = Array(48 * 48);
  dot(x: number, y: number, color: string): void {
    x = Math.round(x); y = Math.round(y);
    if (x >= 0 && x < this.size && y >= 0 && y < this.size) this.data[y * this.size + x] = color;
  }
  rect(x: number, y: number, width: number, height: number, color: string): void {
    for (let j = y; j < y + height; j++) for (let i = x; i < x + width; i++) this.dot(i, j, color);
  }
  ellipse(x: number, y: number, rx: number, ry: number, color: string): void {
    for (let j = Math.floor(y - ry); j <= y + ry; j++) for (let i = Math.floor(x - rx); i <= x + rx; i++) {
      if (((i - x) / rx) ** 2 + ((j - y) / ry) ** 2 <= 1) this.dot(i, j, color);
    }
  }
  poly(points: readonly Point[], color: string): void {
    const minY = Math.min(...points.map(p => p[1])), maxY = Math.max(...points.map(p => p[1]));
    for (let y = minY; y <= maxY; y++) {
      const crossings: number[] = [];
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i], b = points[j];
        if ((a[1] > y) !== (b[1] > y)) crossings.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
      crossings.sort((a, b) => a - b);
      for (let i = 0; i < crossings.length; i += 2) for (let x = Math.ceil(crossings[i]); x < crossings[i + 1]; x++) this.dot(x, y, color);
    }
  }
  line(points: readonly Point[], color: string, width = 1): void {
    for (let k = 1; k < points.length; k++) {
      const a = points[k - 1], b = points[k], steps = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
      for (let i = 0; i <= steps; i++) this.rect(Math.round(a[0] + (b[0] - a[0]) * i / (steps || 1)), Math.round(a[1] + (b[1] - a[1]) * i / (steps || 1)), width, width, color);
    }
  }
  rotate(angle: number): void {
    const old = this.data, c = Math.cos(angle), s = Math.sin(angle);
    this.data = Array(48 * 48);
    for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
      const u = Math.round((x - 23.5) * c + (y - 23.5) * s + 23.5);
      const v = Math.round(-(x - 23.5) * s + (y - 23.5) * c + 23.5);
      if (u >= 0 && u < 48 && v >= 0 && v < 48) this.data[y * 48 + x] = old[v * 48 + u];
    }
  }
  outline(color = '#182326'): void {
    const old = [...this.data];
    for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
      if (old[y * 48 + x]) continue;
      if ([[0,-1],[-1,0],[1,0],[0,1]].some(([dx,dy]) => x+dx >= 0 && x+dx < 48 && y+dy >= 0 && y+dy < 48 && old[(y+dy)*48+x+dx])) this.dot(x,y,color);
    }
  }
  draw(canvas: HTMLCanvasElement): void {
    canvas.width = 48; canvas.height = 48;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    this.data.forEach((color, i) => { if (color) { ctx.fillStyle = color; ctx.fillRect(i % 48, Math.floor(i / 48), 1, 1); } });
  }
}
