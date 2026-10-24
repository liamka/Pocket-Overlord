import type { ToolDefinition } from '../content/registry';
import type { GameCommand, SimulationSpeed, Vec2 } from '../core/types';
import type { Renderer } from '../render/renderer';

const speedKeys: Readonly<Record<string, 0 | SimulationSpeed>> = { '1': 0, '2': 1, '3': 2, '4': 4 };
const DRAG_THRESHOLD = 4;
const HOLD_DELAY = 250;

interface PointerGesture {
  id: number;
  button: number;
  start: Vec2;
  last: Vec2;
  started: number;
  toolId: string;
  applied: boolean;
}

export interface InputHost {
  tool(): ToolDefinition;
  select(id: string): void;
  tools(): Iterable<ToolDefinition>;
  dispatch(command: GameCommand): void;
  togglePause(): void;
  dimensions(): Vec2;
  blocked(): boolean;
  cameraChanged(): void;
}

/** Desktop input is only a command adapter. The world has no DOM dependencies. */
export class DesktopController {
  private gesture: PointerGesture | undefined;
  private panning = false;
  private point: Vec2 | undefined;
  private lastRain = -Infinity;
  private lastAim: (Vec2 & { toolId: string }) | undefined;
  private readonly held = new Set<string>();
  private lastControl = '';
  private controlledTool: string | undefined;
  constructor(private readonly renderer: Renderer, private readonly host: InputHost) {
    const canvas = renderer.canvas;
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    canvas.addEventListener('pointerdown', event => {
      if (host.blocked() || event.pointerType === 'touch' || this.gesture || ![0, 1, 2].includes(event.button)) return;
      event.preventDefault();
      canvas.focus({ preventScroll: true });
      const point = { x: event.clientX, y: event.clientY };
      this.gesture = { id: event.pointerId, button: event.button, start: point, last: point, started: performance.now(), toolId: host.tool().id, applied: false };
      canvas.setPointerCapture(event.pointerId);
      this.updatePoint(event);
      if (event.button !== 0) { this.panning = true; canvas.classList.add('panning'); }
      else if (host.tool().aim || host.tool().paint) { this.apply(); this.gesture.applied = true; }
      this.control();
    });
    canvas.addEventListener('pointermove', event => this.move(event));
    const release = (): void => this.release();
    canvas.addEventListener('pointerup', event => {
      if (event.pointerId !== this.gesture?.id) return;
      this.move(event);
      const gesture = this.gesture;
      const click = gesture?.button === 0 && !this.panning && !gesture.applied && gesture.toolId === host.tool().id;
      release();
      if (click) this.apply();
    });
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('lostpointercapture', release);
    canvas.addEventListener('pointerleave', () => { renderer.cursor = undefined; });
    const cancel = (): void => { this.held.clear(); release(); this.control(false); };
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', cancel);
    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      if (host.blocked()) return;
      const rect = canvas.getBoundingClientRect();
      renderer.camera.zoomAt(Math.exp(-event.deltaY * 0.0045), event.clientX - rect.left, event.clientY - rect.top);
      this.updatePoint(event); host.cameraChanged();
    }, { passive: false });
    window.addEventListener('keydown', event => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || host.blocked()) return;
      const target = event.target as HTMLElement;
      if (target.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (host.tool().control && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'].includes(event.code)) {
        event.preventDefault(); this.held.add(event.code); this.control(); return;
      }
      const speed = speedKeys[event.code.replace(/^(Digit|Numpad)/, '')] ?? speedKeys[event.key];
      if (speed !== undefined) {
        event.preventDefault(); if (!host.tool().release) release(); host.dispatch({ kind: 'speed', speed }); return;
      }
      const tool = [...host.tools()].find(t => t.shortcut === event.key);
      if (tool) { event.preventDefault(); release(); host.select(tool.id); }
      if (event.code === 'Space' && !target.closest('button')) { event.preventDefault(); if (!host.tool().release) release(); host.togglePause(); }
    });
    window.addEventListener('keyup', event => { if (this.held.delete(event.code)) { event.preventDefault(); this.control(); } });
  }
  private release(): void {
    const gesture = this.gesture;
    this.gesture = undefined; this.panning = false;
    if (gesture?.button === 0 && gesture.applied && [...this.host.tools()].some(tool => tool.id === gesture.toolId && tool.release)) {
      this.host.dispatch({ kind: 'release-tool', toolId: gesture.toolId });
      this.lastAim = undefined;
    }
    this.renderer.canvas.classList.remove('panning');
    if (gesture && this.renderer.canvas.hasPointerCapture(gesture.id)) this.renderer.canvas.releasePointerCapture(gesture.id);
    this.control();
  }
  private control(active = !this.host.blocked()): void {
    const tool = this.host.tool();
    if (this.controlledTool && (tool.id !== this.controlledTool || !active)) {
      this.host.dispatch({ kind: 'control-tool', toolId: this.controlledTool, x: 0, y: 0, attacking: false, active: false });
      this.controlledTool = undefined; this.lastControl = ''; this.held.clear();
    }
    if (!tool.control || !active) return;
    const pressed = (...codes: string[]) => codes.some(code => this.held.has(code)) ? 1 : 0;
    const x = pressed('KeyD', 'ArrowRight') - pressed('KeyA', 'ArrowLeft');
    const y = pressed('KeyS', 'ArrowDown') - pressed('KeyW', 'ArrowUp');
    const attacking = this.gesture?.button === 0 && this.gesture.toolId === tool.id && !this.panning;
    const signature = `${tool.id}:${x}:${y}:${attacking}`;
    if (signature !== this.lastControl) {
      this.host.dispatch({ kind: 'control-tool', toolId: tool.id, x, y, attacking, active: true });
      this.lastControl = signature; this.controlledTool = tool.id;
    }
  }
  private move(event: PointerEvent): void {
    if (event.pointerType === 'touch') return;
    if (this.host.blocked()) { this.held.clear(); this.release(); this.control(false); return; }
    const gesture = this.gesture;
    if (gesture && event.pointerId === gesture.id) {
      if (gesture.button === 0 && !(event.buttons & 1) && this.host.tool().release) { this.release(); this.updatePoint(event); return; }
      const current = { x: event.clientX, y: event.clientY };
      const steering = gesture.button === 0 && gesture.toolId === this.host.tool().id && !!(this.host.tool().aim || this.host.tool().paint);
      if (!steering && !this.panning && Math.hypot(current.x - gesture.start.x, current.y - gesture.start.y) >= DRAG_THRESHOLD) {
        this.panning = true; this.renderer.canvas.classList.add('panning');
      }
      if (this.panning) {
        const size = this.host.dimensions();
        this.renderer.camera.pan(current.x - gesture.last.x, current.y - gesture.last.y, size.x, size.y);
        this.host.cameraChanged(); gesture.last = current;
      }
    }
    this.updatePoint(event);
    this.aim();
    if (gesture?.button === 0 && !this.panning && gesture.toolId === this.host.tool().id && this.host.tool().paint) this.apply();
  }
  private updatePoint(event: MouseEvent): void {
    const rect = this.renderer.canvas.getBoundingClientRect();
    this.point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    this.renderer.cursor = this.renderer.camera.screenToWorld(this.point.x, this.point.y);
  }
  private apply(): void {
    if (!this.renderer.cursor || this.host.blocked()) return;
    const camera = this.renderer.camera;
    const topLeft = camera.screenToWorld(0, 0), bottomRight = camera.screenToWorld(camera.width, camera.height);
    this.host.dispatch({ kind: 'use-tool', toolId: this.host.tool().id, ...this.renderer.cursor,
      viewport: { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y } });
  }
  private aim(): void {
    const tool = this.host.tool(), point = this.renderer.cursor;
    if (!tool.aim || !point || this.panning || this.host.blocked()
      || tool.release && (this.gesture?.button !== 0 || this.gesture.toolId !== tool.id)) { this.lastAim = undefined; return; }
    if (this.lastAim?.toolId === tool.id && this.lastAim.x === point.x && this.lastAim.y === point.y) return;
    this.host.dispatch({ kind: 'aim-tool', toolId: tool.id, ...point });
    this.lastAim = { toolId: tool.id, ...point };
  }
  update(now: number): void {
    if (this.host.blocked()) { this.held.clear(); this.release(); this.control(false); return; }
    if (this.gesture && this.gesture.toolId !== this.host.tool().id) this.release();
    this.control();
    if (this.point && this.renderer.cursor) this.renderer.cursor = this.renderer.camera.screenToWorld(this.point.x, this.point.y);
    this.aim();
    const gesture = this.gesture, tool = this.host.tool();
    // Stationary holds repeat continuous powers; aimed powers steer instead of panning.
    if (gesture?.button === 0 && !this.panning && tool.id === gesture.toolId && tool.continuous
      && now - gesture.started >= HOLD_DELAY && now - this.lastRain >= 80) {
      this.apply(); gesture.applied = true; this.lastRain = now;
    }
  }
}
