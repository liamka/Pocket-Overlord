import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.routeWebSocket('**', socket => socket.close()); });

test('resident poses articulate legs and hammer, keep idle feet planted and preserve all four peoples', async ({ page }) => {
  await page.route('**/builder-pose-fixture', route => route.fulfill({ contentType: 'text/html', body: '<canvas width="80" height="80"></canvas>' }));
  await page.goto('/builder-pose-fixture');
  const result = await page.evaluate(async () => {
    const path = '/src/render/residents.ts'; const { drawResidentSprite, hammerAngle } = await import(path);
    const canvas = document.querySelector('canvas')!, ctx = canvas.getContext('2d')!;
    const clear = () => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, 80, 80); ctx.translate(40, 40); };
    const feet = () => Array.from(ctx.getImageData(25, 40, 30, 10).data).join(',');
    const walking = new Set<string>(), hammer = new Set<string>(), idle = new Set<string>(), peoples = new Set<string>(), headings = new Set<string>();
    for (let i = 0; i < 24; i++) {
      clear(); drawResidentSprite(ctx, { action: 'walk', stride: i * Math.PI / 12, moving: 1, heading: 0 }); walking.add(feet());
      clear(); drawResidentSprite(ctx, { action: 'build', work: i / 24, heading: 0, tool: 'hammer' }); hammer.add(canvas.toDataURL());
      clear(); drawResidentSprite(ctx, { action: 'idle', time: i / 3, moving: 0 }); idle.add(feet());
    }
    for (const race of ['human', 'elf', 'orc', 'dwarf']) {
      clear(); drawResidentSprite(ctx, { race, color: '#e7b86e', heading: 0 }); peoples.add(canvas.toDataURL());
    }
    for (let i = 0; i < 8; i++) {
      clear(); drawResidentSprite(ctx, { heading: i * Math.PI / 4 }); headings.add(canvas.toDataURL());
    }
    return { walking: walking.size, hammer: hammer.size, idle: idle.size, peoples: peoples.size, headings: headings.size,
      held: Math.abs(hammerAngle(0.5) - hammerAngle(0.43)), strike: Math.abs(hammerAngle(0.62) - hammerAngle(0.5)) };
  });
  expect(result.walking).toBeGreaterThanOrEqual(10); expect(result.hammer).toBeGreaterThanOrEqual(14);
  expect(result.idle).toBe(1); expect(result.peoples).toBe(4); expect(result.headings).toBeGreaterThanOrEqual(5);
  expect(result.strike).toBeGreaterThan(result.held * 10);
});

test('the real renderer shows staged construction, freezes a hammer stroke on pause and restores that exact frame', async ({ page }) => {
  await page.route('**/builder-render-fixture', route => route.fulfill({ contentType: 'text/html', body: '<canvas style="width:900px;height:700px"></canvas>' }));
  await page.goto('/builder-render-fixture');
  const result = await page.evaluate(async () => {
    const paths = ['/tests/helpers.ts', '/src/systems/construction.ts', '/src/systems/society.ts', '/src/render/renderer.ts', '/src/core/world.ts', '/src/persistence/schema.ts'];
    const [{ flatWorld }, { startConstruction }, { assignHouse }, { Renderer }, { World }, { decodeSave }] = await Promise.all(paths.map(p => import(p)));
    let world = flatWorld(); const worker = world.spawn('core:person', { x: 22.2, y: 24 });
    worker.components.person.buildIn = 1000; worker.components.person.sex = 'b';
    const house = startConstruction(world, { x: 24, y: 24 }, worker), town = assignHouse(world, house);
    worker.components.person.homeId = house.id; worker.components.citizen.villageId = town.id;
    const canvas = document.querySelector('canvas')!, renderer = new Renderer(canvas);
    renderer.resize(); renderer.camera.x = 24; renderer.camera.y = 24; renderer.camera.zoom = 4;
    renderer.draw(world, 0); const foundation = canvas.toDataURL();
    for (let i = 0; i < 75; i++) { world.step(); renderer.draw(world, (i + 1) * 1000 / 30); }
    const frame = canvas.toDataURL(), progress = house.components.dwelling.construction.progress;
    world.paused = true; const saved = JSON.stringify(world.snapshot());
    renderer.draw(world, 7000); const frozen = frame === canvas.toDataURL();
    const unchanged = saved === JSON.stringify(world.snapshot());
    world = new World(world.seed, world.registry, decodeSave(JSON.parse(saved), world.registry));
    renderer.draw(world, 8000); const restored = frame === canvas.toDataURL();
    world.paused = false; for (let i = 0; i < 450; i++) { world.step(); renderer.draw(world, 8000 + (i + 1) * 1000 / 30); }
    return { animated: foundation !== frame, progress, frozen, unchanged, restored, complete: !world.entities.get(house.id).components.dwelling.construction,
      finalChanged: frame !== canvas.toDataURL(), task: world.entities.get(worker.id).components.citizen.task };
  });
  expect(result.animated).toBe(true); expect(result.progress).toBeGreaterThan(0); expect(result.progress).toBeLessThan(1);
  expect(result.frozen).toBe(true); expect(result.unchanged).toBe(true); expect(result.restored).toBe(true);
  expect(result.complete).toBe(true); expect(result.finalChanged).toBe(true); expect(result.task).not.toBe('build');
});

test('a saved active building site resumes through the game controls and finishes', async ({ page }) => {
  await page.route('**/builder-storage-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Builder save</title>' }));
  await page.goto('/builder-storage-fixture');
  const ids = await page.evaluate(async () => {
    const [{ flatWorld }, { startConstruction }, { assignHouse }] = await Promise.all(['/tests/helpers.ts', '/src/systems/construction.ts', '/src/systems/society.ts'].map(p => import(p)));
    const world = flatWorld(), worker = world.spawn('core:person', { x: 22.2, y: 24 });
    worker.components.person.buildIn = 1000; worker.components.person.sex = 'b';
    const house = startConstruction(world, { x: 24, y: 24 }, worker), town = assignHouse(world, house);
    worker.components.person.homeId = house.id; worker.components.citizen.villageId = town.id;
    for (let i = 0; i < 50; i++) world.step(); world.paused = true;
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('little-world', 1); open.onupgradeneeded = () => open.result.createObjectStore('worlds');
      open.onerror = () => reject(open.error); open.onsuccess = () => {
        const db = open.result, tx = db.transaction('worlds', 'readwrite'); tx.objectStore('worlds').put(world.snapshot(), 'last');
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      };
    });
    return { house: house.id, worker: worker.id };
  });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await expect(page.locator('#loading-screen')).toBeHidden();
  await expect(page.locator('#time-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#time-toggle').click();
  await expect.poll(async () => page.evaluate(houseId => new Promise<boolean>((resolve, reject) => {
    const open = indexedDB.open('little-world', 1); open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, read = db.transaction('worlds').objectStore('worlds').get('last');
      read.onsuccess = () => { const house = read.result.entities.find((e: { id: number }) => e.id === houseId); db.close(); resolve(!!house && !house.components.dwelling.construction); };
      read.onerror = () => reject(read.error);
    };
  }), ids.house), { timeout: 25000 }).toBe(true);
  await page.reload(); await expect(page.locator('#loading-screen')).toBeHidden();
  await expect(page.locator('#population')).toHaveText('1'); expect(errors).toEqual([]);
});
