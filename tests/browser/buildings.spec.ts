import { expect, test } from '@playwright/test';
import { flatWorld } from '../helpers';
import { assignHouse } from '../../src/systems/society';
import { planBuilding } from '../../src/systems/construction';
import { initializeStorage } from '../../src/core/stockpiles';
import { deposit } from '../../src/core/resource-ledger';

test('the actual app shows a reserved building, pauses it, localizes its cost and cancels without spending', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const world = flatWorld(), home = world.spawn('core:house', { x: 18, y: 24 })!, village = assignHouse(world, home);
  const worker = world.spawn('core:person', { x: 28.2, y: 18 })!;
  worker.components.citizen!.villageId = village.id; worker.components.person!.homeId = home.id;
  initializeStorage(world, village); deposit(village, { wood: 10 });
  const site = planBuilding(world, 'core:stockpile', { x: 30, y: 18 }, village, worker)!;
  expect(site.components.building!.state).toBe('reserved');
  world.paused = true;
  await page.route('**/building-fixture', route => route.fulfill({ contentType: 'text/html', body: '<title>Building fixture</title>' }));
  await page.goto('/building-fixture');
  await page.evaluate(async serialized => {
    const path = '/src/persistence/storage.ts'; const { IndexedDBBackend } = await import(path);
    await new IndexedDBBackend().write(JSON.parse(serialized));
  }, JSON.stringify(world.snapshot()));
  await page.goto('/?debug=1'); await expect(page.locator('#loading-screen')).toBeHidden();
  const observe = () => page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#world')!, ctx = canvas.getContext('2d')!, original = ctx.fillText.bind(ctx);
    ctx.fillText = (text, x, y, maxWidth) => {
      if (/^(Construction cost:|Стоимость работ:)/.test(text)) canvas.setAttribute('data-building-cost', text);
      if (/^(Materials reserved|Материалы зарезервированы)$/.test(text)) canvas.setAttribute('data-building-state', text);
      if (/^(Entrance accessible|Вход доступен)$/.test(text)) canvas.setAttribute('data-building-access', text);
      if (/^(Building effects inactive|Эффекты здания не действуют)$/.test(text)) canvas.setAttribute('data-building-effects', text);
      original(text, x, y, maxWidth);
    };
  });
  const hover = async () => {
    const box = (await page.locator('#world').boundingBox())!;
    const zoom = Math.min(2, box.width / (48 * 8 * 0.93), (box.height - 220) / (48 * 8 * 0.93));
    const p = { x: box.x + box.width / 2 + 6 * 8 * zoom, y: box.y + (box.height - 200) / 2 - 6 * 8 * zoom };
    await page.mouse.move(p.x, p.y); return p;
  };
  await observe(); await hover();
  await expect(page.locator('#world')).toHaveAttribute('data-building-cost', 'Construction cost: Wood 6');
  await expect(page.locator('#world')).toHaveAttribute('data-building-state', 'Materials reserved');
  await expect(page.locator('#world')).toHaveAttribute('data-building-effects', 'Building effects inactive');
  await expect(page.locator('#world')).toHaveAttribute('data-building-access', 'Entrance accessible');
  await expect(page.locator('#village-list')).toContainText('Reserved: Wood 6');
  await page.locator('#settings').click(); await page.locator('#language-select').selectOption('ru');
  await page.locator('#settings-dialog button[value="done"]').click(); await hover();
  await expect(page.locator('#world')).toHaveAttribute('data-building-cost', 'Стоимость работ: Древесина 6');
  await page.reload(); await expect(page.locator('#loading-screen')).toBeHidden(); await observe(); await hover();
  await expect(page.locator('#world')).toHaveAttribute('data-building-state', 'Материалы зарезервированы');
  await page.locator('[data-category="buildings"]').click(); await page.locator('[data-tool="core:cancel-construction"]').click();
  const point = await hover(); await page.mouse.click(point.x, point.y);
  await expect(page.locator('#village-list')).toContainText('Древесина 10');
  await expect(page.locator('#village-list')).toContainText('Зарезервировано: Пусто');
  expect(errors).toEqual([]);
});
