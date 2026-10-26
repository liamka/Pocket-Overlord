import { expect, test } from '@playwright/test';
import { Terrain, type WorldSnapshot } from '../../src/core/types';
import { Camera } from '../../src/render/camera';
import { flatWorld } from '../helpers';

for (const id of ['core:rocket', 'core:tsar-bomba']) {
  test(`${id} sends visible sea waves towards the coast and preserves them across pause and reload`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/sea-wave-fixture', route => route.fulfill({ contentType: 'text/html', body: '<canvas style="width:1000px;height:700px"></canvas>' }));
    await page.goto('/sea-wave-fixture');
    const result = await page.evaluate(async id => {
      const worldPath = '/src/core/world.ts', rendererPath = '/src/render/renderer.ts', schemaPath = '/src/persistence/schema.ts';
      const [{ World }, { Renderer }, { decodeSave }] = await Promise.all([import(worldPath), import(rendererPath), import(schemaPath)]);
      const source = new World(4831), data = source.snapshot(); data.entities = []; data.nextEntityId = 1;
      data.terrain = { width: 128, height: 128, tiles: Array.from({ length: 16384 }, (_, i) => i % 128 < 90 ? 1 : 3), moisture: Array(16384).fill(0), recovery: [] };
      let world = new World(4831, source.registry, data);
      const canvas = document.querySelector('canvas')!, ctx = canvas.getContext('2d')!, renderer = new Renderer(canvas);
      renderer.resize(); renderer.camera.x = 64; renderer.camera.y = 64; renderer.camera.zoom = 0.7;
      world.paused = true; renderer.draw(world, 1000); const empty = canvas.toDataURL();
      world.command({ kind: 'use-tool', toolId: id, x: id === 'core:rocket' ? 80 : 20, y: 64 }); world.paused = false;
      for (let tick = 0; tick < (id === 'core:rocket' ? 105 : 189); tick++) { world.step(); renderer.draw(world, 1100 + tick * 1000 / 30); }
      world.paused = true;
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      // Chromium can round a few antialiased foam pixels differently on a repeated draw.
      const sameFrame = () => ctx.getImageData(0, 0, canvas.width, canvas.height).data.every((value, i) => Math.abs(value - pixels[i]) <= 2);
      const saved = JSON.stringify(world.snapshot()); renderer.draw(world, 10000); const frozen = sameFrame();
      const preserved = saved === JSON.stringify(world.snapshot());
      world = new World(4831, source.registry, decodeSave(JSON.parse(saved), source.registry)); renderer.draw(world, 11000);
      const reloaded = sameFrame();
      const noWaves = world.snapshot(); noWaves.scenarios = noWaves.scenarios.filter((scenario: { id: string }) => scenario.id !== 'core:sea-waves');
      renderer.draw(new World(4831, source.registry, noWaves), 12000);
      const without = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let wavePixels = 0;
      for (let i = 0; i < pixels.length; i += 4) if (Math.abs(pixels[i] - without[i]) + Math.abs(pixels[i + 1] - without[i + 1]) + Math.abs(pixels[i + 2] - without[i + 2]) > 30) wavePixels++;
      world.paused = false;
      for (let tick = 0; tick < 30; tick++) { world.step(); renderer.draw(world, 12100 + tick * 1000 / 30); }
      const moved = !sameFrame();
      for (let tick = 0; tick < 600; tick++) world.step();
      const expired = !world.scenarios.some((scenario: { id: string }) => scenario.id === 'core:sea-waves');
      const fresh = new World(4831, source.registry, data); fresh.paused = true; renderer.draw(fresh, 15000);
      return { wavePixels, frozen, preserved, reloaded, moved, expired, reset: canvas.toDataURL() === empty };
    }, id);
    expect(result.wavePixels).toBeGreaterThan(id === 'core:rocket' ? 60 : 1000);
    expect(result).toMatchObject({ frozen: true, preserved: true, reloaded: true, moved: true, expired: true, reset: true });
    expect(errors).toEqual([]);
  });
}

test('the real Tsar Bomba tool replaces coastal land with visible water and preserves it on reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.routeWebSocket('**', socket => socket.close());
  const world = flatWorld(); world.paused = true;
  for (let y = 0; y < 48; y++) for (let x = 0; x < 20; x++) world.terrain.set(x, y, Terrain.Water);
  await page.route('**/coastal-bomb-storage', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Storage setup</title>' }));
  await page.goto('/coastal-bomb-storage');
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
  const canvas = page.locator('#world'), box = (await canvas.boundingBox())!;
  const camera = new Camera(); camera.width = box.width; camera.height = box.height; camera.fit(48, 48);
  const aim = camera.worldToScreen(24, 24), sample = camera.worldToScreen(28.5, 24.5);
  const looksWet = () => canvas.evaluate((canvas: HTMLCanvasElement, point) => {
    const ratio = canvas.width / canvas.clientWidth;
    const [, green, blue] = canvas.getContext('2d')!.getImageData(Math.floor(point.x * ratio), Math.floor(point.y * ratio), 1, 1).data;
    return blue - green > 10;
  }, sample);
  expect(await looksWet()).toBe(false);
  await page.locator('[data-category="destruction"]').click();
  await page.getByRole('button', { name: 'Tsar Bomba 100MT', exact: true }).click();
  await expect(page.locator('#tool-hint')).toContainText('Coastal craters fill with water');
  await page.mouse.click(box.x + aim.x, box.y + aim.y); await page.locator('#speed-picker').click(); await page.locator('[data-speed="4"]').click();
  const readSave = () => page.evaluate(() => new Promise<WorldSnapshot>((resolve, reject) => {
    const open = indexedDB.open('little-world', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, request = db.transaction('worlds').objectStore('worlds').get('last');
      request.onsuccess = () => { db.close(); resolve(request.result); }; request.onerror = () => reject(request.error);
    };
  }));
  await expect.poll(async () => {
    const saved = await readSave();
    return saved.terrain.tiles[24 * 48 + 28] === Terrain.Water && !saved.scenarios.some(s => s.id === 'core:tsar-bomba');
  }, { timeout: 20000 }).toBe(true);
  await page.keyboard.press('Space'); await expect.poll(looksWet).toBe(true);
  const flooded = (await readSave()).terrain.tiles.map(tile => tile < Terrain.Sand);
  expect(flooded.filter(Boolean).length).toBeGreaterThan(20 * 48);
  await page.reload(); await expect(page.locator('#loading-screen')).toBeHidden();
  await expect.poll(looksWet).toBe(true);
  expect((await readSave()).terrain.tiles.map(tile => tile < Terrain.Sand)).toEqual(flooded);
  expect(errors).toEqual([]);
});

for (const id of ['core:hammer-of-dawn', 'core:tsar-bomba']) {
  test(`${id} renders distinct phases, freezes and reloads without replaying the strike`, async ({ page }) => {
    await page.route('**/superweapon-fixture', route => route.fulfill({ contentType: 'text/html', body: '<canvas style="width:1000px;height:700px"></canvas>' }));
    await page.goto('/superweapon-fixture');
    const result = await page.evaluate(async id => {
      const worldPath = '/src/core/world.ts', rendererPath = '/src/render/renderer.ts';
      const [{ World }, { Renderer }] = await Promise.all([import(worldPath), import(rendererPath)]);
      const source = new World(4831), data = source.snapshot(); data.entities = []; data.nextEntityId = 1;
      data.terrain = { width: 128, height: 128, tiles: Array(128 * 128).fill(3), moisture: Array(128 * 128).fill(0), recovery: [] };
      let world = new World(4831, source.registry, data);
      const canvas = document.querySelector('canvas')!, renderer = new Renderer(canvas);
      renderer.resize(); renderer.camera.x = 64; renderer.camera.y = 58; renderer.camera.zoom = 1;
      world.paused = true; renderer.draw(world, 1000); const empty = canvas.toDataURL();
      world.command({ kind: 'use-tool', toolId: id, x: 64, y: 64 });
      renderer.draw(world, 1000); const charge = canvas.toDataURL();
      world.paused = false;
      for (let tick = 0; tick < 34; tick++) { world.step(); renderer.draw(world, 1100 + tick * 1000 / 30); }
      const active = canvas.toDataURL(); world.paused = true;
      const snapshot = JSON.stringify(world.snapshot());
      renderer.draw(world, 6000); const frozen = canvas.toDataURL() === active;
      renderer.draw(world, 9000); const stillFrozen = canvas.toDataURL() === active;
      const preserved = JSON.stringify(world.snapshot()) === snapshot;
      world = new World(4831, source.registry, JSON.parse(snapshot)); renderer.draw(world, 9100);
      const reloaded = canvas.toDataURL() === active;
      world.paused = false;
      for (let tick = 0; tick < (id === 'core:hammer-of-dawn' ? 220 : 60); tick++) { world.step(); renderer.draw(world, 9200 + tick * 1000 / 30); }
      const later = canvas.toDataURL(), burned = world.terrain.tiles.includes(5);
      let released = true;
      if (id === 'core:hammer-of-dawn') {
        world.command({ kind: 'release-tool', toolId: id }); renderer.draw(world, 17000);
        released = canvas.toDataURL() !== later && !world.scenarios.some((scenario: { id: string }) => scenario.id === id);
      }
      const fresh = new World(4831, source.registry, data); fresh.paused = true; renderer.draw(fresh, 13000);
      return { chargeVisible: charge !== empty, activeChanged: active !== charge, laterChanged: later !== active, frozen, stillFrozen, preserved, reloaded, burned, released, reset: canvas.toDataURL() === empty };
    }, id);
    expect(result).toEqual({ chargeVisible: true, activeChanged: true, laterChanged: true, frozen: true, stillFrozen: true, preserved: true, reloaded: true, burned: true, released: true, reset: true });
  });
}
