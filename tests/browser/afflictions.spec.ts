import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { WorldSnapshot } from '../../src/core/types';
import { flatWorld } from '../helpers';

test.beforeEach(async ({ page }) => { await page.routeWebSocket('**', socket => socket.close()); });

for (const id of ['core:plague', 'core:madness']) {
  test(`${id} renders animated symptoms and its saved pose stays frozen on pause`, async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/affliction-render-fixture', route => route.fulfill({ contentType: 'text/html', body: '<canvas style="width:1000px;height:700px"></canvas>' }));
    await page.goto('/affliction-render-fixture');
    const result = await page.evaluate(async id => {
      const paths = ['/src/core/world.ts', '/src/render/renderer.ts', '/src/persistence/schema.ts', '/src/render/tool-icons.ts'];
      const [{ World }, { Renderer }, { decodeSave }, { paintToolIcon }] = await Promise.all(paths.map(path => import(path)));
      const source = new World(12345), data = source.snapshot(); data.entities = []; data.nextEntityId = 1;
      data.terrain = { width: 48, height: 48, tiles: Array(48 * 48).fill(3), moisture: Array(48 * 48).fill(0), recovery: [] };
      let world = new World(12345, source.registry, data);
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4, e = world.spawn(['core:person', 'core:elf', 'core:orc', 'core:dwarf'][i % 4], { x: 24 + Math.cos(angle) * 3.8, y: 24 + Math.sin(angle) * 3.8 });
        e.components.person.buildIn = e.components.person.reproduceIn = 10000;
        if (id === 'core:plague') e.components.motion.speed = 0;
      }
      const canvas = document.querySelector('canvas')!, renderer = new Renderer(canvas), ctx = canvas.getContext('2d')!;
      renderer.resize(); renderer.camera.x = 24; renderer.camera.y = 23; renderer.camera.zoom = 4;
      renderer.draw(world, 0); const healthy = canvas.toDataURL();
      world.command({ kind: 'use-tool', toolId: id, x: 24, y: 24 });
      renderer.draw(world, 0); const applied = canvas.toDataURL();
      const count = id === 'core:plague' ? 210 : 90;
      for (let n = 0; n < count; n++) world.step();
      renderer.draw(world, count * 1000 / 30); const active = canvas.toDataURL();
      world.paused = true; const saved = JSON.stringify(world.snapshot()), pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const same = () => ctx.getImageData(0, 0, canvas.width, canvas.height).data.every((v, i) => Math.abs(v - pixels[i]) <= 2);
      renderer.draw(world, 10000); const frozen = same(), readOnly = saved === JSON.stringify(world.snapshot());
      world = new World(world.seed, source.registry, decodeSave(JSON.parse(saved), source.registry)); renderer.draw(world, 11000);
      const restored = same();
      const icon = document.createElement('canvas'); icon.width = icon.height = 96;
      const customIcon = paintToolIcon(icon, id);
      return { healthy, applied, active, frozen, restored, readOnly, customIcon, icon: icon.toDataURL() };
    }, id);
    expect(result).toMatchObject({ frozen: true, restored: true, readOnly: true, customIcon: true });
    expect(new Set([result.healthy, result.applied, result.active]).size).toBe(3); expect(errors).toEqual([]);
    await writeFile(info.outputPath('active.png'), Buffer.from(result.active.split(',')[1], 'base64'));
    await writeFile(info.outputPath('icon.png'), Buffer.from(result.icon.split(',')[1], 'base64'));
  });
}

test('both destruction tools apply through the toolbar and survive autosave and reload', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const world = flatWorld(); world.paused = true;
  for (const x of [14, 34]) for (let i = 0; i < 4; i++) {
    const e = world.spawn('core:person', { x: x + (i % 2 ? 1 : -1), y: 24 + (i < 2 ? -1 : 1) })!;
    e.components.person!.buildIn = e.components.person!.reproduceIn = 10000;
  }
  await page.route('**/affliction-storage-fixture', route => route.fulfill({ contentType: 'text/html', body: '<title>Save setup</title>' }));
  await page.goto('/affliction-storage-fixture');
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
  await page.locator('[data-category="destruction"]').click();
  for (const [i, name] of ['Plague', 'Madness'].entries()) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('#tool-hint')).toContainText(i ? 'attack anyone' : 'close contact');
    await page.mouse.click(box.x + points[i].x, box.y + points[i].y);
  }
  await expect.poll(async () => (await readSave()).entities.filter(e => e.components.person?.plague).length).toBe(4);
  await expect.poll(async () => (await readSave()).entities.filter(e => e.components.person?.madness).length).toBe(4);
  const saved = (await readSave()).entities;
  await page.reload(); await expect(page.locator('#loading-screen')).toBeHidden();
  expect((await readSave()).entities).toEqual(saved);
  await page.keyboard.press('2');
  await expect.poll(async () => (await readSave()).entities.some(e => e.components.person?.madness && e.components.citizen?.task === 'fight')).toBe(true);
  await expect.poll(async () => (await readSave()).entities.some(e => e.components.person?.plague && e.components.health!.current < e.components.health!.max)).toBe(true);
  await page.keyboard.press('1'); await expect.poll(async () => (await readSave()).paused).toBe(true);
  await page.locator('[data-category="destruction"]').click();
  await page.screenshot({ path: info.outputPath('toolbar.png') });
  expect(errors).toEqual([]);
});
