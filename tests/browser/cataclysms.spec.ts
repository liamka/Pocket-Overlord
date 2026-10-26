import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { flatWorld } from '../helpers';
import { CATACLYSMS, TORNADO, GRAVITY, type CataclysmState } from '../../src/core/cataclysms';
import type { WorldSnapshot } from '../../src/core/types';

test.beforeEach(async ({ page }) => { await page.routeWebSocket('**', socket => socket.close()); });

for (const id of [TORNADO.id, GRAVITY.id]) {
  test(`${id} has distinct animated phases, freezes exactly, and restores its saved pose`, async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/cataclysm-render-fixture', route => route.fulfill({ contentType: 'text/html', body: '<canvas style="width:1000px;height:700px"></canvas>' }));
    await page.goto('/cataclysm-render-fixture');
    const result = await page.evaluate(async ({ id, life }) => {
      const paths = ['/src/core/world.ts', '/src/render/renderer.ts', '/src/persistence/schema.ts'];
      const [{ World }, { Renderer }, { decodeSave }] = await Promise.all(paths.map(path => import(path)));
      const source = new World(12345), data = source.snapshot(); data.entities = []; data.nextEntityId = 1;
      data.terrain = { width: 48, height: 48, tiles: Array(48 * 48).fill(3), moisture: Array(48 * 48).fill(0), recovery: [] };
      let world = new World(12345, source.registry, data);
      for (let i = 0; i < 18; i++) {
        const a = i * Math.PI * 2 / 18, e = world.spawn('core:person', { x: 24 + Math.cos(a) * 6, y: 24 + Math.sin(a) * 6 });
        e.components.person.buildIn = e.components.person.reproduceIn = 10000;
      }
      const canvas = document.querySelector('canvas')!, renderer = new Renderer(canvas), ctx = canvas.getContext('2d')!;
      renderer.resize(); renderer.camera.x = 24; renderer.camera.y = 20; renderer.camera.zoom = 2.4;
      renderer.draw(world, 0); const empty = canvas.toDataURL();
      world.command({ kind: 'use-tool', toolId: id, x: 24, y: 24 });
      let now = 0;
      const frames: { phase: string; png: string }[] = [];
      const advance = (ticks: number) => { for (let n = 0; n < ticks; n++) { world.step(); now += 1000 / 30; renderer.draw(world, now); } };
      advance(15); frames.push({ phase: 'forming', png: canvas.toDataURL() });
      advance(24); frames.push({ phase: 'active', png: canvas.toDataURL() });
      world.paused = true; const saved = JSON.stringify(world.snapshot());
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const same = () => ctx.getImageData(0, 0, canvas.width, canvas.height).data.every((v, i) => Math.abs(v - pixels[i]) <= 2);
      renderer.draw(world, now + 5000); const frozen = same();
      const readOnly = saved === JSON.stringify(world.snapshot());
      world = new World(world.seed, source.registry, decodeSave(JSON.parse(saved), source.registry));
      renderer.draw(world, now + 6000); const restored = same();
      world.paused = false; now += 6000;
      advance(id === 'core:gravity-clap' ? 30 : 55); frames.push({ phase: 'impact', png: canvas.toDataURL() });
      advance(id === 'core:gravity-clap' ? 12 : Math.ceil((life + 0.8) * 30) - 94); frames.push({ phase: 'aftermath', png: canvas.toDataURL() });
      const timings = [];
      for (let i = 0; i < 20; i++) { const start = performance.now(); renderer.draw(world, now); timings.push(performance.now() - start); }
      return { frames, frozen, readOnly, restored, changed: new Set([empty, ...frames.map(f => f.png)]).size,
        population: world.population, frameMs: timings.reduce((a, b) => a + b, 0) / timings.length };
    }, { id, life: TORNADO.life });
    expect(result).toMatchObject({ frozen: true, readOnly: true, restored: true, changed: 5, population: 0 });
    expect(errors).toEqual([]);
    for (const frame of result.frames) await writeFile(info.outputPath(`${frame.phase}.png`), Buffer.from(frame.png.split(',')[1], 'base64'));
    console.log(`${id}: ${result.frameMs.toFixed(1)} ms per rendered frame`);
  });
}

test('a toolbar click starts an autonomous tornado that survives mouse release, tool changes and loading', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const world = flatWorld(); world.paused = true;
  for (const x of [14, 34]) for (let i = 0; i < 12; i++) {
    const a = i * Math.PI * 2 / 12;
    const e = world.spawn('core:person', { x: x + Math.cos(a) * 3, y: 24 + Math.sin(a) * 3 })!;
    e.components.person!.buildIn = e.components.person!.reproduceIn = 10000;
  }
  await page.route('**/cataclysm-storage-fixture', route => route.fulfill({ contentType: 'text/html', body: '<title>Save setup</title>' }));
  await page.goto('/cataclysm-storage-fixture');
  await page.evaluate(json => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('little-world', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('worlds'); open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('worlds', 'readwrite'); tx.objectStore('worlds').put(JSON.parse(json), 'last');
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  }), JSON.stringify(world.snapshot()));
  await page.goto('/'); await expect(page.locator('#loading-screen')).toBeHidden();
  const canvas = page.locator('#world'), box = (await canvas.boundingBox())!;
  const points = await canvas.evaluate(async canvas => {
    const path = '/src/render/camera.ts', { Camera } = await import(path);
    const camera = new Camera(); camera.width = canvas.clientWidth; camera.height = canvas.clientHeight; camera.fit(48, 48);
    return [camera.worldToScreen(14, 24), camera.worldToScreen(18, 24), camera.worldToScreen(34, 24)];
  });
  const readSave = () => page.evaluate(() => new Promise<WorldSnapshot>((resolve, reject) => {
    const open = indexedDB.open('little-world', 1); open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, request = db.transaction('worlds').objectStore('worlds').get('last');
      request.onsuccess = () => { db.close(); resolve(request.result); }; request.onerror = () => reject(request.error);
    };
  }));
  const state = (s: WorldSnapshot) => s.scenarios.find(s => s.id === CATACLYSMS.id)?.state as CataclysmState | undefined;
  await page.locator('[data-category="destruction"]').click();
  await page.getByRole('button', { name: 'Blood tornado', exact: true }).click();
  await expect(page.locator('#tool-hint')).toContainText('roams on its own');
  await page.mouse.click(box.x + points[0].x, box.y + points[0].y);
  await page.keyboard.press('Space');
  await page.mouse.move(box.x + points[1].x, box.y + points[1].y, { steps: 10 });
  await expect.poll(async () => {
    const t = state(await readSave())?.tornadoes[0];
    return t ? Math.hypot(t.x - 14, t.y - 24) : 0;
  }).toBeGreaterThan(1);
  expect(state(await readSave())?.tornadoes[0]?.released).toBeNull();
  await page.getByRole('button', { name: 'Gravity clap', exact: true }).click();
  await expect(page.locator('#tool-hint')).toContainText('single point');
  await page.mouse.click(box.x + points[2].x, box.y + points[2].y);
  await expect.poll(async () => (await readSave()).entities.filter(e => e.components.person).length, { timeout: 15000 }).toBe(0);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await readSave()).paused).toBe(true);
  const tornadoes = state(await readSave())!.tornadoes;
  expect(tornadoes).toHaveLength(1); expect(tornadoes[0].released).toBeNull();
  await page.reload(); await expect(page.locator('#loading-screen')).toBeHidden();
  expect(state(await readSave())!.tornadoes).toEqual(tornadoes);
  expect((await readSave()).entities.filter(e => e.components.person)).toHaveLength(0);
  await page.locator('#speed-picker').click(); await page.locator('[data-speed="4"]').click();
  await expect.poll(async () => state(await readSave())?.tornadoes.length, { timeout: 15000 }).toBe(0);
  expect(errors).toEqual([]);
});
