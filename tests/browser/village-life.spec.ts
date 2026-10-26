import { expect, test } from '@playwright/test';

test('livestock and workplaces have distinct animated sprites and goods are visibly carried', async ({ page }) => {
  await page.routeWebSocket('**', socket => socket.close());
  await page.route('**/life-sprites', route => route.fulfill({ contentType: 'text/html', body: '<canvas width="128" height="128"></canvas>' }));
  await page.goto('/life-sprites');
  const result = await page.evaluate(async () => {
    const paths = ['/src/render/village-life.ts', '/src/render/residents.ts'];
    const [{ drawAnimal, drawWorkplace }, { drawResidentSprite }] = await Promise.all(paths.map(path => import(path)));
    const canvas = document.querySelector('canvas')!, ctx = canvas.getContext('2d')!;
    const frame = (draw: () => void) => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, 128, 128); ctx.translate(64, 80); ctx.scale(2, 2); draw(); return canvas.toDataURL(); };
    const animals = ['sheep', 'dog', 'wolf'].map(kind => frame(() => drawAnimal(ctx, { kind, age: 20, heading: 0, stride: 0, moving: false, hunger: 20 })));
    const buildings = ['market', 'mill', 'bakery', 'workshop'].map(kind => frame(() => drawWorkplace(ctx, kind, 0)));
    const steps = [0, 1, 2, 3].map(stride => frame(() => drawAnimal(ctx, { kind: 'dog', age: 20, heading: 0, stride, moving: true, hunger: 20 })));
    const mill0 = frame(() => drawWorkplace(ctx, 'mill', 0)), mill1 = frame(() => drawWorkplace(ctx, 'mill', 1));
    const loads = ['grain', 'flour', 'bread', 'tools', 'planks'].map(load => frame(() => drawResidentSprite(ctx, { action: 'carry', load })));
    return { animals: new Set(animals).size, buildings: new Set(buildings).size, steps: new Set(steps).size, mill: mill0 !== mill1, loads: new Set(loads).size };
  });
  expect(result.animals).toBe(3); expect(result.buildings).toBe(4); expect(result.steps).toBeGreaterThanOrEqual(3);
  expect(result.mill).toBe(true); expect(result.loads).toBe(5);
});

test('the real renderer shows the elder, livestock and market details with translated hover text', async ({ page }, testInfo) => {
  await page.routeWebSocket('**', socket => socket.close());
  await page.route('**/life-world', route => route.fulfill({ contentType: 'text/html', body: '<style>body{margin:0}canvas{width:960px;height:640px}</style><canvas></canvas>' }));
  await page.goto('/life-world');
  const result = await page.evaluate(async () => {
    const paths = ['/tests/helpers.ts', '/src/systems/society.ts', '/src/render/renderer.ts', '/src/core/village-life.ts', '/src/systems/governance.ts'];
    const [{ flatWorld }, { assignHouse }, { Renderer }, { economyOf }, { governance }] = await Promise.all(paths.map(path => import(path)));
    const world = flatWorld(), home = world.spawn('core:house', { x: 24, y: 24 }), village = assignHouse(world, home);
    const owner = world.spawn('core:person', { x: 22, y: 23 }); owner.components.person.homeId = home.id; owner.components.citizen.villageId = village.id;
    for (const [i, kind] of ['market', 'mill', 'bakery', 'workshop'].entries()) world.spawn(`core:${kind}`, { x: 13 + i * 7, y: 32 }).components.workplace.villageId = village.id;
    for (const [i, kind] of ['sheep', 'sheep', 'dog'].entries()) {
      const a = world.spawn(`core:${kind}`, { x: 20 + i * 3, y: 18 }).components.animal;
      a.villageId = village.id; if (kind === 'dog') a.ownerId = owner.id;
    }
    Object.assign(economyOf(village).stocks, { grain: 8, flour: 2, bread: 4, wood: 6, tools: 2 });
    world.tick = 900; governance(world); world.paused = true;
    const canvas = document.querySelector('canvas')!, renderer = new Renderer(canvas, true);
    renderer.resize(); renderer.camera.x = 24; renderer.camera.y = 25; renderer.camera.zoom = 3;
    const ctx = canvas.getContext('2d')!, original = ctx.fillText.bind(ctx), lines: string[] = [];
    ctx.fillText = (text, x, y, maxWidth) => { lines.push(text); original(text, x, y, maxWidth); };
    renderer.cursor = { x: 24, y: 24 }; renderer.draw(world, 0, 'en');
    const english = [...lines]; lines.length = 0;
    renderer.draw(world, 1000, 'ru'); const russian = [...lines];
    renderer.draw(world, 2000, 'en');
    return { english, russian };
  });
  expect(result.english.some(line => line.includes('Elder:') && line.includes('Trust:'))).toBe(true);
  expect(result.english).toContain('Sheep: 2 · Dogs: 1');
  expect(result.english).toContain('Grain: 8 · Flour: 2 · Bread: 4');
  expect(result.russian.some(line => line.includes('Староста:'))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('village-life.png') });
});
