import { expect, test } from '@playwright/test';
import { flatWorld } from '../helpers';
import { assignHouse } from '../../src/systems/society';
import { attachStorage, initializeStorage } from '../../src/core/stockpiles';
import { deposit } from '../../src/core/resource-ledger';

test('the running app renders warehouse contents, protection, capacity and cargo, and preserves them on reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const world = flatWorld(), home = world.spawn('core:house', { x: 24, y: 24 })!, village = assignHouse(world, home);
  const market = world.spawn('core:market', { x: 16, y: 28 })!; market.components.workplace!.villageId = village.id;
  initializeStorage(world, village);
  const warehouse = world.spawn('core:stockpile-fireproof', { x: 30, y: 18 })!; warehouse.components.stockpile!.villageId = village.id;
  attachStorage(village, warehouse); deposit(village, { wood: 3, stone: 4, bread: 2 }, warehouse.id);
  const worker = world.spawn('core:person', { x: 18, y: 18 })!;
  Object.assign(worker.components.citizen!, { villageId: village.id, work: { good: 'wood', progress: 0, cargo: { good: 'wood', amount: 3, villageId: village.id } } });
  world.paused = true;
  await page.route('**/stockpile-fixture', route => route.fulfill({ contentType: 'text/html', body: '<title>Storage fixture</title>' }));
  await page.goto('/stockpile-fixture');
  await page.evaluate(async serialized => {
    const path = '/src/persistence/storage.ts'; const { IndexedDBBackend } = await import(path);
    await new IndexedDBBackend().write(JSON.parse(serialized));
  }, JSON.stringify(world.snapshot()));
  await page.goto('/?debug=1'); await expect(page.locator('#loading-screen')).toBeHidden();
  await expect(page.locator('#village-list')).toContainText('Storage sites: 2');
  await expect(page.locator('#village-list')).toContainText('In transit: Wood 3');
  await page.locator('[data-category="buildings"]').click();
  for (const [id, label] of [['stockpile', 'Stockpile'], ['stockpile-fireproof', 'Fireproof stockpile'], ['stockpile-acidproof', 'Acidproof stockpile']])
    await expect(page.locator(`[data-tool="core:${id}"]`)).toHaveAccessibleName(label);
  const observe = () => page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#world')!, ctx = canvas.getContext('2d')!, original = ctx.fillText.bind(ctx);
    ctx.fillText = (text, x, y, maxWidth) => {
      if (/^(Stored volume:|Занятый объём:)/.test(text)) canvas.setAttribute('data-storage-volume', text);
      if (/^(Fireproof stockpile|Огнестойкий склад)$/.test(text)) canvas.setAttribute('data-storage-profile', text);
      original(text, x, y, maxWidth);
    };
  });
  const hover = async () => {
    const box = (await page.locator('#world').boundingBox())!;
    const zoom = Math.min(2, box.width / (48 * 8 * 0.93), (box.height - 220) / (48 * 8 * 0.93));
    await page.mouse.move(box.x + box.width / 2 + 6 * 8 * zoom, box.y + (box.height - 200) / 2 - 6 * 8 * zoom);
  };
  await observe(); await hover();
  await expect(page.locator('#world')).toHaveAttribute('data-storage-volume', 'Stored volume: 12 / 256');
  await expect(page.locator('#world')).toHaveAttribute('data-storage-profile', 'Fireproof stockpile');
  await page.locator('#settings').click(); await page.locator('#language-select').selectOption('ru');
  await page.locator('#settings-dialog button[value="done"]').click(); await hover();
  await expect(page.locator('#world')).toHaveAttribute('data-storage-profile', 'Огнестойкий склад');
  await page.reload(); await expect(page.locator('#loading-screen')).toBeHidden();
  await observe(); await hover();
  await expect(page.locator('#world')).toHaveAttribute('data-storage-volume', 'Занятый объём: 12 / 256');
  await expect(page.locator('#village-list')).toContainText('В пути: Древесина 3');
  expect(errors).toEqual([]);
});
