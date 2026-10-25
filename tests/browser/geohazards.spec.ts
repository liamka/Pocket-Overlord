import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { WorldSnapshot } from '../../src/core/types';
import { ACID, GEOHAZARDS, VOLCANO, type Geohazards } from '../../src/core/geohazards';
import { flatWorld } from '../helpers';

test.beforeEach(async ({ page }) => { await page.routeWebSocket('**', socket => socket.close()); });

for (const id of [ACID.id, VOLCANO.id]) {
  test(`${id} has animated stages that pause and restore exactly`, async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/geohazard-render-fixture', route => route.fulfill({ contentType: 'text/html', body: '<canvas style="width:1000px;height:700px"></canvas>' }));
    await page.goto('/geohazard-render-fixture');
    const result = await page.evaluate(async id => {
      const paths = ['/src/core/world.ts', '/src/render/renderer.ts', '/src/persistence/schema.ts', '/src/render/tool-icons.ts'];
      const [{ World }, { Renderer }, { decodeSave }, { paintToolIcon }] = await Promise.all(paths.map(path => import(path)));
      const source = new World(12345), data = source.snapshot(); data.entities = []; data.nextEntityId = 1;
      data.terrain = { width: 48, height: 48, tiles: Array(48 * 48).fill(3), moisture: Array(48 * 48).fill(0), recovery: [] };
      let world = new World(12345, source.registry, data);
      for (let i = 0; i < 16; i++) {
        const angle = i * Math.PI / 8, radius = id === 'core:acid' ? 3 : 9;
        world.spawn('core:tree', { x: 24 + Math.cos(angle) * radius, y: 24 + Math.sin(angle) * radius });
      }
      const canvas = document.querySelector('canvas')!, renderer = new Renderer(canvas), ctx = canvas.getContext('2d')!;
      renderer.resize(); renderer.camera.x = 24; renderer.camera.y = 21; renderer.camera.zoom = id === 'core:acid' ? 4 : 2.8;
      renderer.draw(world, 0); const empty = canvas.toDataURL();
      world.command({ kind: 'use-tool', toolId: id, x: 24, y: 24 });
      const advance = (ticks: number) => { for (let i = 0; i < ticks; i++) world.step(); renderer.draw(world, world.tick * 1000 / 30); };
      advance(18); const forming = canvas.toDataURL();
      advance(66); const active = canvas.toDataURL();
      world.paused = true; const save = JSON.stringify(world.snapshot()), pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const same = () => ctx.getImageData(0, 0, canvas.width, canvas.height).data.every((v, i) => Math.abs(v - pixels[i]) <= 2);
      renderer.draw(world, 10000); const frozen = same(), readOnly = save === JSON.stringify(world.snapshot());
      world = new World(world.seed, source.registry, decodeSave(JSON.parse(save), source.registry)); renderer.draw(world, 11000); const restored = same();
      world.paused = false; advance(90); const spreading = canvas.toDataURL();
      advance(90); const cooling = canvas.toDataURL();
      const icon = document.createElement('canvas'); icon.width = icon.height = 96;
      const customIcon = paintToolIcon(icon, id);
      const before = performance.now(); for (let i = 0; i < 20; i++) renderer.draw(world, 15000);
      return { empty, forming, active, spreading, cooling, icon: icon.toDataURL(), customIcon, frozen, readOnly, restored, frameMs: (performance.now() - before) / 20 };
    }, id);
    expect(result).toMatchObject({ customIcon: true, frozen: true, readOnly: true, restored: true });
    expect(new Set([result.empty, result.forming, result.active, result.spreading, result.cooling]).size).toBe(5); expect(errors).toEqual([]);
    for (const phase of ['forming', 'active', 'spreading', 'cooling', 'icon'] as const) await writeFile(info.outputPath(`${phase}.png`), Buffer.from(result[phase].split(',')[1], 'base64'));
    console.log(`${id}: ${result.frameMs.toFixed(1)} ms per rendered frame`);
  });
}

test('acid and volcano apply from the real toolbar, autosave and continue after reload', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const world = flatWorld(); world.paused = true; world.spawn('core:tree', { x: 14, y: 24 });
  await page.route('**/geohazard-storage-fixture', route => route.fulfill({ contentType: 'text/html', body: '<title>Save setup</title>' }));
  await page.goto('/geohazard-storage-fixture');
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
    return [camera.worldToScreen(14, 24), camera.worldToScreen(34, 24)];
  });
  const readSave = () => page.evaluate(() => new Promise<WorldSnapshot>((resolve, reject) => {
    const open = indexedDB.open('little-world', 1); open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, request = db.transaction('worlds').objectStore('worlds').get('last');
      request.onsuccess = () => { db.close(); resolve(request.result); }; request.onerror = () => reject(request.error);
    };
  }));
  const state = (save: WorldSnapshot) => save.scenarios.find(s => s.id === GEOHAZARDS.id)?.state as Geohazards | undefined;
  await page.locator('[data-category="destruction"]').click();
  for (const [i, name] of ['Acid', 'Volcano'].entries()) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('#tool-hint')).toContainText(i ? 'eruptions' : 'acid');
    await page.mouse.click(box.x + points[i].x, box.y + points[i].y);
  }
  await expect.poll(async () => state(await readSave())?.acid.length).toBe(1);
  await expect.poll(async () => (await readSave()).entities.filter(e => e.components.volcano).length).toBe(1);
  const saved = await readSave(); await page.reload(); await expect(page.locator('#loading-screen')).toBeHidden();
  expect((await readSave()).entities).toEqual(saved.entities); expect(state(await readSave())).toEqual(state(saved));
  await page.keyboard.press('2');
  await expect.poll(async () => state(await readSave())?.lava.length ?? 0).toBeGreaterThan(5);
  await expect.poll(async () => (await readSave()).entities.some(e => e.typeId === 'core:tree')).toBe(false);
  await page.keyboard.press('1'); await expect.poll(async () => (await readSave()).paused).toBe(true);
  await page.locator('[data-category="destruction"]').click(); await page.getByRole('button', { name: 'Volcano', exact: true }).click();
  await page.screenshot({ path: info.outputPath('toolbar.png') }); expect(errors).toEqual([]);
});
