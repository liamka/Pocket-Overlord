import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/animation-fixture', route => route.fulfill({
    contentType: 'text/html', body: '<canvas style="width:800px;height:600px"></canvas>',
  }));
  await page.goto('/animation-fixture');
});

test('rocket exhaust and fuse animate, freeze on pause and leave saved gameplay unchanged', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const worldPath = '/src/core/world.ts', rendererPath = '/src/render/renderer.ts';
    const [{ World }, { Renderer }] = await Promise.all([import(worldPath), import(rendererPath)]);
    const source = new World(4831), data = source.snapshot();
    data.entities = []; data.nextEntityId = 1;
    data.terrain = { width: 48, height: 48, tiles: Array(48 * 48).fill(3), moisture: Array(48 * 48).fill(0), recovery: [] };
    const world = new World(4831, source.registry, data);
    world.command({ kind: 'use-tool', toolId: 'core:dynamite', x: 16, y: 30 });
    world.command({ kind: 'use-tool', toolId: 'core:rocket', x: 30, y: 35 });
    const canvas = document.querySelector('canvas')!, renderer = new Renderer(canvas);
    renderer.resize(); renderer.camera.fit(48, 48); renderer.draw(world, 1000);
    const start = canvas.toDataURL();
    for (let i = 0; i < 25; i++) world.step();
    world.paused = true;
    const saved = JSON.stringify(world.snapshot());
    renderer.draw(world, 1800); const flight = canvas.toDataURL();
    renderer.draw(world, 5000); const paused = canvas.toDataURL();
    const preserved = JSON.stringify(world.snapshot()) === saved;
    world.paused = false; world.step(); renderer.draw(world, 5033);
    return { animated: start !== flight, frozen: flight === paused, preserved, resumed: canvas.toDataURL() !== paused };
  });
  expect(result).toEqual({ animated: true, frozen: true, preserved: true, resumed: true });
});

test('napalm hides the area preview and animates the bomber, drops and fire across pause and reload', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const worldPath = '/src/core/world.ts', rendererPath = '/src/render/renderer.ts', napalmPath = '/src/content/napalm.ts';
    const [{ World }, { Renderer }, { napalmStrikes }] = await Promise.all([import(worldPath), import(rendererPath), import(napalmPath)]);
    const source = new World(4831), data = source.snapshot();
    data.entities = []; data.nextEntityId = 1;
    data.terrain = { width: 96, height: 64, tiles: Array(96 * 64).fill(3), moisture: Array(96 * 64).fill(0), recovery: [] };
    let world = new World(4831, source.registry, data);
    const canvas = document.querySelector('canvas')!, renderer = new Renderer(canvas);
    renderer.resize(); renderer.camera.fit(96, 64); world.paused = true; renderer.draw(world, 1000);
    const ctx = canvas.getContext('2d')!;
    const before = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    renderer.cursor = { x: 48, y: 40 }; renderer.tool = world.registry.tools.get('core:napalm'); renderer.draw(world, 1000);
    const after = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let cursorPixels = 0;
    for (let i = 0; i < before.length; i += 4) if (before[i] !== after[i] || before[i + 1] !== after[i + 1] || before[i + 2] !== after[i + 2]) cursorPixels++;
    renderer.cursor = undefined; renderer.draw(world, 1000); const empty = canvas.toDataURL();
    world.command({ kind: 'use-tool', toolId: 'core:napalm', x: 48, y: 40 }); world.paused = false;
    for (let i = 0; i < 45; i++) { world.step(); renderer.draw(world, 1000 + i * 1000 / 30); }
    const flight = canvas.toDataURL(), falling = napalmStrikes(world)[0].bombs.length;
    const untouched = world.terrain.tiles.every((tile: number) => tile === 3);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let cockpitPixels = 0;
    // The world vignette tints the canopy away from the center of the screen.
    for (let i = 0; i < pixels.length; i += 4) if (Math.abs(pixels[i] - 107) < 12 && Math.abs(pixels[i + 1] - 183) < 12 && Math.abs(pixels[i + 2] - 193) < 12) cockpitPixels++;
    world.paused = true; const saved = JSON.stringify(world.snapshot());
    renderer.draw(world, 6000); const frozen = canvas.toDataURL() === flight;
    const preserved = JSON.stringify(world.snapshot()) === saved;
    world = new World(4831, source.registry, JSON.parse(saved)); renderer.draw(world, 6100);
    const reloaded = canvas.toDataURL() === flight;
    world.paused = false;
    for (let i = 0; i < 24; i++) { world.step(); renderer.draw(world, 6200 + i * 1000 / 30); }
    const impact = canvas.toDataURL(), burned = world.terrain.tiles.includes(5);
    world.paused = true; renderer.draw(world, 9000); const pausedImpact = canvas.toDataURL() === impact;
    renderer.draw(new World(4831, source.registry, data), 9100);
    return { cursorPixels, falling, untouched, cockpitPixels, animated: flight !== empty, frozen, preserved, reloaded,
      impactChanged: impact !== flight, burned, pausedImpact, reset: canvas.toDataURL() === empty };
  });
  expect(result.cursorPixels).toBeGreaterThan(0); expect(result.cursorPixels).toBeLessThan(16);
  expect(result.falling).toBeGreaterThan(0); expect(result.cockpitPixels).toBeGreaterThan(0);
  expect(result).toMatchObject({ untouched: true, animated: true, frozen: true, preserved: true, reloaded: true,
    impactChanged: true, burned: true, pausedImpact: true, reset: true });
});

test('rockets and bombers face their flight direction on all eight approaches', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const worldPath = '/src/core/world.ts', rendererPath = '/src/render/renderer.ts';
    const flightPath = '/src/core/flight.ts', napalmPath = '/src/content/napalm.ts';
    const [{ World }, { Renderer }, { rocketPose }, { napalmStrikes, napalmPlanePosition, NAPALM }] = await Promise.all([
      import(worldPath), import(rendererPath), import(flightPath), import(napalmPath),
    ]);
    const source = new World(4831), data = source.snapshot();
    data.entities = []; data.nextEntityId = 1;
    data.terrain = { width: 64, height: 64, tiles: Array(64 * 64).fill(3), moisture: Array(64 * 64).fill(0), recovery: [] };
    const canvas = document.querySelector('canvas')!, renderer = new Renderer(canvas);
    renderer.resize(); renderer.camera.x = 32; renderer.camera.y = 28; renderer.camera.zoom = 1.5;
    const ctx = canvas.getContext('2d')!;
    const hasColor = (x: number, y: number, color: number[]) => {
      const screen = renderer.camera.worldToScreen(x / 8, y / 8);
      const pixels = ctx.getImageData(Math.round(screen.x) - 7, Math.round(screen.y) - 7, 15, 15).data;
      for (let i = 0; i < pixels.length; i += 4) {
        if (color.every((channel, c) => Math.abs(pixels[i + c] - channel) < 15)) return true;
      }
      return false;
    };
    const results = [];
    for (let direction = 0; direction < 8; direction++) {
      const world = new World(4831, source.registry, data), target = { x: 32, y: 32 };
      world.command({ kind: 'use-tool', toolId: 'core:napalm', ...target });
      const strike = napalmStrikes(world)[0]; strike.heading = ((direction + 4) % 8) * Math.PI / 4;
      for (let i = 0; i < 45; i++) world.step();
      const rocket = world.spawn('core:rocket', target)!, projectile = rocket.components.projectile!;
      projectile.heading = direction * Math.PI / 4; projectile.remaining = 0.45;
      const pose = rocketPose(target, projectile), plane = napalmPlanePosition(strike, 64, 64);
      world.paused = true;
      // Inspect each aircraft in the clear center of the world vignette.
      renderer.camera.x = pose.x; renderer.camera.y = pose.y; renderer.draw(world, 1000);
      const nose = hasColor(pose.x * 8 + Math.cos(pose.heading) * 14, pose.y * 8 + Math.sin(pose.heading) * 14, [207, 103, 72]);
      renderer.camera.x = plane.x; renderer.camera.y = plane.y - NAPALM.altitude; renderer.draw(world, 1000);
      const cockpit = hasColor(plane.x * 8 + Math.cos(strike.heading) * 25 + Math.sin(strike.heading) * 2,
        (plane.y - NAPALM.altitude) * 8 + Math.sin(strike.heading) * 25 - Math.cos(strike.heading) * 2, [107, 183, 193]);
      results.push({ nose, cockpit });
    }
    return results;
  });
  expect(results).toEqual(Array.from({ length: 8 }, () => ({ nose: true, cockpit: true })));
});

test('land and water blasts show distinct phases, remain visible at high speed and clear on world replacement', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const worldPath = '/src/core/world.ts', rendererPath = '/src/render/renderer.ts';
    const [{ World }, { Renderer }] = await Promise.all([import(worldPath), import(rendererPath)]);
    const canvas = document.querySelector('canvas')!, renderer = new Renderer(canvas);
    renderer.resize(); renderer.camera.fit(48, 48);
    // Keep the flash in the untinted center so exact core colors remain observable.
    renderer.camera.y = 24 - renderer.camera.height * 0.08 / (8 * renderer.camera.zoom);
    const results = [];
    for (const water of [false, true]) {
      const source = new World(4831), data = source.snapshot();
      data.entities = []; data.nextEntityId = 1; data.speed = 20;
      data.terrain = { width: 48, height: 48, tiles: Array(48 * 48).fill(water ? 1 : 3), moisture: Array(48 * 48).fill(0), recovery: [] };
      const world = new World(4831, source.registry, data);
      renderer.draw(world, 1000); const ground = canvas.toDataURL();
      world.visual({ kind: 'blast', x: 24, y: 24, radius: 9 });
      const saved = JSON.stringify(world.snapshot());
      renderer.draw(world, 1000); const flash = canvas.toDataURL();
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      const color = water ? [234, 255, 255] : [255, 248, 207];
      let corePixels = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === color[0] && pixels[i + 1] === color[1] && pixels[i + 2] === color[2]) corePixels++;
      renderer.draw(world, 1016); const highSpeed = canvas.toDataURL();
      for (let i = 2; i <= 20; i++) renderer.draw(world, 1000 + i * 16);
      world.paused = true; renderer.draw(world, 1340); const smoke = canvas.toDataURL();
      renderer.draw(world, 3000); const frozen = smoke === canvas.toDataURL();
      world.paused = false;
      const preserved = saved === JSON.stringify(world.snapshot());
      for (let i = 1; i <= 80; i++) renderer.draw(world, 3000 + i * 16);
      const expired = canvas.toDataURL() === ground;
      world.visual({ kind: 'blast', x: 24, y: 24, radius: 9 }); renderer.draw(world, 4300);
      renderer.draw(new World(4831, source.registry, data), 4316);
      results.push({ corePixels, phased: flash !== highSpeed && highSpeed !== smoke, visibleAtHighSpeed: highSpeed !== ground, frozen, preserved, expired, reset: canvas.toDataURL() === ground });
    }
    return results;
  });
  for (const result of results) {
    expect(result.corePixels).toBeGreaterThan(200);
    expect(result).toMatchObject({ phased: true, visibleAtHighSpeed: true, frozen: true, preserved: true, expired: true, reset: true });
  }
});

test('large chains have bounded drawing work and release all transient effects', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const path = '/src/render/destruction.ts';
    const { DestructionAnimations } = await import(path);
    const effects = new DestructionAnimations(), ctx = document.querySelector('canvas')!.getContext('2d')!;
    let calls = 0;
    const fill = ctx.fillRect.bind(ctx); ctx.fillRect = (...args) => { calls++; fill(...args); };
    const draw = ctx.drawImage.bind(ctx);
    ctx.drawImage = (...args: unknown[]) => { calls++; Reflect.apply(draw, ctx, args); };
    for (let i = 0; i < 2000; i++) effects.explode(100, 100, 72, i % 2 === 0);
    effects.update(0.1); effects.draw(ctx); const busy = calls;
    for (let i = 0; i < 40; i++) effects.update(0.05);
    calls = 0; effects.draw(ctx); const expired = calls;
    effects.explode(100, 100, 44, false); effects.reset();
    calls = 0; effects.draw(ctx);
    return { busy, expired, reset: calls, shakeX: effects.shakeX, shakeY: effects.shakeY };
  });
  expect(result.busy).toBeGreaterThan(500); expect(result.busy).toBeLessThan(1500);
  expect(result).toMatchObject({ expired: 0, reset: 0, shakeX: 0, shakeY: 0 });
});
