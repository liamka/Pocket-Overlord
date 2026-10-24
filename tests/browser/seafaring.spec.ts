import { expect, test } from '@playwright/test';
import { flatWorld } from '../helpers';
import { Terrain, type WorldSnapshot } from '../../src/core/types';

test.beforeEach(async ({ page }) => { await page.routeWebSocket('**', socket => socket.close()); });

test('sails billow and reef, hulls face eight directions and harbor flags animate', async ({ page }) => {
  await page.route('**/seafaring-pose-fixture', route => route.fulfill({ contentType: 'text/html', body: '<canvas width="128" height="128"></canvas>' }));
  await page.goto('/seafaring-pose-fixture');
  const result = await page.evaluate(async () => {
    const path = '/src/render/seafaring.ts';
    const { drawShipSprite, drawHarborSprite } = await import(path);
    const canvas = document.querySelector('canvas')!, ctx = canvas.getContext('2d')!;
    const clear = () => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, 128, 128); ctx.translate(64, 75); };
    const directions = new Set<string>(), poses = new Set<string>(), flags = new Set<string>();
    const sailPixels = () => {
      const data = ctx.getImageData(0, 0, 128, 128).data; let count = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] > 180 && data[i + 1] > 180 && data[i + 2] > 165 && data[i + 3] === 255) count++;
      return count;
    };
    const upright = [];
    for (let i = 0; i < 8; i++) {
      clear(); drawShipSprite(ctx, 0.3, i * Math.PI / 4, 'trade'); directions.add(canvas.toDataURL());
      const data = ctx.getImageData(0, 0, 128, 128).data; let top = 128;
      for (let n = 0; n < data.length; n += 4) if (data[n + 3]) top = Math.min(top, Math.floor(n / 4 / 128));
      upright.push(top < 52);
    }
    for (let i = 0; i < 20; i++) {
      clear(); drawShipSprite(ctx, i / 10, 0, 'trade'); poses.add(canvas.toDataURL());
      clear(); drawHarborSprite(ctx, i / 10); flags.add(canvas.toDataURL());
    }
    clear(); drawShipSprite(ctx, 0.2, 0, 'trade', 1, 0); const full = sailPixels();
    clear(); drawShipSprite(ctx, 0.2, 0, 'trade', 0, 0); const furled = sailPixels();
    return { directions: directions.size, poses: poses.size, flags: flags.size, upright, full, furled };
  });
  expect(result.directions).toBe(8); expect(result.poses).toBeGreaterThan(15); expect(result.flags).toBeGreaterThan(10);
  expect(result.upright).toEqual(Array(8).fill(true)); expect(result.full).toBeGreaterThan(result.furled * 3);
});

test('the real renderer animates voyages and wakes, freezes on pause and restores the same frame', async ({ page }) => {
  await page.route('**/seafaring-render-fixture', route => route.fulfill({ contentType: 'text/html', body: '<canvas style="width:900px;height:700px"></canvas>' }));
  await page.goto('/seafaring-render-fixture');
  const result = await page.evaluate(async () => {
    const paths = ['/src/core/world.ts', '/src/render/renderer.ts', '/src/systems/seafaring.ts', '/src/persistence/schema.ts'];
    const [{ World }, { Renderer }, { buildHarbor }, { decodeSave }] = await Promise.all(paths.map(path => import(path)));
    const source = new World(12345), data = source.snapshot();
    data.entities = []; data.nextEntityId = 1;
    data.terrain = { width: 48, height: 48, tiles: Array.from({ length: 48 * 48 }, (_, i) => i % 48 < 9 ? 3 : 1), moisture: Array(48 * 48).fill(0), recovery: [] };
    let world = new World(12345, source.registry, data);
    const port = buildHarbor(world, { x: 8.5, y: 24.5 }); port.components.harbor.built = 1;
    const canvas = document.querySelector('canvas')!, renderer = new Renderer(canvas);
    renderer.resize(); renderer.camera.fit(48, 48); renderer.draw(world, 0); const start = canvas.toDataURL();
    for (let i = 0; i < 240; i++) { world.step(); renderer.draw(world, (i + 1) * 1000 / 30); }
    renderer.draw(world, 8000); const voyage = canvas.toDataURL();
    const ship = [...world.query('ship')][0];
    world.paused = true; const saved = JSON.stringify(world.snapshot());
    renderer.draw(world, 16000); const frozen = canvas.toDataURL() === voyage;
    const unchanged = JSON.stringify(world.snapshot()) === saved;
    world = new World(12345, source.registry, decodeSave(JSON.parse(saved), source.registry));
    renderer.draw(world, 17000); const reloaded = canvas.toDataURL() === voyage;
    world.paused = false; for (let i = 0; i < 10; i++) world.step();
    renderer.draw(world, 17333); const resumed = canvas.toDataURL() !== voyage;
    return { animated: start !== voyage, frozen, unchanged, reloaded, resumed, moving: ship.components.ship.speed > 0, wake: ship.components.ship.wake.length > 2 };
  });
  expect(result).toEqual({ animated: true, frozen: true, unchanged: true, reloaded: true, resumed: true, moving: true, wake: true });
});

test('harbor and ship tools work through the real UI and survive saving and reload', async ({ page }) => {
  const world = flatWorld(); world.paused = true;
  for (let y = 0; y < 48; y++) for (let x = 24; x < 48; x++) world.terrain.set(x, y, Terrain.Water);
  await page.route('**/seafaring-storage-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Storage setup</title>' }));
  await page.goto('/seafaring-storage-fixture');
  await page.evaluate(snapshot => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('little-world', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('worlds');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('worlds', 'readwrite');
      tx.objectStore('worlds').put(JSON.parse(snapshot), 'last');
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  }), JSON.stringify(world.snapshot()));
  await page.goto('/'); await expect(page.locator('#loading-screen')).toBeHidden();
  const screenPoint = async (point: { x: number; y: number }) => page.locator('#world').evaluate(async (canvas, p) => {
    const path = '/src/render/camera.ts'; const { Camera } = await import(path);
    const camera = new Camera(); camera.width = canvas.clientWidth; camera.height = canvas.clientHeight; camera.fit(48, 48);
    return camera.worldToScreen(p.x, p.y);
  }, point);
  await page.locator('[data-category="people"]').click();
  await page.getByRole('button', { name: 'Harbor', exact: true }).click();
  await page.locator('#world').click({ position: await screenPoint({ x: 23.5, y: 24.5 }) });
  await page.getByRole('button', { name: 'Ship', exact: true }).click();
  await page.locator('#world').click({ position: await screenPoint({ x: 34, y: 24 }) });
  const readSave = () => page.evaluate(() => new Promise<WorldSnapshot>((resolve, reject) => {
    const open = indexedDB.open('little-world', 1); open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, request = db.transaction('worlds').objectStore('worlds').get('last');
      request.onsuccess = () => { db.close(); resolve(request.result); }; request.onerror = () => reject(request.error);
    };
  }));
  await expect.poll(async () => (await readSave()).entities.filter(e => e.components.ship || e.components.harbor).length).toBe(2);
  const saved = await readSave();
  expect(saved.entities.find(e => e.components.harbor)!.components.position).toEqual({ x: 23.5, y: 24.5 });
  expect(saved.entities.find(e => e.components.ship)!.components.position!.x).toBeCloseTo(34, 1);
  await page.reload(); await expect(page.locator('#loading-screen')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Ship', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await readSave()).entities).toEqual(saved.entities);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#language-select').selectOption('ru');
  await expect(page.getByRole('button', { name: 'Гавань', exact: true })).toBeAttached();
  await expect(page.getByRole('button', { name: 'Корабль', exact: true })).toBeAttached();
});
