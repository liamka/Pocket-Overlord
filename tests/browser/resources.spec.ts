import { expect, test } from '@playwright/test';
import { flatWorld } from '../helpers';
import { assignHouse } from '../../src/systems/society';
import { economyOf } from '../../src/core/village-life';
import { processEvents } from '../../src/systems/effects';

test('the actual app shows mixed cargo, finite sources, reservations and loss in both languages after reload', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const world = flatWorld(), home = world.spawn('core:house', { x: 24, y: 24 })!, village = assignHouse(world, home);
  const resident = world.spawn('core:person', { x: 18, y: 18 })!;
  Object.assign(resident.components.citizen!, { villageId: village.id, work: { good: 'wood', progress: 0, cargo: { good: 'wood', amount: 3, villageId: village.id, byproducts: { gems: 1 } } } });
  const economy = economyOf(village); economy.stocks.wood = 5; economy.lost = { stone: 4 }; economy.spent = { wood: 3 };
  const sheep = world.spawn('core:sheep', { x: 30, y: 18 })!;
  world.events.push({ kind: 'damage', target: sheep.id, amount: 10000 }); processEvents(world);
  world.paused = true;
  await page.route('**/resource-storage-fixture', route => route.fulfill({ contentType: 'text/html', body: '<title>Storage fixture</title>' }));
  await page.goto('/resource-storage-fixture');
  await page.evaluate(async serialized => {
    const path = '/src/persistence/storage.ts'; const { IndexedDBBackend } = await import(path);
    await new IndexedDBBackend().write(JSON.parse(serialized));
  }, JSON.stringify(world.snapshot()));
  await page.goto('/?debug=1'); await expect(page.locator('#loading-screen')).toBeHidden();
  await expect(page.locator('#village-list')).toContainText('In transit: Wood 3, Gems 1');
  await expect(page.locator('#village-list')).toContainText('Lost: Stone 4');
  // Instrument drawing without replacing modules or bypassing the running renderer.
  const observeCanvas = async () => page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#world')!, ctx = canvas.getContext('2d')!, original = ctx.fillText.bind(ctx);
    ctx.fillText = (text, x, y, maxWidth) => {
      if (/^(Cargo:|Груз:)/.test(text)) canvas.setAttribute('data-resource-cargo', text);
      if (/^(Remaining:|Осталось:)/.test(text)) canvas.setAttribute('data-resource-source', text);
      original(text, x, y, maxWidth);
    };
  });
  const pointAt = async (x: number, y: number) => {
    const box = (await page.locator('#world').boundingBox())!;
    const zoom = Math.min(2, box.width / (48 * 8 * 0.93), (box.height - 220) / (48 * 8 * 0.93));
    await page.mouse.move(box.x + box.width / 2 + (x - 24) * 8 * zoom, box.y + (box.height - 200) / 2 + (y - 24) * 8 * zoom);
  };
  await observeCanvas(); await pointAt(18, 18);
  await expect(page.locator('#world')).toHaveAttribute('data-resource-cargo', 'Cargo: Wood 3, Gems 1');
  await pointAt(30, 18);
  await expect(page.locator('#world')).toHaveAttribute('data-resource-source', 'Remaining: Meat 2, Bone 1, Leather 2');
  await page.locator('#settings').click(); await page.locator('#language-select').selectOption('ru');
  await page.locator('#settings-dialog button[value="done"]').click();
  await pointAt(18, 18);
  await expect(page.locator('#world')).toHaveAttribute('data-resource-cargo', 'Груз: Древесина 3, Самоцветы 1');
  await expect(page.locator('#village-list')).toContainText('Израсходовано: Древесина 3');
  await page.reload(); await expect(page.locator('#loading-screen')).toBeHidden();
  await observeCanvas(); await pointAt(30, 18);
  await expect(page.locator('#world')).toHaveAttribute('data-resource-source', 'Осталось: Мясо 2, Кость 1, Кожа 2');
  await page.screenshot({ path: testInfo.outputPath('resource-source-ru.png') });
  expect(errors).toEqual([]);
});
