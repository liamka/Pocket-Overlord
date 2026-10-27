import { canUseWorldEditors } from './core/world-rules';
import './style.css';
import { createRegistry } from './content/defaults';
import { setUfoViewport } from './content/ufos';
import { setDragonViewport } from './content/dragons';
import { FixedClock } from './core/clock';
import { World } from './core/world';
import { seedSettlements } from './systems/society';
import { SIMULATION_SPEEDS, type GameCommand, type SimulationSpeed, type WorldSnapshot } from './core/types';
import { InputController } from './input/controller';
import { IndexedDBBackend, SaveService } from './persistence/storage';
import { Renderer } from './render/renderer';
import { TILE } from './render/camera';
import { UI } from './ui';

const registry = createRegistry();
const debugMode = new URLSearchParams(window.location.search).get('debug') === '1';
if (!debugMode) {
  for (const id of [
    'core:stockpile', 'core:stockpile-fireproof', 'core:stockpile-acidproof', 'core:cancel-construction', 'core:clear-ruins',
    'core:warm', 'core:cool', 'core:temple', 'core:mine', 'core:inspect-tile', 'core:food-plant',
    'core:cloud-life', 'core:cloud-snow', 'core:cloud-rain', 'core:cloud-ash', 'core:cloud-magic',
    'core:cloud-rage', 'core:cloud-hell', 'core:cloud-lava', 'core:cloud-acid', 'core:disperse-clouds',
  ]) {
    registry.tools.delete(id);
  }
}
let ready = false;
const ui = new UI(registry, id => {
  selected = registry.tools.get(id)!;
  renderer.tool = selected; ui.select(selected);
}, debugMode);
let selected = ui.currentTool;
ui.setLoading('Loading world…');
const renderer = new Renderer(ui.canvas, debugMode);
renderer.resize(); renderer.tool = selected; ui.select(selected);
const clock = new FixedClock();
const saves = new SaveService(new IndexedDBBackend('little-world', true), registry);
const CAMERA_KEY = 'pocket-world.camera';
const seed = (): number => crypto.getRandomValues(new Uint32Array(1))[0];
let world: World;
function saveCamera(): void {
  if (!ready) return;
  try {
    const { x, y, zoom } = renderer.camera;
    localStorage.setItem(CAMERA_KEY, JSON.stringify({ seed: world.seed, x, y, zoom }));
  } catch { /* Camera navigation remains usable when browser storage is unavailable. */ }
}
function restoreCamera(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(CAMERA_KEY) ?? 'null');
    if (!saved || saved.seed !== world.seed || ![saved.x, saved.y, saved.zoom].every(Number.isFinite)
      || saved.zoom < 0.04 || saved.zoom > 5) return;
    renderer.camera.x = saved.x; renderer.camera.y = saved.y; renderer.camera.zoom = saved.zoom;
  } catch { /* Keep the fitted view when camera preferences are missing or invalid. */ }
}
// Encode changing state separately so rapid placements share the unchanged map.
// Count shared terrain once against the history budget, keeping at least one entry.
const undoHistory: { state: Uint8Array; terrain: Uint8Array }[] = [];
const undoBudget = 128 * 1024 * 1024;
const undoEncoder = new TextEncoder(), undoDecoder = new TextDecoder();
const undoTerrainUsers = new Map<Uint8Array, number>();
let undoTerrain: WorldSnapshot['terrain'] | undefined, undoTerrainData: Uint8Array | undefined;
let undoBytes = 0;
function releaseUndo(entry: typeof undoHistory[number]): void {
  undoBytes -= entry.state.byteLength;
  const users = undoTerrainUsers.get(entry.terrain)! - 1;
  if (users) undoTerrainUsers.set(entry.terrain, users);
  else { undoTerrainUsers.delete(entry.terrain); undoBytes -= entry.terrain.byteLength; }
}
let actionRecorded = false;
const updateUI = (): void => { if (world) ui.update(world, renderer.camera.zoom); };
const pausesSimulation = (): boolean => ui.dialog.open || ui.worldLawsPanel.isOpen || ui.tileInspector.dialog.open || ui.settingsDialog.open || ui.equipmentInspector.dialog.open;
const modalOpen = (): boolean => pausesSimulation() || ui.creatureInspector.dialog.open;
const togglePause = (): void => {
  if (!ready) return;
  world.command({ kind: 'pause', paused: !world.paused }); clock.reset(); updateUI();
};
const dispatch = (command: GameCommand): boolean | void => {
  if (command.kind === 'use-tool' && command.toolId === 'core:inspect-tile') {
    ui.tileInspector.open(world, command); updateUI(); return;
  }
  if (command.kind === 'use-tool' && command.toolId === 'core:inspect') {
    if (!debugMode && !canUseWorldEditors(world)) return;
    if (!ui.unitInspector.selectAt(world, command, 12 / (TILE * renderer.camera.zoom))) ui.toast('No unit at this point');
    updateUI(); return;
  }
  // Keep one checkpoint for the entire click, brush stroke or held power.
  const before = command.kind === 'use-tool' && !actionRecorded
    && world.terrain.inside(command.x, command.y)
    && registry.tools.get(command.toolId)?.canApply?.(world, command) !== false
    ? world.snapshot(world.terrain.snapshot(undoTerrain)) : undefined;
  const previousEntityId = world.nextEntityId;
  const message = world.command(command);
  if (before) {
    const { terrain, ...state } = before, checkpoint = JSON.stringify(state);
    // A new identity proves the action changed the world, without a second copy.
    let changed = before.nextEntityId !== world.nextEntityId;
    if (!changed) {
      const { terrain: afterTerrain, ...after } = world.snapshot(world.terrain.snapshot(terrain));
      changed = afterTerrain !== terrain || checkpoint !== JSON.stringify(after);
    }
    if (changed) {
      if (terrain !== undoTerrain) {
        undoTerrain = terrain; undoTerrainData = undoEncoder.encode(JSON.stringify(terrain));
      }
      const entry = { state: undoEncoder.encode(checkpoint), terrain: undoTerrainData! };
      const users = undoTerrainUsers.get(entry.terrain) ?? 0;
      undoTerrainUsers.set(entry.terrain, users + 1);
      undoHistory.push(entry); undoBytes += entry.state.byteLength + (users ? 0 : entry.terrain.byteLength);
      while (undoBytes > undoBudget && undoHistory.length > 1) releaseUndo(undoHistory.shift()!);
      actionRecorded = true; ui.undo.disabled = false;
    }
  }
  if (command.kind === 'speed' || command.kind === 'pause') clock.reset();
  if (message) ui.toast(message);
  updateUI();
  return world.nextEntityId !== previousEntityId;
};
const stepSpeed = (direction: -1 | 1): void => {
  const speed = SIMULATION_SPEEDS[SIMULATION_SPEEDS.indexOf(world.speed) + direction];
  if (speed !== undefined) dispatch({ kind: 'speed', speed });
  ui.closeSpeedMenu();
};
const input = new InputController(renderer, {
  tool: () => selected,
  select: id => { selected = registry.tools.get(id)!; renderer.tool = selected; ui.select(selected); },
  tools: () => registry.tools.values(),
  dispatch,
  beginAction: () => { actionRecorded = false; },
  togglePause,
  stepSpeed: direction => {
    if (direction === -1 && (world.paused || world.speed === SIMULATION_SPEEDS[0])) {
      dispatch({ kind: 'speed', speed: 0 });
      ui.closeSpeedMenu();
    } else stepSpeed(direction);
  },
  dimensions: () => ({ x: world.terrain.width, y: world.terrain.height }),
  blocked: () => !ready || modalOpen(),
  cameraChanged: () => { ui.unitInspector.followId = null; saveCamera(); ui.updateZoom(renderer.camera.zoom); },
});
ui.unitInspector.onFocus = point => { renderer.camera.x = point.x; renderer.camera.y = point.y; saveCamera(); updateUI(); };
input.bindTouchControls(ui.touchControls);
ui.undo.addEventListener('click', () => {
  const entry = undoHistory.at(-1);
  if (!ready || modalOpen() || !entry) return;
  input.reset();
  const { paused, speed } = world;
  const undoSnapshot = { ...JSON.parse(undoDecoder.decode(entry.state)), terrain: JSON.parse(undoDecoder.decode(entry.terrain)) } as WorldSnapshot;
  world = new World(undoSnapshot.seed, registry, undoSnapshot);
  world.paused = paused; world.speed = speed;
  for (const tool of registry.tools.values()) tool.release?.(world);
  undoHistory.pop(); releaseUndo(entry);
  undoTerrain = undefined; undoTerrainData = undefined;
  actionRecorded = false; ui.undo.disabled = undoHistory.length === 0;
  clock.reset(); updateUI();
  renderer.draw(world, performance.now(), ui.currentLanguage);
  ui.toast('Последнее действие отменено');
  void autoSave();
});
for (const button of ui.speedButtons) button.addEventListener('click', () => {
  dispatch({ kind: 'speed', speed: Number(button.dataset.speed) as SimulationSpeed });
  ui.closeSpeedMenu(true);
});
ui.timeToggle.addEventListener('click', togglePause);
for (const [button, direction] of [[ui.slower, -1], [ui.faster, 1]] as const) button.addEventListener('click', () => {
  stepSpeed(direction);
});
ui.newWorld.addEventListener('click', () => {
  ui.settingsDialog.close();
  try { ui.prepareNewWorld(seed()); ui.dialog.showModal(); }
  catch { ui.toast('Could not create the world. Try again.'); }
});
ui.settingsDialog.addEventListener('close', () => clock.reset());
ui.dialog.addEventListener('close', () => {
  clock.reset();
  if (ui.dialog.returnValue !== 'new' || !ready) return;
  void createWorld();
});
// Two animation frames let the browser paint the overlay before synchronous world setup.
const paintLoading = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
function showWorld(totalSteps: number, restoreView = false): void {
  renderer.resize();
  renderer.camera.fit(world.terrain.width, world.terrain.height);
  if (restoreView) restoreCamera();
  updateUI();
  renderer.draw(world, performance.now(), ui.currentLanguage);
  ui.setLoadingProgress(totalSteps, totalSteps);
  ready = true; clock.reset();
  saveCamera();
  ui.setLoading(null);
}
async function createWorld(): Promise<void> {
  ready = false; clock.reset();
  ui.setLoading('Creating world…');
  await paintLoading();
  try {
    world = new World(ui.newWorldSeed, registry, undefined, undefined, ui.newWorldBiome, ui.newWorldNature);
    seedSettlements(world);
    undoHistory.length = 0; undoTerrainUsers.clear(); undoTerrain = undefined; undoTerrainData = undefined;
    undoBytes = 0; actionRecorded = false; ui.undo.disabled = true;
  }
  catch {
    ready = true; clock.reset(); ui.setLoading(null);
    ui.toast('Could not create the world. Try again.');
    return;
  }
  ui.setLoadingProgress(1, 2);
  await paintLoading();
  showWorld(2);
  ui.saved('Сохраняем новый мир…');
  void saves.replace(world.snapshot()).then(() => { ui.warning(''); ui.saved(''); }, error => saveError(error));
}
window.addEventListener('resize', () => { renderer.resize(); updateUI(); });
// CSS (including imported fonts) may finish after module initialization in Firefox.
// Track the rendered canvas box, not just the browser window's resize event.
const canvasObserver = new ResizeObserver(() => {
  renderer.resize();
  updateUI();
});
canvasObserver.observe(ui.canvas);
function saveError(error: unknown): void {
  ui.saved('Не удалось сохранить', true);
  ui.warning(`Мир не сохранён. ${error instanceof Error ? error.message : 'Хранилище недоступно'}. Игра продолжает работать.`);
}
async function autoSave(): Promise<void> {
  if (!ready) return;
  saveCamera();
  try { await saves.saveWorld(world); ui.saved(''); ui.warning(''); }
  catch (error) { saveError(error); }
}
let fpsStarted: number | undefined, fpsFrames = 0;
document.addEventListener('visibilitychange', () => {
  clock.reset();
  fpsStarted = undefined; fpsFrames = 0;
  if (document.hidden) void autoSave();
});
window.addEventListener('pagehide', () => { clock.reset(); void autoSave(); });
let autoSaveRequested = false;
setInterval(() => { if (document.hidden) void autoSave(); else autoSaveRequested = true; }, 5000);
let lastUI = 0, previousFrame = 0, presentationMs = 3;
function frame(now: number): void {
  if (ready && !document.hidden) {
    const started = performance.now();
    const frameInterval = previousFrame ? Math.min(1000 / 60, Math.max(1000 / 240, now - previousFrame)) : 1000 / 60;
    previousFrame = now;
    input.update(now);
    const camera = renderer.camera;
    const topLeft = camera.screenToWorld(0, 0), bottomRight = camera.screenToWorld(camera.width, camera.height);
    const viewport = { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y };
    setUfoViewport(world, viewport); setDragonViewport(world, viewport);
    // A checkpoint gets its own frame instead of stacking on top of simulation work.
    if (autoSaveRequested) { autoSaveRequested = false; void autoSave(); clock.reset(); }
    else clock.advance(now, !world.paused && !pausesSimulation(), () => world.step(), world.speed,
      Math.max(1, Math.min(10, frameInterval - presentationMs - (performance.now() - started) - 2)));
    const presentationStarted = performance.now();
    const followed = world.entities.get(ui.unitInspector.followId ?? -1)?.components.position;
    if (followed) { camera.x = followed.x; camera.y = followed.y; }
    renderer.selectedUnitId = ui.unitInspector.panel.hidden ? null : ui.unitInspector.selectedId;
    renderer.draw(world, now, ui.currentLanguage);
    if (fpsStarted === undefined) fpsStarted = now;
    else fpsFrames++;
    if (now - fpsStarted >= 500) {
      ui.updateFPS(Math.round(fpsFrames * 1000 / (now - fpsStarted)));
      fpsStarted = now; fpsFrames = 0;
    }
    if (now - lastUI > 150) { updateUI(); lastUI = now; }
    presentationMs = Math.max(performance.now() - presentationStarted, presentationMs * 0.9);
  } else { clock.reset(); fpsStarted = undefined; fpsFrames = 0; previousFrame = 0; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
async function loadWorld(): Promise<void> {
  // Four completed stages: game setup, save read, world setup and the first rendered frame.
  ui.setLoadingProgress(1, 4);
  await paintLoading();
  const result = await saves.load();
  ui.setLoadingProgress(2, 4);
  await paintLoading();
  if (result.status === 'loaded') { world = new World(result.snapshot.seed, registry, result.snapshot); ui.saved('Мир восстановлен'); }
  else { world = new World(seed(), registry); seedSettlements(world); ui.saved('Автосохранение каждые 5 с'); }
  // Held mouse and touch gestures do not survive a page reload.
  for (const tool of registry.tools.values()) tool.release?.(world);
  ui.setLoadingProgress(3, 4);
  await paintLoading();
  showWorld(4, result.status === 'loaded');
  void autoSave();
}
void loadWorld().catch(() => ui.loadingFailed());
