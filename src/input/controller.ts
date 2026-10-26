import type { ToolDefinition } from '../content/registry';
import type { GameCommand, Vec2 } from '../core/types';
import type { Renderer } from '../render/renderer';

const DRAG_THRESHOLD = 4;
const HOLD_DELAY = 250;
const TOUCH_HOLD_DELAY = 350;
const TOUCH_DRAG_THRESHOLD = 8;
const CAMERA_PAN_SPEED = 600;

interface PointerGesture {
  id: number;
  button: number;
  start: Vec2;
  last: Vec2;
  started: number;
  toolId: string;
  applied: boolean;
  touch: boolean;
}

export interface InputHost {
  tool(): ToolDefinition;
  select(id: string): void;
  tools(): Iterable<ToolDefinition>;
  dispatch(command: GameCommand): void;
  beginAction?(): void;
  togglePause(): void;
  stepSpeed(direction: -1 | 1): void;
  dimensions(): Vec2;
  blocked(): boolean;
  cameraChanged(): void;
}

/** Pointer, touch and keyboard input share the same world commands. */
export class InputController {
  private gesture: PointerGesture | undefined;
  private panning = false;
  private point: Vec2 | undefined;
  private lastRain = -Infinity;
  private lastAim: (Vec2 & { toolId: string }) | undefined;
  private readonly held = new Set<string>();
  private lastUpdate: number | undefined;
  private lastControl = '';
  private controlledTool: string | undefined;
  private readonly touches = new Map<number, Vec2>();
  private touchNavigation: { center: Vec2; distance: number } | undefined;
  private readonly touchButtons = new Map<number, { button: HTMLElement; code: string }>();
  constructor(private readonly renderer: Renderer, private readonly host: InputHost) {
    const canvas = renderer.canvas;
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    canvas.addEventListener('pointerdown', event => {
      if (event.pointerType === 'touch') { this.touchDown(event); return; }
      if (host.blocked() || this.gesture || this.touches.size || ![0, 1, 2].includes(event.button)) return;
      event.preventDefault();
      canvas.focus({ preventScroll: true });
      const point = { x: event.clientX, y: event.clientY };
      this.gesture = { id: event.pointerId, button: event.button, start: point, last: point, started: performance.now(), toolId: host.tool().id, applied: false, touch: false };
      canvas.setPointerCapture(event.pointerId);
      this.updatePoint(event);
      if (event.button !== 0) { this.panning = true; canvas.classList.add('panning'); }
      else if (host.tool().aim || host.tool().paint) { this.apply(); this.gesture.applied = true; }
      this.control();
    });
    canvas.addEventListener('pointermove', event => this.move(event));
    const release = (): void => this.release();
    canvas.addEventListener('pointerup', event => {
      if (event.pointerType === 'touch') { this.touchEnd(event); return; }
      if (event.pointerId !== this.gesture?.id) return;
      this.move(event);
      const gesture = this.gesture;
      const click = gesture?.button === 0 && !this.panning && !gesture.applied && gesture.toolId === host.tool().id;
      release();
      if (click) this.apply();
    });
    const cancelled = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') this.touchEnd(event, true);
      else if (event.pointerId === this.gesture?.id) release();
    };
    canvas.addEventListener('pointercancel', cancelled);
    canvas.addEventListener('lostpointercapture', cancelled);
    canvas.addEventListener('pointerleave', () => { if (!this.gesture && !this.touches.size) renderer.cursor = undefined; });
    const cancel = (): void => this.cancel();
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
      if (event.code !== 'Space' || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault(); event.stopPropagation();
      if (event.repeat) return;
      if (!host.tool().release) release();
      host.togglePause();
    }, { capture: true });
    window.addEventListener('keydown', event => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || host.blocked()) return;
      const target = event.target as HTMLElement;
      if (target.matches('input, textarea, select, [contenteditable="true"]') || target.closest('#unit-panel')) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)
        || host.tool().control && ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'].includes(event.code)) {
        event.preventDefault(); this.held.add(event.code); this.control(); return;
      }
      const digit = /^(?:Digit|Numpad)(\d)$/.exec(event.code)?.[1] ?? (/^\d$/.test(event.key) ? event.key : undefined);
      if (digit !== undefined) {
        const category = host.tool().category ?? 'nature';
        const tool = [...host.tools()].filter(tool => (tool.category ?? 'nature') === category)[digit === '0' ? 9 : Number(digit) - 1];
        if (tool) { event.preventDefault(); release(); host.select(tool.id); }
        return;
      }
      const direction = event.code === 'Equal' || event.code === 'NumpadAdd' || event.key === '+' ? 1
        : event.code === 'Minus' || event.code === 'NumpadSubtract' || event.key === '-' ? -1 : undefined;
      if (direction !== undefined) {
        event.preventDefault(); if (!host.tool().release) release(); host.stepSpeed(direction); return;
      }
      const tool = [...host.tools()].find(t => t.shortcut === event.key);
      if (tool) { event.preventDefault(); release(); host.select(tool.id); }
    });
    window.addEventListener('keyup', event => { if (this.held.delete(event.code)) { event.preventDefault(); this.control(); } });
  }
  private touchSnapshot(): { center: Vec2; distance: number } {
    const [a, b = a] = this.touches.values();
    return { center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.hypot(a.x - b.x, a.y - b.y) };
  }
  private touchDown(event: PointerEvent): void {
    if (this.host.blocked()) return;
    event.preventDefault();
    const canvas = this.renderer.canvas, point = { x: event.clientX, y: event.clientY };
    canvas.focus({ preventScroll: true });
    this.touches.set(event.pointerId, point); canvas.setPointerCapture(event.pointerId);
    if (this.touches.size > 1 || this.touchNavigation) {
      // Once a second finger arrives, every remaining finger belongs to navigation
      // until all have lifted. Ending a pinch can never stamp a tool on the map.
      this.release(false); this.touchNavigation = this.touchSnapshot();
      this.panning = true; canvas.classList.add('panning');
      this.point = undefined; this.renderer.cursor = undefined; return;
    }
    this.release();
    this.gesture = { id: event.pointerId, button: 0, start: point, last: point, started: performance.now(), toolId: this.host.tool().id, applied: false, touch: true };
    this.updatePoint(event); this.control();
  }
  private touchEnd(event: PointerEvent, cancelled = false): void {
    if (!this.touches.has(event.pointerId)) return;
    if (!cancelled) this.move(event);
    const gesture = this.gesture;
    const tap = !cancelled && !this.touchNavigation && gesture?.id === event.pointerId && !this.panning && !gesture.applied && gesture.toolId === this.host.tool().id;
    if (gesture?.id === event.pointerId) this.release(false);
    this.touches.delete(event.pointerId);
    if (this.renderer.canvas.hasPointerCapture(event.pointerId)) this.renderer.canvas.releasePointerCapture(event.pointerId);
    if (tap) {
      this.apply();
      // A tap is a complete gesture even for a power with a held lifetime.
      if (this.host.tool().release) this.host.dispatch({ kind: 'release-tool', toolId: this.host.tool().id });
    }
    if (!this.touches.size) {
      this.touchNavigation = undefined; this.panning = false; this.renderer.canvas.classList.remove('panning');
      if (!tap) { this.point = undefined; this.renderer.cursor = undefined; }
    } else if (this.touchNavigation) this.touchNavigation = this.touchSnapshot();
    this.control();
  }
  /** On-screen directions can be held together, including while aiming on the map. */
  bindTouchControls(container: HTMLElement): void {
    container.addEventListener('contextmenu', event => event.preventDefault());
    container.addEventListener('pointerdown', event => {
      const button = (event.target as Element).closest<HTMLElement>('[data-control]');
      if (!button || this.host.blocked() || !this.host.tool().control || event.button !== 0) return;
      event.preventDefault();
      this.touchButtons.set(event.pointerId, { button, code: button.dataset.control! });
      button.setAttribute('aria-pressed', 'true'); button.setPointerCapture(event.pointerId); this.control();
    });
    const release = (event: PointerEvent): void => {
      const entry = this.touchButtons.get(event.pointerId);
      if (!entry) return;
      this.touchButtons.delete(event.pointerId);
      if (![...this.touchButtons.values()].some(other => other.button === entry.button)) entry.button.setAttribute('aria-pressed', 'false');
      if (entry.button.hasPointerCapture(event.pointerId)) entry.button.releasePointerCapture(event.pointerId);
      this.control();
    };
    container.addEventListener('pointerup', release); container.addEventListener('pointercancel', release); container.addEventListener('lostpointercapture', release);
  }
  private clearTouchButtons(): void {
    const entries = [...this.touchButtons]; this.touchButtons.clear();
    for (const [id, { button }] of entries) {
      button.setAttribute('aria-pressed', 'false');
      if (button.hasPointerCapture(id)) button.releasePointerCapture(id);
    }
  }
  private cancel(): void {
    const ids = [...this.touches.keys()]; this.touches.clear(); this.touchNavigation = undefined;
    this.held.clear(); this.clearTouchButtons(); this.release(); this.control(false);
    this.point = undefined; this.renderer.cursor = undefined;
    for (const id of ids) if (this.renderer.canvas.hasPointerCapture(id)) this.renderer.canvas.releasePointerCapture(id);
  }
  reset(): void {
    this.cancel();
    this.lastAim = undefined; this.lastRain = -Infinity;
    this.lastControl = ''; this.controlledTool = undefined;
  }
  private release(releaseCapture = true): void {
    const gesture = this.gesture;
    this.gesture = undefined; this.panning = false;
    if (gesture?.button === 0 && gesture.applied && [...this.host.tools()].some(tool => tool.id === gesture.toolId && tool.release)) {
      this.host.dispatch({ kind: 'release-tool', toolId: gesture.toolId });
      this.lastAim = undefined;
    }
    this.renderer.canvas.classList.remove('panning');
    if (releaseCapture && gesture && this.renderer.canvas.hasPointerCapture(gesture.id)) this.renderer.canvas.releasePointerCapture(gesture.id);
    this.control();
  }
  private control(active = !this.host.blocked()): void {
    const tool = this.host.tool();
    if (this.controlledTool && (tool.id !== this.controlledTool || !active)) {
      this.host.dispatch({ kind: 'control-tool', toolId: this.controlledTool, x: 0, y: 0, attacking: false, active: false });
      this.controlledTool = undefined; this.lastControl = ''; this.held.clear(); this.clearTouchButtons();
    }
    if (!tool.control || !active) return;
    const pressed = (...codes: string[]) => codes.some(code => this.held.has(code) || [...this.touchButtons.values()].some(entry => entry.code === code)) ? 1 : 0;
    const x = pressed('KeyD', 'ArrowRight') - pressed('KeyA', 'ArrowLeft');
    const y = pressed('KeyS', 'ArrowDown') - pressed('KeyW', 'ArrowUp');
    const attacking = !!pressed('attack') || this.gesture?.button === 0 && this.gesture.toolId === tool.id && !this.panning && (!this.gesture.touch || this.gesture.applied);
    const signature = `${tool.id}:${x}:${y}:${attacking}`;
    if (signature !== this.lastControl) {
      this.host.dispatch({ kind: 'control-tool', toolId: tool.id, x, y, attacking, active: true });
      this.lastControl = signature; this.controlledTool = tool.id;
    }
  }
  private move(event: PointerEvent): void {
    if (this.host.blocked()) { this.cancel(); return; }
    if (event.pointerType === 'touch') {
      if (!this.touches.has(event.pointerId)) return;
      event.preventDefault(); this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.touchNavigation) {
        const before = this.touchNavigation, after = this.touchSnapshot(), camera = this.renderer.camera;
        const size = this.host.dimensions(), rect = this.renderer.canvas.getBoundingClientRect();
        // Zoom around the old midpoint, then move it and clamp the final camera position.
        // Clamping before zoom leaves the camera outside its bounds until a finger lifts.
        if (before.distance > 0 && after.distance > 0) camera.zoomAt(after.distance / before.distance, before.center.x - rect.left, before.center.y - rect.top);
        camera.pan(after.center.x - before.center.x, after.center.y - before.center.y, size.x, size.y);
        this.touchNavigation = after; this.host.cameraChanged(); return;
      }
    } else if (this.touches.size) return;
    const gesture = this.gesture;
    if (gesture && event.pointerId === gesture.id) {
      if (!gesture.touch && gesture.button === 0 && !(event.buttons & 1) && this.host.tool().release) { this.release(); this.updatePoint(event); return; }
      const current = { x: event.clientX, y: event.clientY };
      const steering = gesture.button === 0 && gesture.toolId === this.host.tool().id && !!(this.host.tool().aim || this.host.tool().paint || gesture.touch && this.host.tool().continuous) && (!gesture.touch || gesture.applied);
      if (!steering && !this.panning && Math.hypot(current.x - gesture.start.x, current.y - gesture.start.y) >= (gesture.touch ? TOUCH_DRAG_THRESHOLD : DRAG_THRESHOLD)) {
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
    if (gesture?.button === 0 && !this.panning && gesture.toolId === this.host.tool().id && this.host.tool().paint && (!gesture.touch || gesture.applied)) this.apply();
  }
  private updatePoint(event: MouseEvent): void {
    const rect = this.renderer.canvas.getBoundingClientRect();
    this.point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    this.renderer.cursor = this.renderer.camera.screenToWorld(this.point.x, this.point.y);
  }
  private apply(): void {
    if (!this.renderer.cursor || this.host.blocked()) return;
    if (!this.gesture?.applied) this.host.beginAction?.();
    if (this.gesture) this.gesture.applied = true;
    const camera = this.renderer.camera;
    const topLeft = camera.screenToWorld(0, 0), bottomRight = camera.screenToWorld(camera.width, camera.height);
    this.host.dispatch({ kind: 'use-tool', toolId: this.host.tool().id, ...this.renderer.cursor,
      viewport: { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y } });
  }
  private aim(): void {
    const tool = this.host.tool(), point = this.renderer.cursor;
    if (!tool.aim || !point || this.panning || this.host.blocked() || this.gesture?.touch && !this.gesture.applied
      || tool.release && (this.gesture?.button !== 0 || this.gesture.toolId !== tool.id)) { this.lastAim = undefined; return; }
    if (this.lastAim?.toolId === tool.id && this.lastAim.x === point.x && this.lastAim.y === point.y) return;
    this.host.dispatch({ kind: 'aim-tool', toolId: tool.id, ...point });
    this.lastAim = { toolId: tool.id, ...point };
  }
  update(now: number): void {
    const elapsed = Math.min(50, Math.max(0, now - (this.lastUpdate ?? now))) / 1000;
    this.lastUpdate = now;
    if (this.host.blocked()) { this.cancel(); return; }
    if (this.gesture && this.gesture.toolId !== this.host.tool().id) this.cancel();
    this.control();
    if (!this.host.tool().control) {
      const x = Number(this.held.has('KeyD')) - Number(this.held.has('KeyA'));
      const y = Number(this.held.has('KeyS')) - Number(this.held.has('KeyW'));
      const length = Math.hypot(x, y);
      if (length && elapsed) {
        const size = this.host.dimensions(), distance = CAMERA_PAN_SPEED * elapsed / length;
        this.renderer.camera.pan(-x * distance, -y * distance, size.x, size.y);
        this.host.cameraChanged();
      }
    }
    if (this.point && this.renderer.cursor) this.renderer.cursor = this.renderer.camera.screenToWorld(this.point.x, this.point.y);
    this.aim();
    const gesture = this.gesture, tool = this.host.tool();
    if (gesture?.touch && !gesture.applied && !this.panning && now - gesture.started >= TOUCH_HOLD_DELAY && (tool.aim || tool.paint || tool.continuous)) {
      this.apply(); gesture.applied = true; this.lastRain = now; this.control(); this.aim();
    }
    // Stationary holds repeat continuous powers; aimed powers steer instead of panning.
    if (gesture?.button === 0 && !this.panning && tool.id === gesture.toolId && tool.continuous
      && now - gesture.started >= (gesture.touch ? TOUCH_HOLD_DELAY : HOLD_DELAY) && now - this.lastRain >= 80) {
      this.apply(); gesture.applied = true; this.lastRain = now;
    }
  }
}
