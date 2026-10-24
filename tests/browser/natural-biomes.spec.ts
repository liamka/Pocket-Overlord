import { expect, test, type Page } from '@playwright/test';
import { NATURAL_BIOMES, NaturalBiome } from '../../src/core/natural-biomes';
import { World } from '../../src/core/world';
import { Terrain, type WorldSnapshot } from '../../src/core/types';
import { Camera } from '../../src/render/camera';
import { languages, translate } from '../../src/i18n';
import { flatWorld } from '../helpers';

async function installWorld(page: Page, snapshot: WorldSnapshot): Promise<void> {
  // Use real saved data and application modules, isolated from other tasks' hot reloads.
  await page.routeWebSocket('**', socket => socket.close());
  await page.route('**/biome-storage-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Storage setup</title>' }));
  await page.goto('/biome-storage-fixture');
  await page.evaluate(serialized => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('little-world', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('worlds');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, transaction = db.transaction('worlds', 'readwrite');
      transaction.objectStore('worlds').put(JSON.parse(serialized), 'last');
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  }), JSON.stringify(snapshot));
  await page.goto('/');
  await expect(page.locator('#loading-screen')).toBeHidden();
}

async function savedWorld(page: Page): Promise<WorldSnapshot> {
  const serialized = await page.evaluate(() => new Promise<string>((resolve, reject) => {
    const request = indexedDB.open('little-world', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, read = db.transaction('worlds').objectStore('worlds').get('last');
      read.onsuccess = () => { resolve(JSON.stringify(read.result)); db.close(); };
      read.onerror = () => reject(read.error);
    };
  }));
  return JSON.parse(serialized);
}

test('seed brushes paint with left-drag, preserve the camera, save and reload, and keep right-drag for panning', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const world = flatWorld(); world.paused = true;
  await installWorld(page, world.snapshot());
  await page.locator('[data-category="biomes"]').click();
  for (const biome of NATURAL_BIOMES) await expect(page.getByRole('button', { name: biome.label, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Swamp seeds', exact: true }).click();
  await expect(page.locator('.camera-hint')).toContainText('Left-drag: plant');
  const camera = new Camera(); camera.width = 1440; camera.height = 960; camera.fit(48, 48);
  const start = camera.worldToScreen(16, 24), end = camera.worldToScreen(30, 24);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 20 }); await page.mouse.up();
  await expect.poll(async () => (await savedWorld(page)).terrain.biomes?.[24 * 48 + 30]).toBe(NaturalBiome.Swamp);
  const painted = await savedWorld(page);
  for (let x = 16; x <= 30; x++) expect(painted.terrain.biomes![24 * 48 + x]).toBe(NaturalBiome.Swamp);
  expect(painted.tick).toBe(0);
  expect(painted.terrain.tiles).toEqual(world.terrain.tiles);
  await page.reload(); await expect(page.locator('#loading-screen')).toBeHidden();
  expect((await savedWorld(page)).terrain.biomes).toEqual(painted.terrain.biomes);
  await page.locator('[data-category="biomes"]').click();
  await page.getByRole('button', { name: 'Desert seeds', exact: true }).click();
  await page.mouse.move(start.x, start.y); await page.mouse.down({ button: 'right' });
  await page.mouse.move(start.x + 96, start.y, { steps: 10 }); await page.mouse.up({ button: 'right' });
  const moved = camera.worldToScreen(24, 24);
  await page.mouse.click(moved.x + 96, moved.y);
  await expect.poll(async () => (await savedWorld(page)).terrain.biomes?.[24 * 48 + 24]).toBe(NaturalBiome.Desert);
  expect((await savedWorld(page)).terrain.biomes![24 * 48 + 33]).toBe(painted.terrain.biomes![24 * 48 + 33]);
  expect(errors).toEqual([]);
});

test('renders all climate zones, localizes every brush, and keeps tools accessible at desktop widths', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const world = new World(20); world.paused = true;
  await installWorld(page, world.snapshot());
  expect(new Set(world.terrain.biomes).size).toBe(NATURAL_BIOMES.length);
  await page.locator('[data-category="biomes"]').click();
  for (const language of languages) {
    await page.locator('#settings').click(); await page.locator('#language-select').selectOption(language.id);
    await page.locator('#settings-dialog button[value="done"]').click();
    for (const biome of NATURAL_BIOMES) {
      await page.getByRole('button', { name: translate(biome.label, language.id), exact: true }).click();
      await expect(page.locator('#tool-hint')).toHaveText(translate(biome.hint, language.id));
    }
  }
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 960 });
    await page.locator('[data-category="biomes"]').click();
    for (const biome of NATURAL_BIOMES) {
      const button = page.locator(`[data-tool="core:biome-${biome.key}"]`);
      await button.scrollIntoViewIfNeeded();
      const box = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
      await button.click(); await expect(button).toHaveAttribute('aria-pressed', 'true');
    }
  }
  expect(errors).toEqual([]);
});

for (const biome of NATURAL_BIOMES) {
  test(`creates a ${biome.key} world from the public nature picker and restores it after reload`, async ({ page }, testInfo) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const world = flatWorld(); world.paused = true;
    await installWorld(page, world.snapshot());
    await page.locator('#settings').click(); await page.locator('#new-world').click();
    const picker = page.getByRole('combobox', { name: 'Nature', exact: true });
    await expect(picker.locator('option')).toHaveText(['Mixed biomes', ...NATURAL_BIOMES.map(b => b.name)]);
    await picker.selectOption(biome.key);
    expect((await savedWorld(page)).terrain).toEqual(world.snapshot().terrain);
    await page.locator('#confirm-new').click();
    await expect(page.locator('#loading-screen')).toBeHidden();
    await expect.poll(async () => (await savedWorld(page)).terrain.width).toBe(512);
    const created = await savedWorld(page), ground = created.terrain;
    const land = ground.tiles.flatMap((tile, i) => tile === Terrain.Grass || tile === Terrain.Mountain ? [ground.biomes![i]] : []);
    expect(land.length).toBeGreaterThan(0);
    expect(new Set(land)).toEqual(new Set([biome.id]));
    const surfaces = ground.tiles.flatMap((tile, i) => tile === Terrain.Grass || tile === Terrain.Mountain ? [ground.surfaces![i]] : []);
    expect(new Set(surfaces)).toEqual(new Set([0, 1, 2, 3]));
    expect(surfaces.filter(surface => surface > 0).length / surfaces.length).toBeGreaterThanOrEqual(0.15);
    expect(created.entities.some(e => e.typeId === 'core:tree')).toBe(true);
    for (const tree of created.entities.filter(e => e.typeId === 'core:tree')) {
      const p = tree.components.position!;
      expect(ground.surfaces![Math.floor(p.y) * ground.width + Math.floor(p.x)]).toBe(0);
    }
    await page.reload(); await expect(page.locator('#loading-screen')).toBeHidden();
    expect((await savedWorld(page)).terrain).toEqual(ground);
    await page.locator('#world').screenshot({ path: testInfo.outputPath(`${biome.key}-surfaces.png`) });
    expect(errors).toEqual([]);
  });
}

test('cancelling a nature choice keeps the current world and mixed biomes remain available', async ({ page }) => {
  const world = flatWorld(); world.paused = true;
  await installWorld(page, world.snapshot());
  for (const cancel of ['button', 'escape']) {
    await page.locator('#settings').click(); await page.locator('#new-world').click();
    await page.getByRole('combobox', { name: 'Nature', exact: true }).selectOption('jungle');
    if (cancel === 'button') await page.locator('#new-dialog button[value="cancel"]').click();
    else await page.keyboard.press('Escape');
    await expect(page.locator('#new-dialog')).toBeHidden();
    expect(await savedWorld(page)).toEqual(world.snapshot());
  }
  await page.locator('#settings').click(); await page.locator('#new-world').click();
  const picker = page.getByRole('combobox', { name: 'Nature', exact: true });
  await picker.selectOption('');
  await page.locator('#confirm-new').click();
  await expect(page.locator('#loading-screen')).toBeHidden();
  await expect.poll(async () => (await savedWorld(page)).terrain.width).toBe(512);
  const ground = (await savedWorld(page)).terrain;
  const biomes = ground.tiles.flatMap((tile, i) => tile === Terrain.Grass ? [ground.biomes![i]] : []);
  expect(new Set(biomes).size).toBeGreaterThan(1);
});

test('localizes the nature picker and waits for confirmation after native keyboard selection', async ({ page }) => {
  const world = flatWorld(); world.paused = true;
  await installWorld(page, world.snapshot());
  for (const language of languages) {
    await page.locator('#settings').click(); await page.locator('#language-select').selectOption(language.id);
    await page.locator('#new-world').click();
    const picker = page.getByRole('combobox', { name: translate('Nature', language.id), exact: true });
    await expect(picker.locator('option')).toHaveText(['Mixed biomes', ...NATURAL_BIOMES.map(b => b.name)].map(name => translate(name, language.id)));
    await page.keyboard.press('Escape');
  }
  await page.locator('#settings').click(); await page.locator('#language-select').selectOption('en');
  await page.locator('#new-world').click();
  const picker = page.getByRole('combobox', { name: 'Nature', exact: true });
  await picker.click(); await page.keyboard.press('j'); await page.keyboard.press('Enter');
  await expect(picker).toHaveValue('jungle');
  await picker.dispatchEvent('click', { clientX: 0, clientY: 0 });
  await expect(page.locator('#new-dialog')).toBeVisible();
  expect(await savedWorld(page)).toEqual(world.snapshot());
});
