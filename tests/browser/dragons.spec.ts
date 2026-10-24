import { expect, test } from '@playwright/test';
import { flatWorld } from '../helpers';
import { Terrain, type WorldSnapshot } from '../../src/core/types';
import { DRAGON_ID } from '../../src/content/dragons';

// Unrelated edits in a shared dev server must not reload the page during a gesture.
test.beforeEach(async ({ page }) => { await page.routeWebSocket('**', socket => socket.close()); });

test('the entire dragon and shadow fly into view and back out, preserving both flights through reload', async ({ page }) => {
  await page.route('**/dragon-transit-fixture', route => route.fulfill({ contentType: 'text/html', body: '<canvas width="320" height="240"></canvas>' }));
  await page.goto('/dragon-transit-fixture');
  const result = await page.evaluate(async () => {
    const worldPath = '/src/core/world.ts', contentPath = '/src/content/dragons.ts', renderPath = '/src/render/dragons.ts', savePath = '/src/persistence/schema.ts';
    const [{ World }, { dragonGroundPosition, setDragonViewport }, { drawDragon, drawDragonShadow }, { decodeSave }] = await Promise.all([
      import(worldPath), import(contentPath), import(renderPath), import(savePath),
    ]);
    const source = new World(12345), data = source.snapshot(); data.entities = []; data.nextEntityId = 1;
    data.terrain = { width: 48, height: 48, tiles: Array(48 * 48).fill(0), moisture: Array(48 * 48).fill(0), recovery: [] };
    const world = new World(12345, source.registry, data); world.rng.state = 0;
    const viewport = { left: 0, top: 0, right: 40, bottom: 30 };
    world.command({ kind: 'use-tool', toolId: 'core:dragon', x: 24, y: 24, viewport });
    const dragon = [...world.query('dragon')][0], canvas = document.querySelector('canvas')!, ctx = canvas.getContext('2d')!;
    const paint = (w: typeof world): string => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const e = w.entities.get(dragon.id);
      if (e) {
        const state = e.components.dragon, p = e.components.position, time = w.tick / 30;
        drawDragonShadow(ctx, dragonGroundPosition(p, state), state.heading, time);
        drawDragon(ctx, p, state, time);
      }
      return canvas.toDataURL();
    };
    const blank = (): boolean => ctx.getImageData(0, 0, 320, 240).data.every((v, n) => n % 4 !== 3 || v === 0);
    paint(world); const startsOutside = blank();
    const frames = { arrival: new Set<string>(), departure: new Set<string>() };
    let frozen = true, restored = true, visibleAfterArrival = false, offscreenBeforeRemoval = false;
    for (const phase of ['arrival', 'departure'] as const) {
      if (phase === 'departure') {
        visibleAfterArrival = !blank(); dragon.components.dragon.age = 35 - 1 / 30;
        setDragonViewport(world, viewport); world.step();
      }
      for (let i = 0; i < 150 && world.entities.has(dragon.id) && dragon.components.dragon[phase]; i++) {
        world.step(); const frame = paint(world); frames[phase].add(frame);
        if (i === 12) {
          world.paused = true; const saved = world.snapshot(); world.step(); frozen &&= paint(world) === frame;
          const loaded = new World(world.seed, world.registry, decodeSave(saved, world.registry));
          restored &&= paint(loaded) === frame; world.paused = false;
        }
        if (!world.entities.has(dragon.id)) {
          const state = dragon.components.dragon, p = dragon.components.position, time = world.tick / 30;
          drawDragonShadow(ctx, dragonGroundPosition(p, state), state.heading, time); drawDragon(ctx, p, state, time);
          offscreenBeforeRemoval = blank();
        }
      }
    }
    return { startsOutside, arrivalFrames: frames.arrival.size, departureFrames: frames.departure.size,
      visibleAfterArrival, frozen, restored, offscreenBeforeRemoval, removed: !world.entities.has(dragon.id) };
  });
  expect(result.arrivalFrames).toBeGreaterThan(15); expect(result.departureFrames).toBeGreaterThan(15);
  expect(result).toMatchObject({ startsOutside: true, visibleAfterArrival: true, frozen: true, restored: true, offscreenBeforeRemoval: true, removed: true });
});

test('the flight cycle articulates wings, tail and body, mirrors left-facing heads and opens the jaw', async ({ page }) => {
  await page.route('**/dragon-pose-fixture', route => route.fulfill({ contentType: 'text/html', body: '<canvas width="128" height="128"></canvas>' }));
  await page.goto('/dragon-pose-fixture');
  const result = await page.evaluate(async () => {
    const path = '/src/render/dragons.ts';
    const { drawDragonSprite, drawDragonShadow } = await import(path);
    const canvas = document.querySelector('canvas')!, ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const wings = new Set<string>(), tails = new Set<string>(), bodies = new Set<string>(), shadows = new Set<string>();
    const mask = (r: number, g: number, b: number): string => {
      const pixels = ctx.getImageData(0, 0, 128, 128).data, matches = [];
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === r && pixels[i + 1] === g && pixels[i + 2] === b && pixels[i + 3]) matches.push(i / 4);
      return matches.join(',');
    };
    const clear = (): void => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, 128, 128); ctx.translate(64, 64); };
    for (let i = 0; i < 24; i++) {
      const time = (i + 0.5) / 30;
      clear(); drawDragonSprite(ctx, time, 0);
      wings.add(mask(207, 185, 142)); tails.add(mask(191, 73, 43)); bodies.add(mask(243, 184, 101));
      clear(); drawDragonShadow(ctx, { x: 0, y: 0 }, 0, time); shadows.add(canvas.toDataURL());
    }
    const hornsAboveHead = [], jawsOpen = [];
    for (const heading of [0, Math.PI]) {
      clear(); drawDragonSprite(ctx, 0.2, heading);
      const hornPixels = mask(244, 213, 150).split(',').filter(Boolean).map(Number);
      hornsAboveHead.push(hornPixels.length > 0 && hornPixels.every(pixel => Math.floor(pixel / 128) < 64));
      const closed = canvas.toDataURL();
      clear(); drawDragonSprite(ctx, 0.2, heading, true); jawsOpen.push(canvas.toDataURL() !== closed);
    }
    return { wings: wings.size, tails: tails.size, bodies: bodies.size, shadows: shadows.size, hornsAboveHead, jawsOpen };
  });
  expect(result.wings).toBeGreaterThanOrEqual(16);
  expect(result.tails).toBeGreaterThanOrEqual(10);
  expect(result.bodies).toBeGreaterThanOrEqual(6);
  expect(result.shadows).toBeGreaterThanOrEqual(16);
  expect(result.hornsAboveHead).toEqual([true, true]);
  expect(result.jawsOpen).toEqual([true, true]);
});

test('dragon wings and breath animate, freeze on pause and survive reload without changing gameplay', async ({ page }) => {
  await page.route('**/dragon-render-fixture', route => route.fulfill({ contentType: 'text/html', body: '<canvas style="width:900px;height:700px"></canvas>' }));
  await page.goto('/dragon-render-fixture');
  const result = await page.evaluate(async () => {
    const worldPath = '/src/core/world.ts', rendererPath = '/src/render/renderer.ts', savePath = '/src/persistence/schema.ts';
    const [{ World }, { Renderer }, { decodeSave }] = await Promise.all([import(worldPath), import(rendererPath), import(savePath)]);
    const source = new World(12345), data = source.snapshot();
    data.entities = []; data.nextEntityId = 1;
    data.terrain = { width: 48, height: 48, tiles: Array(48 * 48).fill(3), moisture: Array(48 * 48).fill(0), recovery: [] };
    let world = new World(12345, source.registry, data);
    const dragon = world.spawn('core:dragon', { x: 15, y: 24 });
    Object.assign(dragon.components.dragon, { heading: 0, attackIn: 0 });
    world.spawn('core:house', { x: 24, y: 24 });
    const canvas = document.querySelector('canvas')!, renderer = new Renderer(canvas);
    renderer.resize(); renderer.camera.fit(48, 48); renderer.draw(world, 1000);
    const start = canvas.toDataURL();
    for (let i = 0; i < 15; i++) world.step();
    renderer.draw(world, 1500); const flight = canvas.toDataURL();
    world.paused = true;
    const saved = JSON.stringify(world.snapshot());
    renderer.draw(world, 5000); const frozen = canvas.toDataURL() === flight;
    const preserved = JSON.stringify(world.snapshot()) === saved;
    const breathing = dragon.components.dragon.breath > 0;
    world = new World(12345, source.registry, decodeSave(JSON.parse(saved), source.registry));
    renderer.draw(world, 5100); const reloaded = canvas.toDataURL() === flight;
    world.paused = false; for (let i = 0; i < 6; i++) world.step();
    renderer.draw(world, 5300); const resumed = canvas.toDataURL() !== flight;
    return { animated: start !== flight, frozen, preserved, breathing, reloaded, resumed };
  });
  expect(result).toEqual({ animated: true, frozen: true, preserved: true, breathing: true, reloaded: true, resumed: true });
});

test('full wing strokes stay inside their frame and fire puffs descend toward the impact in every direction', async ({ page }) => {
  await page.route('**/dragon-extremes-fixture', route => route.fulfill({ contentType: 'text/html', body: '<canvas width="224" height="224"></canvas>' }));
  await page.goto('/dragon-extremes-fixture');
  const result = await page.evaluate(async () => {
    const renderPath = '/src/render/dragons.ts', contentPath = '/src/content/dragons.ts';
    const [{ drawDragon, drawDragonSprite }, { DRAGON, dragonBreathPose }] = await Promise.all([import(renderPath), import(contentPath)]);
    const canvas = document.querySelector('canvas')!, ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const clear = () => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, 224, 224); ctx.translate(112, 112); };
    let clipped = false, aligned = true, reachesGround = true;
    const flames = new Set<string>(), visibleDirections = new Set<number>();
    for (let direction = 0; direction < 16; direction++) {
      const heading = direction * Math.PI / 8;
      for (let phase = 0; phase < 8; phase++) {
        const time = phase / (8 * DRAGON.wingBeat);
        clear(); drawDragonSprite(ctx, time, heading, true);
        const sprite = ctx.getImageData(0, 0, 224, 224).data;
        for (let i = 3; i < sprite.length; i += 4) if (sprite[i]) {
          const x = Math.floor(i / 4) % 224, y = Math.floor(i / 4 / 224);
          clipped ||= x <= 33 || x >= 190 || y <= 33 || y >= 190;
        }
        clear(); drawDragon(ctx, { x: 0, y: 0 }, { heading, breath: 1 }, time);
        const pixels = ctx.getImageData(0, 0, 224, 224).data, fire: number[] = [];
        const mouth = dragonBreathPose({ x: 0, y: 0 }, heading, time, 0), impact = dragonBreathPose({ x: 0, y: 0 }, heading, time, 1);
        const ax = mouth.x * 8, ay = mouth.y * 8, bx = impact.x * 8, by = impact.y * 8, dx = bx - ax, dy = by - ay;
        let ground = false;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 255 && pixels[i + 1] === 189 && pixels[i + 2] === 63 && pixels[i + 3]) {
          const x = i / 4 % 224 - 112, y = Math.floor(i / 4 / 224) - 112;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
          aligned &&= Math.hypot(x - ax - dx * t, y - ay - dy * t) <= 14;
          ground ||= Math.hypot(x - bx, y - by) <= 12;
          fire.push(i);
        }
        // Wings can briefly hide the descending stream when the dragon faces north.
        if (fire.length) { reachesGround &&= ground; visibleDirections.add(direction); }
        if (direction === 0) flames.add(fire.join(','));
      }
    }
    return { clipped, aligned, reachesGround, frames: flames.size, directions: visibleDirections.size };
  });
  expect(result).toMatchObject({ clipped: false, aligned: true, reachesGround: true, directions: 16 });
  expect(result.frames).toBeGreaterThanOrEqual(7);
});

test('the real toolbar summons dragons from off-screen and saves their approach on reload', async ({ page }) => {
  const world = flatWorld(); world.paused = true; world.terrain.set(24, 24, Terrain.DeepWater);
  await page.route('**/dragon-storage-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Storage setup</title>' }));
  await page.goto('/dragon-storage-fixture');
  await page.evaluate(snapshotJSON => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('little-world', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('worlds');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('worlds', 'readwrite');
      tx.objectStore('worlds').put(JSON.parse(snapshotJSON), 'last');
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  }), JSON.stringify(world.snapshot()));
  await page.goto('/');
  await expect(page.locator('#loading-screen')).toBeHidden();
  await expect(page.locator('#time-toggle')).toHaveAttribute('aria-pressed', 'true');
  const button = page.getByRole('button', { name: 'Dragon', exact: true });
  await expect(button).toBeHidden();
  await page.locator('[data-category="destruction"]').click();
  await expect(button).toBeVisible(); await button.click();
  await expect(page.locator('#tool-name')).toHaveText('Dragon');
  const point = await page.locator('#world').evaluate(canvas => ({ x: canvas.clientWidth / 2, y: (canvas.clientHeight - 200) / 2 }));
  await page.locator('#world').hover({ position: point });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const before = await page.locator('#world').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.locator('#world').click({ position: point });
  const readSave = () => page.evaluate(() => new Promise<WorldSnapshot>((resolve, reject) => {
    const open = indexedDB.open('little-world', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, request = db.transaction('worlds').objectStore('worlds').get('last');
      request.onsuccess = () => { db.close(); resolve(request.result); }; request.onerror = () => reject(request.error);
    };
  }));
  await expect.poll(async () => (await readSave()).entities.filter(e => e.typeId === DRAGON_ID).length).toBe(1);
  const saved = await readSave(), dragon = saved.entities.find(e => e.typeId === DRAGON_ID)!;
  expect(dragon.components.dragon!.arrival!.toX).toBeCloseTo(24, 1);
  expect(dragon.components.dragon!.arrival!.toY).toBeCloseTo(24, 1);
  expect(dragon.components.dragon!.arrival!.elapsed).toBe(0);
  expect(await page.locator('#world').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).toBe(before);
  expect(saved.paused).toBe(true);
  await page.reload(); await expect(page.locator('#loading-screen')).toBeHidden(); await expect(button).toBeVisible();
  await expect(page.locator('[data-category="destruction"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#time-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await readSave()).entities.find(e => e.typeId === DRAGON_ID)).toEqual(dragon);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#language-select').selectOption('ru');
  await expect(page.getByRole('button', { name: 'Дракон', exact: true })).toBeAttached();
});
