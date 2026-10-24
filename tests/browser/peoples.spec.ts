import { expect, test, type Page } from '@playwright/test';
import { RACE_IDS } from '../../src/core/races';
import type { WorldSnapshot } from '../../src/core/types';
import { flatWorld } from '../helpers';

async function readSave(page: Page): Promise<WorldSnapshot> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('little-world', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, read = db.transaction('worlds').objectStore('worlds').get('last');
      read.onsuccess = () => { db.close(); resolve(read.result); };
      read.onerror = () => reject(read.error);
    };
  }));
}

test('the real toolbar places all four peoples, translates them and restores them after reload', async ({ page }) => {
  // Isolate the gesture from hot reloads caused by other work in this shared workspace.
  await page.routeWebSocket('**', socket => socket.close());
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const world = flatWorld(); world.paused = true;
  await page.route('**/peoples-storage-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Storage setup</title>' }));
  await page.goto('/peoples-storage-fixture');
  await page.evaluate(serialized => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('little-world', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('worlds');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('worlds', 'readwrite');
      tx.objectStore('worlds').put(JSON.parse(serialized), 'last');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), JSON.stringify(world.snapshot()));
  await page.goto('/'); await expect(page.locator('#loading-screen')).toBeHidden();
  await page.locator('[data-category="people"]').click();
  const names = ['Human', 'Elf', 'Orc', 'Dwarf'];
  for (const [i, race] of RACE_IDS.entries()) {
    const button = page.locator(`[data-tool="core:${race}"]`);
    await expect(button).toHaveAccessibleName(names[i]); await button.click();
    await expect(page.locator('#tool-name')).toHaveText(names[i]);
    await page.mouse.click(720 + (12 + i * 8 - 24) * 16, 380);
    await expect(page.locator('#population')).toHaveText(String(i + 1));
  }
  const portraits = await page.locator(RACE_IDS.map(race => `[data-tool="core:${race}"] canvas`).join(', ')).evaluateAll(canvases => canvases.map(canvas => (canvas as HTMLCanvasElement).toDataURL()));
  expect(new Set(portraits).size).toBe(4);
  await expect.poll(async () => (await readSave(page)).entities.filter(e => e.components.person).map(e => e.components.person!.race)).toEqual(RACE_IDS);
  await page.locator('#settings').click(); await page.locator('#language-select').selectOption('ru');
  await page.locator('#settings-dialog button[value="done"]').click();
  for (const [i, race] of RACE_IDS.entries()) await expect(page.locator(`[data-tool="core:${race}"]`)).toHaveAccessibleName(['Человек', 'Эльф', 'Орк', 'Гном'][i]);
  await page.reload(); await expect(page.locator('#loading-screen')).toBeHidden();
  await expect(page.locator('#population')).toHaveText('4');
  expect((await readSave(page)).entities.filter(e => e.components.person).map(e => e.components.person!.race)).toEqual(RACE_IDS);
  await page.setViewportSize({ width: 900, height: 700 });
  await page.locator('[data-category="people"]').click();
  for (const race of RACE_IDS) {
    const button = page.locator(`[data-tool="core:${race}"]`);
    await expect(button).toBeInViewport(); await button.click(); await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
  expect(errors).toEqual([]);
});

test('peoples and their homes remain visually distinct even with the same village color', async ({ page }) => {
  await page.route('**/peoples-sprite-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><canvas width="640" height="320"></canvas>' }));
  await page.goto('/peoples-sprite-fixture');
  const result = await page.evaluate(async () => {
    const path = '/src/render/sprites.ts';
    const { drawSprite } = await import(path);
    const previews: string[][] = [];
    for (const [sprite, child] of [['person', false], ['person', true], ['house', false]] as const) {
      const row: string[] = [];
      for (const race of ['human', 'elf', 'orc', 'dwarf']) {
        const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 80;
        const ctx = canvas.getContext('2d')!;
        ctx.translate(40, 65); ctx.scale(2, 2);
        drawSprite(ctx, sprite, 0, 0, child, 0, '#e7b86e', race);
        row.push(canvas.toDataURL());
      }
      previews.push(row);
    }
    return previews.map(row => new Set(row).size);
  });
  expect(result).toEqual([4, 4, 4]);
});
