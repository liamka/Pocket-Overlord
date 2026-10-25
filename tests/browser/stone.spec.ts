import { expect, test } from '@playwright/test';
import { flatWorld } from '../helpers';
import { assignHouse } from '../../src/systems/society';
import { economyOf } from '../../src/core/village-life';

test('stone is available in the real toolbar and stock, upgrades and weapons survive reload', async ({ page }, testInfo) => {
  await page.routeWebSocket('**', socket => socket.close());
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const world = flatWorld(), home = world.spawn('core:house', { x: 24, y: 24 })!, village = assignHouse(world, home);
  Object.assign(home.components.dwelling!, { level: 2, capacity: 7 }); home.components.health = { current: 300, max: 300 };
  const resident = world.spawn('core:person', { x: 22, y: 23 })!;
  resident.components.person!.homeId = home.id;
  Object.assign(resident.components.citizen!, { villageId: village.id, weapon: 'stone-axe' });
  Object.assign(economyOf(village).stocks, { stone: 12, stoneAxes: 2 });
  world.spawn('core:stone', { x: 30, y: 24 }); world.paused = true;
  await page.route('**/stone-storage-fixture', route => route.fulfill({ contentType: 'text/html', body: '<title>Storage fixture</title>' }));
  await page.goto('/stone-storage-fixture');
  await page.evaluate(async serialized => {
    const path = '/src/persistence/storage.ts'; const { IndexedDBBackend } = await import(path);
    await new IndexedDBBackend().write(JSON.parse(serialized));
  }, JSON.stringify(world.snapshot()));
  await page.goto('/'); await expect(page.locator('#loading-screen')).toBeHidden();
  await page.locator('[data-category="nature"]').click();
  const tool = page.locator('[data-tool="core:stone"]');
  await expect(tool).toHaveAccessibleName('Stone'); await tool.click();
  await expect(page.locator('#tool-hint')).toContainText('Residents mine');
  await expect(page.locator('#village-list')).toContainText('Stone: 12 · Axes in stock: 2');
  await expect(page.locator('#village-list')).toContainText('Stone homes: 1 · Armed residents: 1');
  await page.mouse.click(912, 380);
  const saved = () => page.evaluate(async () => {
    const path = '/src/persistence/storage.ts'; const { IndexedDBBackend } = await import(path);
    return new IndexedDBBackend().read();
  });
  await expect.poll(async () => (await saved()).entities.filter((e: { typeId: string }) => e.typeId === 'core:stone').length).toBe(2);
  await page.locator('#settings').click(); await page.locator('#language-select').selectOption('ru');
  await page.locator('#settings-dialog button[value="done"]').click();
  await expect(tool).toHaveAccessibleName('Камень');
  await expect(page.locator('#village-list')).toContainText('Камень: 12 · Топоров в запасе: 2');
  await page.reload(); await expect(page.locator('#loading-screen')).toBeHidden();
  await expect(page.locator('#village-list')).toContainText('Каменных домов: 1 · Вооружено жителей: 1');
  await page.evaluate(() => {
    const ctx = document.querySelector<HTMLCanvasElement>('#world')!.getContext('2d')!, original = ctx.fillText.bind(ctx);
    ctx.fillText = (text, x, y, maxWidth) => {
      if (text.startsWith('Камень:')) document.querySelector('#world')!.setAttribute('data-stone-hover', text);
      original(text, x, y, maxWidth);
    };
  });
  await page.mouse.move(720, 375);
  await expect(page.locator('#world')).toHaveAttribute('data-stone-hover', 'Камень: 12 · Топоров в запасе: 2');
  await page.screenshot({ path: testInfo.outputPath('stone-world.png') });
  expect(errors).toEqual([]);
});

test('mining, stone cargo, axes and upgraded homes have distinct visible sprites', async ({ page }, testInfo) => {
  await page.routeWebSocket('**', socket => socket.close());
  await page.route('**/stone-sprites', route => route.fulfill({ contentType: 'text/html', body: '<style>body{background:#7b9d50;margin:0}canvas{image-rendering:pixelated}</style><canvas width="800" height="240"></canvas>' }));
  await page.goto('/stone-sprites');
  const result = await page.evaluate(async () => {
    const paths = ['/src/render/residents.ts', '/src/render/construction.ts', '/src/render/sprites.ts', '/tests/helpers.ts'];
    const [{ drawResidentSprite }, { drawStoneHouse, drawConstruction }, { drawSprite }, { flatWorld }] = await Promise.all(paths.map(path => import(path)));
    const canvas = document.querySelector('canvas')!, ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const world = flatWorld(), house = world.spawn('core:house', { x: 24, y: 24 });
    const previews: string[] = [];
    const draws = [
      () => drawSprite(ctx, 'house'), () => drawStoneHouse(ctx, house, 0),
      () => { house.components.dwelling.construction = { progress: 0.5, struckAt: 0, upgrade: true }; drawConstruction(ctx, house, 0); },
      () => drawSprite(ctx, world.registry.entities.get('core:stone').sprite),
      () => drawResidentSprite(ctx, { action: 'repair', tool: 'pickaxe', work: 0.43 }),
      () => drawResidentSprite(ctx, { action: 'carry', load: 'stone' }),
      () => drawResidentSprite(ctx, { action: 'fight', tool: 'stone-axe', work: 0.43 }),
      () => drawResidentSprite(ctx, { action: 'carry', load: 'stoneAxes' }),
    ];
    draws.forEach((draw, i) => {
      ctx.save(); ctx.translate(i * 100 + 50, 150); ctx.scale(3, 3); draw(); ctx.restore();
      previews.push(Array.from(ctx.getImageData(i * 100, 0, 100, 240).data).join(','));
    });
    return new Set(previews).size;
  });
  expect(result).toBe(8);
  await page.screenshot({ path: testInfo.outputPath('stone-sprites.png') });
});
