import { expect, test, type Page } from '@playwright/test';
import { flatWorld } from '../helpers';
import { Terrain, type WorldSnapshot } from '../../src/core/types';
import { KAIJU_ID } from '../../src/content/kaiju';

test.beforeEach(async ({ page }) => { await page.routeWebSocket('**', socket => socket.close()); });

const readSave = (page: Page) => page.evaluate(() => new Promise<WorldSnapshot>((resolve, reject) => {
  const open = indexedDB.open('little-world', 1);
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result, request = db.transaction('worlds').objectStore('worlds').get('last');
    request.onsuccess = () => { db.close(); resolve(request.result); }; request.onerror = () => reject(request.error);
  };
}));

test('kaiju legs, tail, jaw and atomic breath animate and freeze across pause and reload', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/kaiju-render-fixture', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0"><canvas style="width:1100px;height:800px"></canvas></body>' }));
  await page.goto('/kaiju-render-fixture');
  const result = await page.evaluate(async () => {
    const worldPath = '/src/core/world.ts', rendererPath = '/src/render/renderer.ts', savePath = '/src/persistence/schema.ts';
    const [{ World }, { Renderer }, { decodeSave }] = await Promise.all([import(worldPath), import(rendererPath), import(savePath)]);
    const source = new World(12345), data = source.snapshot(); data.entities = []; data.nextEntityId = 1;
    data.terrain = { width: 64, height: 64, tiles: Array(64 * 64).fill(3), moisture: Array(64 * 64).fill(0), recovery: [] };
    let world = new World(12345, source.registry, data);
    const titan = world.spawn('core:kaiju', { x: 32, y: 40 });
    Object.assign(titan.components.kaiju, { heading: Math.PI * 1.5, aimX: 32, aimY: 12, goalX: 32, goalY: 12 });
    world.command({ kind: 'control-tool', toolId: 'core:kaiju', x: 0, y: -0.5, active: true, attacking: true });
    for (const [x, y] of [[20, 16], [32, 16], [44, 16], [10, 35], [52, 40]]) world.spawn('core:house', { x, y });
    const canvas = document.querySelector('canvas')!, renderer = new Renderer(canvas);
    renderer.resize(); renderer.camera.fit(64, 64);
    const draw = () => { world.visuals.splice(0); renderer.draw(world, 1000); return canvas.toDataURL(); };
    const idle = draw();
    for (let i = 0; i < 8; i++) world.step(); const charging = draw();
    for (let i = 0; i < 20; i++) world.step(); const beam = draw();
    const phase = titan.components.kaiju.phase;
    world.paused = true; const saved = JSON.stringify(world.snapshot());
    renderer.draw(world, 9000); const frozen = canvas.toDataURL() === beam;
    const unchanged = JSON.stringify(world.snapshot()) === saved;
    world = new World(12345, source.registry, decodeSave(JSON.parse(saved), source.registry));
    const reloaded = draw() === beam;
    return { phases: new Set([idle, charging, beam]).size, phase, frozen, unchanged, reloaded };
  });
  expect(result).toEqual({ phases: 3, phase: 'beam', frozen: true, unchanged: true, reloaded: true });
  await page.locator('canvas').screenshot({ path: testInfo.outputPath('kaiju-beams.png') });
  expect(errors).toEqual([]);
});

test('real toolbar summons the kaiju, keyboard moves it, mouse fires and reload keeps it', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const world = flatWorld(); world.paused = true;
  world.terrain.set(24, 24, Terrain.DeepWater);
  const target = world.spawn('core:house', { x: 40, y: 24 })!;
  await page.route('**/kaiju-storage-fixture', route => route.fulfill({ contentType: 'text/html', body: '<title>Storage setup</title>' }));
  await page.goto('/kaiju-storage-fixture');
  await page.evaluate(snapshotJSON => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('little-world', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('worlds');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('worlds', 'readwrite');
      tx.objectStore('worlds').put(JSON.parse(snapshotJSON), 'last');
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  }), JSON.stringify(world.snapshot()));
  await page.goto('/'); await expect(page.locator('#loading-screen')).toBeHidden();
  await page.getByRole('button', { name: 'Destruction', exact: true }).click();
  await page.getByRole('button', { name: 'Giant Kaiju', exact: true }).click();
  await expect(page.locator('#tool-hint')).toContainText('WASD');
  const center = await page.locator('#world').evaluate(canvas => ({ x: canvas.clientWidth / 2, y: (canvas.clientHeight - 200) / 2 }));
  await page.mouse.click(center.x, center.y);
  await expect.poll(async () => (await readSave(page)).entities.filter(e => e.typeId === KAIJU_ID).length).toBe(1);
  await page.keyboard.press('2'); await page.keyboard.down('KeyD');
  await page.waitForTimeout(650);
  await page.keyboard.up('KeyD'); await page.keyboard.press('1');
  await expect.poll(async () => (await readSave(page)).entities.find(e => e.typeId === KAIJU_ID)?.components.position?.x).toBeGreaterThan(26);
  await expect.poll(async () => (await readSave(page)).paused).toBe(true);
  const moved = (await readSave(page)).entities.find(e => e.typeId === KAIJU_ID)!;
  expect(moved.components.position!.x).toBeGreaterThan(26);
  expect(moved.components.position!.x).toBeLessThan(30);
  expect((await readSave(page)).entities.some(e => e.id === target.id)).toBe(true);
  // Use the same camera calculation as the app to aim at the surviving house.
  const aim = await page.locator('#world').evaluate(async canvas => {
    const path = '/src/render/camera.ts', { Camera } = await import(path);
    const camera = new Camera(); camera.width = canvas.clientWidth; camera.height = canvas.clientHeight; camera.fit(48, 48);
    return camera.worldToScreen(40, 24);
  });
  await page.mouse.move(aim.x, aim.y); await page.mouse.down(); await page.keyboard.press('2');
  // Speed shortcuts release pointer capture, so begin a fresh firing hold after unpausing.
  await page.mouse.up(); await page.mouse.down();
  await expect.poll(async () => (await readSave(page)).entities.some(e => e.id === target.id), { timeout: 15000 }).toBe(false);
  await page.mouse.up(); await page.keyboard.press('1');
  await expect.poll(async () => (await readSave(page)).paused).toBe(true);
  const saved = (await readSave(page)).entities.find(e => e.typeId === KAIJU_ID)!;
  expect((await readSave(page)).entities.filter(e => e.typeId === KAIJU_ID)).toHaveLength(1);
  await page.screenshot({ path: testInfo.outputPath('kaiju-in-game.png') });
  await page.reload(); await expect(page.locator('#loading-screen')).toBeHidden();
  await expect.poll(async () => (await readSave(page)).entities.find(e => e.typeId === KAIJU_ID)).toEqual(saved);
  await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.locator('#language-select').selectOption('ru');
  await expect(page.locator('[data-tool="core:kaiju"]')).toHaveAttribute('aria-label', 'Большой кайдзю');
  expect(errors).toEqual([]);
});
