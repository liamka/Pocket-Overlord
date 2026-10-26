import { expect, test } from '@playwright/test';

test('visitors animate, have inspectable roles, freeze on pause and survive reload', async ({ page }) => {
  await page.routeWebSocket('**', socket => socket.close());
  await page.route('**/visitors-fixture', route => route.fulfill({ contentType: 'text/html', body: '<canvas style="width:900px;height:700px"></canvas>' }));
  await page.goto('/visitors-fixture');
  const result = await page.evaluate(async () => {
    const paths = ['/src/core/world.ts', '/src/render/renderer.ts', '/src/systems/society.ts', '/src/systems/visitors.ts',
      '/src/core/stockpiles.ts', '/src/core/resource-ledger.ts', '/src/core/units.ts', '/src/persistence/schema.ts', '/src/i18n.ts'];
    const [{ World }, { Renderer }, { assignHouse }, { visitors }, { initializeStorage, attachStorage }, { deposit },
      { inspectUnit }, { decodeSave }, { translate }] = await Promise.all(paths.map(p => import(p)));
    const source = new World(12345), data = source.snapshot();
    data.entities = []; data.nextEntityId = 1;
    data.terrain = { width: 48, height: 48, tiles: Array.from({ length: 48 * 48 }, (_, i) =>
      i % 48 >= 14 && i % 48 <= 33 && Math.floor(i / 48) >= 14 && Math.floor(i / 48) <= 33 ? 3 : 1), moisture: Array(48 * 48).fill(0), recovery: [] };
    let world = new World(data.seed, source.registry, data);
    const town = assignHouse(world, world.spawn('core:house', { x: 24.5, y: 24.5 }));
    const port = world.spawn('core:harbor', { x: 14.5, y: 21.5 });
    Object.assign(port.components.harbor, { villageId: town.id, direction: 2, built: 1, launchIn: 60 });
    initializeStorage(world, town); attachStorage(town, port); deposit(town, { wood: 80, stone: 40 });
    world.startScenario('core:overseas-visitors'); world.scenarios.find((s: { id: string }) => s.id === 'core:overseas-visitors').state.tradeAt = 0;
    world.spawn('core:dragon', { x: 24.5, y: 20.5 });
    const renderer = new Renderer(document.querySelector('canvas')!); renderer.resize(); renderer.camera.fit(48, 48);
    const tick = (n: number) => { for (let i = 0; i < n; i++) { world.tick++; visitors(world, 1 / 30); } };
    tick(30); renderer.draw(world, 1000); const approaching = document.querySelector('canvas')!.toDataURL();
    for (let i = 0; i < 1200 && ![...world.query('monsterHunter')].length; i++) tick(1);
    renderer.draw(world, world.tick * 1000 / 30); const canvas = document.querySelector('canvas')!, landed = canvas.toDataURL();
    const hunter = [...world.query('monsterHunter')][0], merchant = [...world.query('foreignVoyage')].find(e => e.components.foreignVoyage.kind === 'merchants');
    const roles = [inspectUnit(world, hunter.id).occupation, inspectUnit(world, merchant.id).occupation];
    world.paused = true; const snapshot = world.snapshot();
    renderer.draw(world, 99999); const frozen = canvas.toDataURL() === landed;
    world = new World(world.seed, world.registry, decodeSave(snapshot, world.registry));
    renderer.draw(world, 100999); const restored = canvas.toDataURL() === landed;
    world.paused = false; tick(10); renderer.draw(world, world.tick * 1000 / 30);
    return { animated: approaching !== landed, frozen, restored, resumed: canvas.toDataURL() !== landed,
      roles, russian: roles.map(text => translate(text, 'ru')) };
  });
  expect(result).toEqual({ animated: true, frozen: true, restored: true, resumed: true,
    roles: ['Monster hunter', 'Overseas merchants'], russian: ['Охотник на чудовищ', 'Заморские торговцы'] });
});
