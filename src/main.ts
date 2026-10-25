import './style.css';
import { createRegistry } from './content/defaults';
import { setUfoViewport } from './content/ufos';
import { setDragonViewport } from './content/dragons';
import { FixedClock } from './core/clock';
import { World } from './core/world';
import { SIMULATION_SPEEDS, type GameCommand, type SimulationSpeed, type WorldSnapshot } from './core/types';
import { InputController } from './input/controller';
import { IndexedDBBackend, SaveService } from './persistence/storage';
import { Renderer } from './render/renderer';
import { UI } from './ui';

const registry = createRegistry();
const debugMode = new URLSearchParams(window.location.search).get('changelog') === '1';
let ready = false;
const ui = new UI(registry, id => {
  selected = registry.tools.get(id)!;
  renderer.tool = selected; ui.select(selected);
}, debugMode);
let selected = ui.currentTool;
ui.setLoading('Loading world…');
const renderer = new Renderer(ui.canvas);
renderer.resize(); renderer.tool = selected; ui.select(selected);
const clock = new FixedClock();
const saves = new SaveService(new IndexedDBBackend(), registry);
const seed = (): number => crypto.getRandomValues(new Uint32Array(1))[0];
let world: World;
// Store compact UTF-8 checkpoints without a fixed action limit. Discard the
// oldest entries when the history exceeds its budget, keeping at least one.
const undoHistory: Uint8Array[] = [];
const undoBudget = 128 * 1024 * 1024;
const undoEncoder = new TextEncoder(), undoDecoder = new TextDecoder();
let undoBytes = 0;
let actionRecorded = false;
const updateUI = (): void => { if (world) ui.update(world, renderer.camera.zoom); };
const modalOpen = (): boolean => ui.dialog.open || ui.settingsDialog.open;
const togglePause = (): void => { world.command({ kind: 'pause', paused: !world.paused }); clock.reset(); updateUI(); };
const dispatch = (command: GameCommand): void => {
  // Keep one checkpoint for the entire click, brush stroke or held power.
  const before = command.kind === 'use-tool' && !actionRecorded
    && world.terrain.inside(command.x, command.y)
    && registry.tools.get(command.toolId)?.canApply?.(world, command) !== false
    ? world.snapshot() : undefined;
  const message = world.command(command);
  const checkpoint = before && JSON.stringify(before);
  if (checkpoint && checkpoint !== JSON.stringify(world.snapshot())) {
    const entry = undoEncoder.encode(checkpoint);
    undoHistory.push(entry); undoBytes += entry.byteLength;
    while (undoBytes > undoBudget && undoHistory.length > 1) undoBytes -= undoHistory.shift()!.byteLength;
    actionRecorded = true; ui.undo.disabled = false;
  }
  if (command.kind === 'speed' || command.kind === 'pause') clock.reset();
  if (message) ui.toast(message);
  updateUI();
};
const input = new InputController(renderer, {
  tool: () => selected,
  select: id => { selected = registry.tools.get(id)!; renderer.tool = selected; ui.select(selected); },
  tools: () => registry.tools.values(),
  dispatch,
  beginAction: () => { actionRecorded = false; },
  togglePause,
  dimensions: () => ({ x: world.terrain.width, y: world.terrain.height }),
  blocked: () => !ready || modalOpen(),
  cameraChanged: updateUI,
});
input.bindTouchControls(ui.touchControls);
ui.undo.addEventListener('click', () => {
  const entry = undoHistory.at(-1);
  if (!ready || modalOpen() || !entry) return;
  input.reset();
  const { paused, speed } = world;
  const undoSnapshot = JSON.parse(undoDecoder.decode(entry)) as WorldSnapshot;
  world = new World(undoSnapshot.seed, registry, undoSnapshot);
  world.paused = paused; world.speed = speed;
  for (const tool of registry.tools.values()) tool.release?.(world);
  undoHistory.pop(); undoBytes -= entry.byteLength;
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
  const speed = SIMULATION_SPEEDS[SIMULATION_SPEEDS.indexOf(world.speed) + direction];
  if (speed !== undefined) dispatch({ kind: 'speed', speed });
  ui.closeSpeedMenu();
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
function showWorld(totalSteps: number): void {
  renderer.resize();
  renderer.camera.fit(world.terrain.width, world.terrain.height);
  updateUI();
  renderer.draw(world, performance.now(), ui.currentLanguage);
  ui.setLoadingProgress(totalSteps, totalSteps);
  ready = true; clock.reset();
  ui.setLoading(null);
}
async function createWorld(): Promise<void> {
  ready = false; clock.reset();
  ui.setLoading('Creating world…');
  await paintLoading();
  try {
    world = new World(ui.newWorldSeed, registry, undefined, undefined, ui.newWorldBiome, ui.newWorldNature);
    undoHistory.length = 0; undoBytes = 0; actionRecorded = false; ui.undo.disabled = true;
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
  try { await saves.save(world.snapshot()); ui.saved(''); ui.warning(''); }
  catch (error) { saveError(error); }
}
document.addEventListener('visibilitychange', () => {
  clock.reset();
  if (document.hidden) void autoSave();
});
window.addEventListener('pagehide', () => { clock.reset(); void autoSave(); });
setInterval(() => { void autoSave(); }, 5000);
let lastUI = 0;
function frame(now: number): void {
  if (ready && !document.hidden) {
    input.update(now);
    const camera = renderer.camera;
    const topLeft = camera.screenToWorld(0, 0), bottomRight = camera.screenToWorld(camera.width, camera.height);
    const viewport = { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y };
    setUfoViewport(world, viewport); setDragonViewport(world, viewport);
    clock.advance(now, !world.paused && !modalOpen(), () => world.step(), world.speed);
    renderer.draw(world, now, ui.currentLanguage);
    if (now - lastUI > 150) { updateUI(); lastUI = now; }
  } else clock.reset();
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
  else { world = new World(seed(), registry); ui.saved('Автосохранение каждые 5 с'); }
  // Held mouse and touch gestures do not survive a page reload.
  for (const tool of registry.tools.values()) tool.release?.(world);
  ui.setLoadingProgress(3, 4);
  await paintLoading();
  showWorld(4);
  void autoSave();
}
void loadWorld().catch(() => ui.loadingFailed());
