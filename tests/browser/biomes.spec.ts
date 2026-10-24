import { expect, test, type Page } from '@playwright/test';
import { generateTerrain } from '../../src/core/terrain';
import { BIOMES, biomeForSeed } from '../../src/core/biomes';
import type { WorldSnapshot } from '../../src/core/types';
import { Camera } from '../../src/render/camera';

test.beforeEach(async ({ page }) => {
  // Other tasks may edit the shared workspace while a world dialog is open.
  await page.routeWebSocket('**', socket => socket.close());
});

async function savedWorld(page: Page): Promise<WorldSnapshot | undefined> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('little-world', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction('worlds').objectStore('worlds').get('last');
      request.onsuccess = () => { resolve(request.result); db.close(); };
      request.onerror = () => reject(request.error);
    };
  }));
}

test('automatically creates, renders and reloads a template world without a shape picker', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#new-world')).toBeEnabled();
  await expect.poll(async () => (await savedWorld(page))?.seed).toBeDefined();
  const previousSeed = (await savedWorld(page))!.seed;
  const previousMap = await page.locator('#world').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.locator('#settings').click();
  await page.locator('#new-world').click();
  await expect(page.locator('#biome-select')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Nature', exact: true })).toHaveValue('');
  await page.locator('#confirm-new').click();
  await expect(page.locator('#new-dialog')).not.toBeVisible();
  await expect.poll(async () => (await savedWorld(page))?.seed).not.toBe(previousSeed);
  const saved = (await savedWorld(page))!;
  expect([saved.terrain.width, saved.terrain.height]).toEqual([512, 384]);
  const expected = generateTerrain(saved.seed, saved.terrain.width, saved.terrain.height);
  expect(saved.terrain.tiles).toEqual(expected.tiles);
  await expect.poll(() => page.locator('#world').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).not.toBe(previousMap);
  // Check the actual canvas against the generated land/sea at silhouette landmarks.
  const box = (await page.locator('#world').boundingBox())!;
  const camera = new Camera(); camera.width = box.width; camera.height = box.height;
  camera.fit(saved.terrain.width, saved.terrain.height);
  const landmarks = [[40, 36], [50, 50], [65, 67], [35, 97], [32, 5], [80, 23], [15, 29], [50, 15]].map(([x, y]) => {
    const scale = Math.min(expected.width, expected.height) * 0.87 / 100;
    const tx = Math.floor((x - 50) * scale + expected.width / 2), ty = Math.floor((y - 50) * scale + expected.height / 2);
    return { ...camera.worldToScreen(tx + 0.5, ty + 0.5), land: expected.isLand(tx, ty) };
  });
  await expect.poll(() => page.locator('#world').evaluate((canvas: HTMLCanvasElement, landmarks) => {
    const context = canvas.getContext('2d')!, ratio = canvas.width / canvas.clientWidth;
    return landmarks.every(({ x, y, land }) => {
      const [, green, blue] = context.getImageData(Math.floor(x * ratio), Math.floor(y * ratio), 1, 1).data;
      // Snow and frozen ridges can be slightly blue; ocean water is much bluer.
      return land ? blue - green <= 10 : blue - green > 10;
    });
  }, landmarks)).toBe(true);
  await page.reload();
  await expect(page.locator('#new-world')).toBeEnabled();
  expect((await savedWorld(page))!.terrain).toEqual(saved.terrain);
  const fittedZoom = Number((await page.locator('#zoom-value').innerText()).replace('%', ''));
  await page.mouse.move(box.width / 2, box.height / 2);
  await page.mouse.wheel(0, 100);
  await expect.poll(async () => Number((await page.locator('#zoom-value').innerText()).replace('%', ''))).toBeLessThan(fittedZoom);
  expect(errors).toEqual([]);
});

test('cancelling a new world preserves the current template', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#new-world')).toBeEnabled();
  await expect.poll(async () => (await savedWorld(page))?.seed).toBeDefined();
  const saved = (await savedWorld(page))!;
  for (const cancel of ['button', 'escape']) {
    await page.locator('#settings').click();
    await page.locator('#new-world').click();
    if (cancel === 'button') await page.locator('#new-dialog button[value="cancel"]').click();
    else await page.keyboard.press('Escape');
    await expect(page.locator('#new-dialog')).not.toBeVisible();
    expect((await savedWorld(page))!.seed).toBe(saved.seed);
    expect((await savedWorld(page))!.terrain).toEqual(saved.terrain);
  }
});

for (const query of ['?changelog=0', '?changelog=true']) {
  test(`keeps the biome picker unavailable with ${query}`, async ({ page }) => {
    await page.goto(`/${query}`);
    await expect(page.locator('#new-world')).toBeEnabled();
    await page.locator('#settings').click();
    await page.locator('#new-world').click();
    await expect(page.locator('#biome-select')).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Nature', exact: true })).toBeVisible();
  });
}

for (const biome of BIOMES) {
  test(`debug mode creates and preserves the selected ${biome.id}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/?changelog=1');
    await expect(page.locator('#new-world')).toBeEnabled();
    await expect.poll(async () => (await savedWorld(page))?.seed).toBeDefined();
    const previous = (await savedWorld(page))!;
    await page.locator('#settings').click();
    await page.locator('#new-world').click();
    const picker = page.getByLabel('Biome', { exact: true });
    await expect(picker).toBeVisible();
    expect(await picker.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)))
      .toEqual(['', 'dragon', 'turtle', 'phoenix', 'kraken', 'whale', 'yin-yang']);
    await expect(picker).toHaveValue('');
    await picker.selectOption(biome.id);
    expect((await savedWorld(page))!.terrain).toEqual(previous.terrain);
    await page.keyboard.press('Escape');
    await expect(page.locator('#new-dialog')).toBeHidden();
    expect((await savedWorld(page))!.seed).toBe(previous.seed);
    await page.locator('#settings').click();
    await page.locator('#new-world').click();
    await expect(picker).toHaveValue(biome.id);

    // Fix only the random seed: its automatic template must differ from the explicit selection.
    const seed = BIOMES.length * 20 + (BIOMES.findIndex(candidate => candidate.id === biome.id) + 1) % BIOMES.length;
    expect(biomeForSeed(seed)).not.toBe(biome.id);
    await page.evaluate(seed => {
      const random = crypto.getRandomValues.bind(crypto);
      crypto.getRandomValues = values => {
        if (values instanceof Uint32Array && values.length === 1) { values[0] = seed; return values; }
        return random(values);
      };
    }, seed);
    await page.locator('#confirm-new').click();
    await expect(page.locator('#loading-screen')).toBeHidden();
    await expect.poll(async () => (await savedWorld(page))?.seed).toBe(seed);
    const saved = (await savedWorld(page))!;
    expect(saved.terrain.tiles).toEqual(generateTerrain(seed, 512, 384, biome.id).tiles);
    await page.goto('/');
    await expect(page.locator('#new-world')).toBeEnabled();
    expect((await savedWorld(page))!.terrain).toEqual(saved.terrain);
    await expect(page.locator('#biome-select')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('debug mode localizes the picker and keeps automatic generation available', async ({ page }) => {
  await page.goto('/?preview=world&changelog=1');
  await expect(page.locator('#new-world')).toBeEnabled();
  await expect.poll(async () => (await savedWorld(page))?.seed).toBeDefined();
  const previousSeed = (await savedWorld(page))!.seed;
  await page.locator('#settings').click();
  await page.locator('#language-select').selectOption('ru');
  await page.locator('#new-world').click();
  const picker = page.getByLabel('Биом', { exact: true });
  await expect(picker.locator('option')).toHaveText(['Случайный', 'Дракон', 'Черепаха', 'Феникс', 'Кракен', 'Кит', 'Инь и Ян']);
  await picker.selectOption('whale');
  await picker.selectOption('');
  await page.locator('#confirm-new').click();
  await expect.poll(async () => (await savedWorld(page))?.seed).not.toBe(previousSeed);
  const saved = (await savedWorld(page))!;
  expect(saved.terrain.tiles).toEqual(generateTerrain(saved.seed).tiles);
});

test('choosing a biome through the native picker waits for explicit confirmation', async ({ page }) => {
  await page.goto('/?changelog=1');
  await expect(page.locator('#new-world')).toBeEnabled();
  await expect.poll(async () => (await savedWorld(page))?.seed).toBeDefined();
  const original = (await savedWorld(page))!;
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  const navigations: string[] = [];
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
  await page.locator('#settings').click();
  await page.locator('#new-world').click();
  const picker = page.getByLabel('Biome', { exact: true });
  await picker.click();
  await page.keyboard.press('p');
  await page.keyboard.press('Enter');
  await expect(picker).toHaveValue('phoenix');
  await expect(page.locator('#new-dialog')).toBeVisible();
  // Native popup and keyboard activation can report coordinates outside the dialog.
  await picker.dispatchEvent('click', { clientX: 0, clientY: 0 });
  await expect(page.locator('#new-dialog')).toBeVisible();
  await expect(page.locator('#loading-screen')).toBeHidden();
  expect((await savedWorld(page))!.terrain).toEqual(original.terrain);
  expect((await savedWorld(page))!.seed).toBe(original.seed);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
  expect(navigations).toEqual([]);
  // The actual confirmation button remains operable with the keyboard.
  await page.locator('#confirm-new').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#new-dialog')).toBeHidden();
  await expect.poll(async () => (await savedWorld(page))?.seed).not.toBe(original.seed);
  const saved = (await savedWorld(page))!;
  expect(saved.terrain.tiles).toEqual(generateTerrain(saved.seed, 512, 384, 'phoenix').tiles);
  expect(navigations).toEqual([]);
});
