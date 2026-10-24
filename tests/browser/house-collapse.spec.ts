import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**', socket => socket.close());
  await page.route('**/collapse-fixture', route => route.fulfill({ contentType: 'text/html', body: '<canvas width="200" height="160" style="width:800px;height:640px"></canvas>' }));
  await page.goto('/collapse-fixture');
});

test('lethal damage collapses in stages, freezes on pause and leaves saved ruins', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const [{ flatWorld }, { Renderer }, { applyEvent }, { World }] = await Promise.all([
      '/tests/helpers.ts', '/src/render/renderer.ts', '/src/systems/effects.ts', '/src/core/world.ts',
    ].map(p => import(p)));
    const world = flatWorld(), canvas = document.querySelector('canvas')!, renderer = new Renderer(canvas);
    renderer.resize(); renderer.camera.x = 24; renderer.camera.y = 24; renderer.camera.zoom = 4;
    renderer.draw(world, 1000); const ground = canvas.toDataURL();
    const house = world.spawn('core:house', { x: 24, y: 24 }); renderer.draw(world, 1000);
    applyEvent(world, { kind: 'damage', target: house.id, amount: 1000 });
    renderer.draw(world, 1000); const initial = canvas.toDataURL();
    let now = 1000; const frames: string[] = [];
    for (let i = 1; i <= 36; i++) { now += 1000 / 30; renderer.draw(world, now); if (i % 9 === 0) frames.push(canvas.toDataURL()); }
    world.paused = true; renderer.draw(world, now); const frozen = canvas.toDataURL();
    const saved = JSON.stringify(world.snapshot());
    renderer.draw(world, now += 3000); const paused = frozen === canvas.toDataURL();
    const unchanged = saved === JSON.stringify(world.snapshot());
    world.paused = false;
    for (let i = 0; i < 180; i++) renderer.draw(world, now += 1000 / 30);
    const settled = canvas.toDataURL(), ruinsRemain = ground !== settled;
    renderer.draw(new World(world.seed, world.registry, world.snapshot()), now += 16);
    const restored = canvas.toDataURL() === settled;
    for (const ruin of world.query('ruin')) world.remove(ruin.id);
    const second = world.spawn('core:house', { x: 24, y: 24 });
    applyEvent(world, { kind: 'damage', target: second.id, amount: 1000 }); renderer.draw(world, now += 16);
    const visibleAgain = canvas.toDataURL() !== ground;
    renderer.draw(new World(world.seed, world.registry, world.snapshot()), now += 16);
    return { visible: initial !== ground, phases: new Set(frames).size, paused, unchanged, ruinsRemain, restored, visibleAgain, savedRuins: canvas.toDataURL() !== ground, houses: world.houseCount };
  });
  expect(result).toEqual({ visible: true, phases: 4, paused: true, unchanged: true, ruinsRemain: true, restored: true, visibleAgain: true, savedRuins: true, houses: 0 });
});

test('fragments preserve all four architectures, village colors and the actual construction stage', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const [{ flatWorld }, { HouseCollapseAnimations }, { drawSprite, villageColor }] = await Promise.all([
      '/tests/helpers.ts', '/src/render/house-collapse.ts', '/src/render/sprites.ts',
    ].map(p => import(p)));
    const world = flatWorld(), canvas = document.querySelector('canvas')!, ctx = canvas.getContext('2d')!;
    const clear = () => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.translate(100, 100); ctx.imageSmoothingEnabled = false; };
    const starts = new Set<string>(), rubble = new Set<string>(), intact: boolean[] = [];
    for (const [index, race] of ['human', 'elf', 'orc', 'dwarf'].entries()) {
      const house = world.spawn('core:house', { x: 0, y: 0 }); house.components.dwelling.race = race;
      house.components.dwelling.villageId = index + 1;
      const effect = new HouseCollapseAnimations(); effect.start({ kind: 'collapse', x: 0, y: 0, radius: 5, house, tick: 0 }, false);
      clear(); drawSprite(ctx, 'house', house.components.appearance?.variant, 0, false, 0, villageColor(index + 1), race);
      const expected = Array.from(ctx.getImageData(88, 70, 23, 27).data);
      clear(); effect.ground(ctx); effect.drawBefore(ctx);
      intact.push(expected.join(',') === Array.from(ctx.getImageData(88, 70, 23, 27).data).join(',')); starts.add(canvas.toDataURL());
      effect.update(1.8); clear(); effect.ground(ctx); effect.drawBefore(ctx); rubble.add(canvas.toDataURL());
    }
    const house = world.spawn('core:house', { x: 0, y: 0 }); house.components.dwelling.construction = { progress: 0, struckAt: -1 };
    const site = new HouseCollapseAnimations(); site.start({ kind: 'collapse', x: 0, y: 0, radius: 5, house, tick: 0 }, false);
    clear(); site.ground(ctx); site.drawBefore(ctx);
    const sky = ctx.getImageData(75, 65, 50, 25).data;
    const noInventedRoof = !sky.some((value, index) => index % 4 === 3 && value > 0);
    site.reset(); clear(); site.ground(ctx); site.drawBefore(ctx);
    const reset = !ctx.getImageData(0, 0, canvas.width, canvas.height).data.some(value => value !== 0);
    return { starts: starts.size, rubble: rubble.size, intact, noInventedRoof, reset };
  });
  expect(result).toEqual({ starts: 4, rubble: 4, intact: [true, true, true, true], noInventedRoof: true, reset: true });
});
