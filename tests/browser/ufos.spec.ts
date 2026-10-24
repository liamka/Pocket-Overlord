import { expect, test } from '@playwright/test';
import { flatWorld } from '../helpers';
import { Terrain, type WorldSnapshot } from '../../src/core/types';
import { UFO_ID } from '../../src/content/ufos';

test.beforeEach(async ({ page }) => { await page.routeWebSocket('**', socket => socket.close()); });

test('the saucer animates through charge, beam and departure, freezes on pause and restores its exact pose', async ({ page }) => {
  await page.route('**/ufo-render-fixture', route => route.fulfill({ contentType: 'text/html', body: '<canvas width="320" height="240"></canvas>' }));
  await page.goto('/ufo-render-fixture');
  const result = await page.evaluate(async () => {
    const worldPath = '/src/core/world.ts', renderPath = '/src/render/ufos.ts', savePath = '/src/persistence/schema.ts';
    const [{ World }, { drawUfo, drawUfoGround }, { decodeSave }] = await Promise.all([import(worldPath), import(renderPath), import(savePath)]);
    const source = new World(12345), data = source.snapshot();
    data.entities = []; data.nextEntityId = 1;
    data.terrain = { width: 48, height: 48, tiles: Array(48 * 48).fill(3), moisture: Array(48 * 48).fill(0), recovery: [] };
    const world = new World(12345, source.registry, data), saucer = world.spawn('core:ufo', { x: 20, y: 22 });
    world.spawn('core:house', { x: 20, y: 22 });
    const canvas = document.querySelector('canvas')!, ctx = canvas.getContext('2d')!;
    const paint = (e: typeof saucer): string => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawUfoGround(ctx, e.components.position, e.components.ufo);
      drawUfo(ctx, e.components.position, e.components.ufo);
      return canvas.toDataURL();
    };
    const frames = new Set<string>(), phases = new Set<string>();
    let frozen = true, restored = true, unchanged = true, greenAtImpact = false;
    for (let i = 0; i < 90; i++) {
      world.step(); const state = saucer.components.ufo;
      phases.add(state.phase); frames.add(paint(saucer));
      if (i === 8 || i === 27 || i === 57 || i === 82) {
        world.paused = true; const saved = JSON.stringify(world.snapshot()), before = paint(saucer);
        for (let n = 0; n < 5; n++) world.step();
        frozen &&= paint(saucer) === before;
        unchanged &&= saved === JSON.stringify(world.snapshot());
        const loaded = new World(world.seed, world.registry, decodeSave(JSON.parse(saved), world.registry));
        restored &&= paint(loaded.entities.get(saucer.id)) === before;
        world.paused = false;
      }
      if (state.phase === 'beam' && state.phaseTime > 0.3 && state.phaseTime < 0.5) {
        const [r, g, b, a] = ctx.getImageData(160, 174, 1, 1).data;
        greenAtImpact ||= g > r && g > b && a > 150;
      }
    }
    return { frames: frames.size, phases: [...phases].sort(), frozen, restored, unchanged, greenAtImpact };
  });
  expect(result.frames).toBeGreaterThan(60);
  expect(result.phases).toEqual(['beam', 'charge', 'cruise', 'recover']);
  expect(result).toMatchObject({ frozen: true, restored: true, unchanged: true, greenAtImpact: true });
});

test('the real toolbar summons an off-screen saucer and preserves its arrival and the selected tool on reload', async ({ page }) => {
  const world = flatWorld(); world.paused = true; world.terrain.set(24, 24, Terrain.DeepWater);
  await page.route('**/ufo-storage-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Storage setup</title>' }));
  await page.goto('/ufo-storage-fixture');
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
  await page.locator('[data-category="destruction"]').click();
  const button = page.getByRole('button', { name: 'Flying saucer', exact: true });
  await expect(button).toBeVisible(); await button.click();
  await expect(page.locator('#tool-name')).toHaveText('Flying saucer');
  const point = await page.locator('#world').evaluate(canvas => ({ x: canvas.clientWidth / 2, y: (canvas.clientHeight - 200) / 2 }));
  await page.locator('#world').hover({ position: point });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const before = await page.locator('#world').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.locator('#world').click({ position: point });
  const readSave = () => page.evaluate(() => new Promise<WorldSnapshot>((resolve, reject) => {
    const open = indexedDB.open('little-world', 1); open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, request = db.transaction('worlds').objectStore('worlds').get('last');
      request.onsuccess = () => { db.close(); resolve(request.result); }; request.onerror = () => reject(request.error);
    };
  }));
  await expect.poll(async () => (await readSave()).entities.filter(e => e.typeId === UFO_ID).length).toBe(1);
  const saved = await readSave(), saucer = saved.entities.find(e => e.typeId === UFO_ID)!;
  expect(saucer.components.ufo!.goalX).toBeCloseTo(24, 1);
  expect(saucer.components.ufo!.goalY).toBeCloseTo(24, 1); expect(saved.paused).toBe(true);
  expect(saucer.components.ufo!.arrival).toMatchObject({ elapsed: 0 });
  expect(await page.locator('#world').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).toBe(before);
  await page.reload(); await expect(page.locator('#loading-screen')).toBeHidden();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-category="destruction"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#time-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await readSave()).entities.find(e => e.typeId === UFO_ID)).toEqual(saucer);
  await page.locator('#time-toggle').click();
  await expect.poll(async () => (await readSave()).entities.find(e => e.typeId === UFO_ID)?.components.ufo?.arrival).toBeUndefined();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#language-select').selectOption('ru');
  await expect(page.getByRole('button', { name: 'Летающая тарелка', exact: true })).toBeAttached();
});
