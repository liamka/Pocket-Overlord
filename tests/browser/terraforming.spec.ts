import { expect, test, type Page } from '@playwright/test';
import { Terrain, type WorldSnapshot } from '../../src/core/types';
import { Camera } from '../../src/render/camera';
import { languages, translate } from '../../src/i18n';
import { flatWorld } from '../helpers';

async function readSave(page: Page): Promise<WorldSnapshot> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('little-world', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, read = db.transaction('worlds').objectStore('worlds').get('last');
      read.onsuccess = () => { db.close(); resolve(read.result); }; read.onerror = () => reject(read.error);
    };
  }));
}

async function installWorld(page: Page, snapshot: WorldSnapshot): Promise<void> {
  await page.routeWebSocket('**', socket => socket.close());
  await page.route('**/land-storage-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Land tool setup</title>' }));
  await page.goto('/land-storage-fixture');
  await page.evaluate(serialized => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('little-world', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('worlds');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('worlds', 'readwrite');
      tx.objectStore('worlds').put(JSON.parse(serialized), 'last');
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  }), JSON.stringify(snapshot));
  await page.goto('/'); await expect(page.locator('#loading-screen')).toBeHidden();
}

test('land brushes paint while paused, keep right-drag for panning and restore their coastlines', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const world = flatWorld(); world.paused = true;
  for (let y = 0; y < 48; y++) for (let x = 0; x < 24; x++) world.terrain.set(x, y, Terrain.DeepWater);
  await installWorld(page, world.snapshot());
  const camera = new Camera(); camera.width = 1440; camera.height = 960; camera.fit(48, 48);
  await page.locator('[data-category="biomes"]').click();
  for (const [mode, start, end] of [['raise', 10, 18], ['lower', 29, 37]] as const) {
    await page.locator(`[data-tool="core:${mode}-land"]`).click();
    await expect(page.locator('.camera-hint')).toContainText('Left-drag: shape land');
    const a = camera.worldToScreen(start, 24), b = camera.worldToScreen(end, 24);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 16 }); await page.mouse.up();
  }
  await expect.poll(async () => (await readSave(page)).terrain.tiles[24 * 48 + 37]).toBe(Terrain.Water);
  const saved = await readSave(page);
  for (let x = 10; x <= 18; x++) expect(saved.terrain.tiles[24 * 48 + x]).toBeGreaterThanOrEqual(Terrain.Sand);
  for (let x = 29; x <= 37; x++) expect(saved.terrain.tiles[24 * 48 + x]).toBe(Terrain.Water);
  expect(saved.terrain.tiles[4 * 48 + 4]).toBe(Terrain.DeepWater);
  expect(saved.terrain.tiles[4 * 48 + 40]).toBe(Terrain.Grass); expect(saved.tick).toBe(0);
  const center = camera.worldToScreen(24, 24);
  await page.mouse.move(center.x, center.y); await page.mouse.down({ button: 'right' });
  await page.mouse.move(center.x + 90, center.y, { steps: 10 }); await page.mouse.up({ button: 'right' });
  // Saving after another action verifies that panning did not paint an extra stroke.
  await page.locator('#settings').click(); await page.locator('#settings-dialog button[value="done"]').click();
  await page.reload(); await expect(page.locator('#loading-screen')).toBeHidden();
  expect((await readSave(page)).terrain).toEqual(saved.terrain);
  expect(errors).toEqual([]);
});

test('land tools have distinct icons, all translations and remain accessible at desktop widths', async ({ page }) => {
  const world = flatWorld(); world.paused = true;
  await installWorld(page, world.snapshot());
  const icons = await page.locator('[data-tool="core:raise-land"] canvas, [data-tool="core:lower-land"] canvas')
    .evaluateAll(canvases => canvases.map(canvas => (canvas as HTMLCanvasElement).toDataURL()));
  expect(new Set(icons).size).toBe(2);
  for (const language of languages) {
    await page.locator('#settings').click(); await page.locator('#language-select').selectOption(language.id);
    await page.locator('#settings-dialog button[value="done"]').click();
    await page.locator('[data-category="biomes"]').click();
    for (const label of ['Raise land', 'Lower land']) {
      const localized = translate(label, language.id);
      await page.getByRole('button', { name: localized, exact: true }).click();
      await expect(page.locator('#tool-name')).toHaveText(localized);
    }
  }
  for (const width of [1440, 1024, 900]) {
    await page.setViewportSize({ width, height: 700 });
    for (const mode of ['raise', 'lower']) {
      const button = page.locator(`[data-tool="core:${mode}-land"]`);
      await expect(button).toBeInViewport(); await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
    }
  }
});

test('earth rises and sinks in stages while paused, settles to the saved terrain and clears reversed strokes', async ({ page }) => {
  await page.routeWebSocket('**', socket => socket.close());
  await page.route('**/land-render-fixture', route => route.fulfill({ contentType: 'text/html', body: '<canvas style="width:960px;height:640px"></canvas>' }));
  await page.goto('/land-render-fixture');
  const result = await page.evaluate(async () => {
    const [{ flatWorld }, { Renderer }, { World }] = await Promise.all(['/tests/helpers.ts', '/src/render/renderer.ts', '/src/core/world.ts'].map(path => import(path)));
    const world = flatWorld(); world.paused = true;
    for (let y = 0; y < 48; y++) for (let x = 0; x < 24; x++) world.terrain.set(x, y, 0);
    const canvas = document.querySelector('canvas')!, renderer = new Renderer(canvas);
    renderer.resize(); renderer.camera.x = 24; renderer.camera.y = 24; renderer.camera.zoom = 2;
    let now = 1000;
    const draw = () => { renderer.draw(world, now += 1000 / 30); return canvas.toDataURL(); };
    const original = draw();
    world.command({ kind: 'use-tool', toolId: 'core:raise-land', x: 14, y: 24 });
    world.command({ kind: 'use-tool', toolId: 'core:lower-land', x: 33, y: 24 });
    const snapshot = JSON.stringify(world.snapshot()), first = draw(), frames: string[] = [];
    for (let i = 0; i < 80; i++) { const frame = draw(); if (i % 8 === 0) frames.push(frame); }
    const settled = draw(), savedUnchanged = JSON.stringify(world.snapshot()) === snapshot;
    renderer.draw(new World(world.seed, world.registry, JSON.parse(snapshot)), now += 33);
    const restored = canvas.toDataURL() === settled;
    renderer.draw(world, now += 33);
    world.command({ kind: 'use-tool', toolId: 'core:lower-land', x: 14, y: 24 }); draw();
    for (let i = 0; i < 8; i++) draw();
    world.command({ kind: 'use-tool', toolId: 'core:raise-land', x: 14, y: 24 }); draw();
    for (let i = 0; i < 80; i++) draw();
    const reversed = draw();
    renderer.draw(new World(world.seed, world.registry, world.snapshot()), now += 33);
    const noGhosts = reversed === canvas.toDataURL();
    renderer.draw(world, now += 33);
    world.command({ kind: 'use-tool', toolId: 'core:lower-land', x: 14, y: 24 }); draw();
    const empty = flatWorld(); empty.paused = true;
    renderer.draw(empty, now += 33); const reset = canvas.toDataURL();
    renderer.draw(new World(empty.seed, empty.registry, empty.snapshot()), now += 33);
    return { beginsInMotion: first !== settled, phases: new Set(frames).size, changed: settled !== original,
      savedUnchanged, restored, noGhosts, resets: reset === canvas.toDataURL(), paused: world.paused, tick: world.tick };
  });
  expect(result.phases).toBeGreaterThanOrEqual(6);
  expect(result).toMatchObject({ beginsInMotion: true, changed: true, savedUnchanged: true, restored: true, noGhosts: true, resets: true, paused: true, tick: 0 });
});
