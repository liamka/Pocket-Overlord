import { expect, test, type Page } from '@playwright/test';
import { generateTerrain } from '../../src/core/terrain';
import { BIOMES, biomeForSeed } from '../../src/core/biomes';
import type { WorldSnapshot } from '../../src/core/types';
import { Camera } from '../../src/render/camera';

test.beforeEach(async ({ page }) => {
  // Other tasks may edit the shared workspace while a world dialog is open.
  await page.routeWebSocket('**', socket => socket.close());
});

test('ocean continues across map edges and covers the viewport when zoomed out or panned', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loading-screen')).toBeHidden();
  const result = await page.evaluate(async () => {
    const worldModule = '/src/core/world.ts', rendererModule = '/src/render/renderer.ts', oceanModule = '/src/render/ocean.ts';
    const { World } = await import(worldModule), { Renderer } = await import(rendererModule), { Ocean } = await import(oceanModule);
    const template = new World(20, undefined, undefined, []), data = template.snapshot();
    data.entities = []; data.nextEntityId = 1;
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;left:0;top:0;width:480px;height:320px'; document.body.append(canvas);
    const renderer = new Renderer(canvas); renderer.resize();
    const render = async (width: number, height: number): Promise<Uint8ClampedArray> => {
      data.terrain = { width, height, tiles: Array(width * height).fill(0), moisture: Array(width * height).fill(0) };
      const world = new World(20, template.registry, data, []); world.paused = true;
      Object.assign(renderer.camera, { x: 48, y: 32, zoom: 1 });
      // Final worker textures must match the terrain exactly, including its edge.
      for (let frame = 0; frame < 120; frame++) {
        renderer.draw(world, 0);
        if (!renderer.ocean.pendingChunks.size) break;
        await new Promise(requestAnimationFrame);
      }
      return canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    // Moving the playable boundary through the same water must not change its pixels.
    const small = await render(48, 48), large = await render(160, 128);
    const matching = small.every((value, i) => value === large[i]);
    const ocean = new Ocean(), ctx = canvas.getContext('2d')!;
    const coverage: { zoom: number; opaque: boolean; colors: number[]; stable: boolean }[] = [];
    for (const zoom of [1, 0.175, 0.04]) for (const x of [48, -100, 600]) {
      const draw = (): Uint8ClampedArray => {
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
        Object.assign(renderer.camera, { x, y: -80, zoom });
        const origin = renderer.camera.origin;
        ctx.translate(Math.round(origin.x), Math.round(origin.y)); ctx.scale(zoom, zoom);
        ocean.drawBackground(ctx, renderer.camera, 20);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const first = draw(), again = draw(), colors = Array.from({ length: 4 }, () => new Set<string>());
      let opaque = true;
      for (let y = 0; y < canvas.height; y++) for (let px = 0; px < canvas.width; px++) {
        const i = (y * canvas.width + px) * 4;
        if (first[i + 3] !== 255) opaque = false;
        colors[Number(px >= canvas.width / 2) + Number(y >= canvas.height / 2) * 2].add(`${first[i]},${first[i + 1]},${first[i + 2]}`);
      }
      coverage.push({ zoom, opaque, colors: colors.map(set => set.size), stable: first.every((value, i) => value === again[i]) });
    }
    canvas.remove();
    return { matching, coverage };
  });
  expect(result.matching).toBe(true);
  for (const view of result.coverage) {
    expect(view.opaque).toBe(true);
    expect(view.stable).toBe(true);
    expect(view.colors.every(count => count > (view.zoom === 1 ? 1 : 2)), JSON.stringify(view)).toBe(true);
  }
});

test('cold ocean zoom builds only bounded previews on the rendering thread', async ({ page }) => {
  await page.route('**/ocean-performance', route => route.fulfill({ contentType: 'text/html', body: '<canvas width="1440" height="960"></canvas>' }));
  await page.goto('/ocean-performance');
  const work = await page.evaluate(async () => {
    const oceanPath = '/src/render/ocean.ts', cameraPath = '/src/render/camera.ts';
    const { Ocean } = await import(oceanPath), { Camera } = await import(cameraPath);
    const ocean = new Ocean(), camera = new Camera(), canvas = document.querySelector('canvas')!;
    camera.width = canvas.width; camera.height = canvas.height; camera.x = camera.y = 0;
    const fillRect = CanvasRenderingContext2D.prototype.fillRect, counts: number[] = [];
    let count = 0;
    CanvasRenderingContext2D.prototype.fillRect = function (...args) { count++; return fillRect.apply(this, args); };
    try {
      for (const zoom of [0.175, 0.26, 0.51, 1]) {
        camera.zoom = zoom; count = 0;
        ocean.drawBackground(canvas.getContext('2d')!, camera, 4831);
        counts.push(count);
      }
    } finally { CanvasRenderingContext2D.prototype.fillRect = fillRect; }
    return counts;
  });
  // A zoom must not synchronously paint hundreds of thousands of detailed water pixels.
  expect(Math.max(...work)).toBeLessThan(25000);
});

test('a local shore edit repaints only its affected coast and matches a fresh depth map', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loading-screen')).toBeHidden();
  const result = await page.evaluate(async () => {
    const terrainPath = '/src/core/terrain.ts', oceanPath = '/src/render/ocean.ts';
    const { TerrainMap } = await import(terrainPath), { Ocean } = await import(oceanPath);
    const map = new TerrainMap(512, 384), ocean = new Ocean();
    map.set(256, 192, 3); map.set(257, 192, 3);
    ocean.update(map); map.dirty.clear();
    map.set(256, 192, 1); ocean.update(map);
    const dirty = map.dirty.size, fresh = new Ocean(); fresh.update(map);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    const pixels = (source: InstanceType<typeof Ocean>): Uint8ClampedArray => {
      ctx.setTransform(1, 0, 0, 1, -224 * 8, -160 * 8);
      for (let y = 160; y < 224; y++) for (let x = 224; x < 288; x++) source.drawTile(ctx, x, y, 4831);
      return ctx.getImageData(0, 0, 512, 512).data;
    };
    const incremental = pixels(ocean), rebuilt = pixels(fresh);
    return { dirty, matching: incremental.every((value, i) => value === rebuilt[i]) };
  });
  expect(result.dirty).toBeLessThan(10000);
  expect(result.matching).toBe(true);
});

async function savedWorld(page: Page): Promise<WorldSnapshot | undefined> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('little-world', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction('worlds').objectStore('worlds').get('last');
      request.onsuccess = () => { resolve(request.result); db.close(); };
      request.onerror = () => reject(request.error);
    };
  }));
}

test('new maps can start with inhabited settlements, persist them and also start empty', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#loading-screen')).toBeHidden();
  await page.locator('#settings').click(); await page.locator('#new-world').click();
  await page.locator('#world-seed').fill('4');
  await page.locator('#nature-select').selectOption('grassland');
  await page.locator('#confirm-new').click();
  await expect(page.locator('#loading-screen')).toBeHidden();
  await page.locator('#time-toggle').click();
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect.poll(async () => {
    const saved = await savedWorld(page);
    return saved?.seed === 4 && saved.paused;
  }).toBe(true);
  const saved = (await savedWorld(page))!;
  expect(saved.society.villages).toHaveLength(3);
  const residents = saved.entities.filter(e => e.components.person);
  expect(residents.length).toBeGreaterThanOrEqual(24);
  await expect(page.locator('#population')).toHaveText(String(residents.length));
  for (const resident of residents) {
    const home = saved.entities.find(e => e.id === resident.components.person!.homeId);
    expect(home?.components.dwelling?.villageId).toBe(resident.components.citizen!.villageId);
    expect(home?.components.building?.state).toBe('active');
  }
  await page.reload();
  await expect(page.locator('#loading-screen')).toBeHidden();
  await expect(page.locator('#population')).toHaveText(String(residents.length));
  expect((await savedWorld(page))!.society.villages).toEqual(saved.society.villages);
  await page.locator('#settings').click(); await page.locator('#new-world').click();
  await page.locator('#world-seed').fill('0');
  await page.locator('#confirm-new').click();
  await expect(page.locator('#loading-screen')).toBeHidden();
  await expect.poll(async () => (await savedWorld(page))?.seed).toBe(0);
  await expect(page.locator('#population')).toHaveText('0');
  expect((await savedWorld(page))!.society.villages).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('automatically creates, renders and reloads a template world without a shape picker', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#new-world')).toBeEnabled();
  await expect.poll(async () => (await savedWorld(page))?.seed).toBeDefined();
  const previousSeed = (await savedWorld(page))!.seed;
  const previousMap = await page.locator('#world').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.locator('#settings').click();
  await page.locator('#new-world').click();
  await expect(page.locator('#biome-select')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Nature', exact: true }).selectOption('');
  await page.locator('#confirm-new').click();
  await expect(page.locator('#new-dialog')).not.toBeVisible();
  await expect.poll(async () => (await savedWorld(page))?.seed).not.toBe(previousSeed);
  const saved = (await savedWorld(page))!;
  expect([saved.terrain.width, saved.terrain.height]).toEqual([512, 384]);
  const expected = generateTerrain(saved.seed, saved.terrain.width, saved.terrain.height);
  expect(saved.terrain.tiles).toEqual(expected.tiles);
  await expect.poll(() => page.locator('#world').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).not.toBe(previousMap);
  // Check the actual canvas against the generated land/sea at silhouette landmarks.
  const box = (await page.locator('#world').boundingBox())!;
  const camera = new Camera(); camera.width = box.width; camera.height = box.height;
  camera.fit(saved.terrain.width, saved.terrain.height);
  const landmarks = [[40, 36], [50, 50], [65, 67], [35, 97], [32, 5], [80, 23], [15, 29], [50, 15]].map(([x, y]) => {
    const scale = Math.min(expected.width, expected.height) * 0.87 / 100;
    const tx = Math.floor((x - 50) * scale + expected.width / 2), ty = Math.floor((y - 50) * scale + expected.height / 2);
    return { ...camera.worldToScreen(tx + 0.5, ty + 0.5), land: expected.isLand(tx, ty) };
  });
  await expect.poll(() => page.locator('#world').evaluate((canvas: HTMLCanvasElement, landmarks) => {
    const context = canvas.getContext('2d')!, ratio = canvas.width / canvas.clientWidth;
    return landmarks.every(({ x, y, land }) => {
      const [, green, blue] = context.getImageData(Math.floor(x * ratio), Math.floor(y * ratio), 1, 1).data;
      // Snow and frozen ridges can be slightly blue; ocean water is much bluer.
      return land ? blue - green <= 10 : blue - green > 10;
    });
  }, landmarks)).toBe(true);
  await page.reload();
  await expect(page.locator('#new-world')).toBeEnabled();
  expect((await savedWorld(page))!.terrain).toEqual(saved.terrain);
  const fittedZoom = Number((await page.locator('#zoom-value').innerText()).replace('%', ''));
  await page.mouse.move(box.width / 2, box.height / 2);
  await page.mouse.wheel(0, 100);
  await expect.poll(async () => Number((await page.locator('#zoom-value').innerText()).replace('%', ''))).toBeLessThan(fittedZoom);
  expect(errors).toEqual([]);
});

test('cancelling a new world preserves the current template', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#new-world')).toBeEnabled();
  await expect.poll(async () => (await savedWorld(page))?.seed).toBeDefined();
  const saved = (await savedWorld(page))!;
  for (const cancel of ['button', 'escape']) {
    await page.locator('#settings').click();
    await page.locator('#new-world').click();
    if (cancel === 'button') await page.locator('#new-dialog button[value="cancel"]').click();
    else await page.keyboard.press('Escape');
    await expect(page.locator('#new-dialog')).not.toBeVisible();
    expect((await savedWorld(page))!.seed).toBe(saved.seed);
    expect((await savedWorld(page))!.terrain).toEqual(saved.terrain);
  }
});

for (const query of ['?debug=0', '?debug=true']) {
  test(`keeps the biome picker unavailable with ${query}`, async ({ page }) => {
    await page.goto(`/${query}`);
    await expect(page.locator('#new-world')).toBeEnabled();
    await page.locator('#settings').click();
    await page.locator('#new-world').click();
    await expect(page.locator('#biome-select')).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Nature', exact: true })).toBeVisible();
  });
}

for (const biome of BIOMES) {
  test(`debug mode creates and preserves the selected ${biome.id}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/?debug=1');
    await expect(page.locator('#new-world')).toBeEnabled();
    await expect.poll(async () => (await savedWorld(page))?.seed).toBeDefined();
    const previous = (await savedWorld(page))!;
    await page.locator('#settings').click();
    await page.locator('#new-world').click();
    const picker = page.getByLabel('Island shape', { exact: true });
    await expect(picker).toBeVisible();
    expect(await picker.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)))
      .toEqual(['', 'turtle', 'phoenix', 'kraken', 'whale', 'yin-yang']);
    await picker.selectOption(biome.id);
    expect((await savedWorld(page))!.terrain).toEqual(previous.terrain);
    await page.keyboard.press('Escape');
    await expect(page.locator('#new-dialog')).toBeHidden();
    expect((await savedWorld(page))!.seed).toBe(previous.seed);
    // Fix the preview seed: its automatic template must differ from the explicit selection.
    const seed = BIOMES.length * 20 + (BIOMES.findIndex(candidate => candidate.id === biome.id) + 1) % BIOMES.length;
    expect(biomeForSeed(seed)).not.toBe(biome.id);
    await page.evaluate(seed => {
      const random = crypto.getRandomValues.bind(crypto);
      crypto.getRandomValues = values => {
        if (values instanceof Uint32Array && values.length === 1) { values[0] = seed; return values; }
        return random(values);
      };
    }, seed);
    await page.locator('#settings').click();
    await page.locator('#new-world').click();
    await picker.selectOption(biome.id);
    await page.locator('#confirm-new').click();
    await expect(page.locator('#loading-screen')).toBeHidden();
    await expect.poll(async () => (await savedWorld(page))?.seed).toBe(seed);
    const saved = (await savedWorld(page))!;
    expect(saved.terrain.tiles).toEqual(generateTerrain(seed, 512, 384, biome.id).tiles);
    await page.goto('/');
    await expect(page.locator('#new-world')).toBeEnabled();
    expect((await savedWorld(page))!.terrain).toEqual(saved.terrain);
    await expect(page.locator('#biome-select')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('debug mode localizes the picker and keeps automatic generation available', async ({ page }) => {
  await page.goto('/?preview=world&debug=1');
  await expect(page.locator('#new-world')).toBeEnabled();
  await expect.poll(async () => (await savedWorld(page))?.seed).toBeDefined();
  const previousSeed = (await savedWorld(page))!.seed;
  await page.locator('#settings').click();
  await page.locator('#language-select').selectOption('ru');
  await page.locator('#new-world').click();
  const picker = page.getByLabel('Форма острова', { exact: true });
  await expect(page.getByRole('img', { name: 'Превью нового острова', exact: true })).toBeVisible();
  await expect(picker.locator('option')).toHaveText(['Случайный', 'Черепаха', 'Феникс', 'Кракен', 'Кит', 'Инь и Ян']);
  await picker.selectOption('whale');
  await picker.selectOption('');
  await page.locator('#confirm-new').click();
  await expect.poll(async () => (await savedWorld(page))?.seed).not.toBe(previousSeed);
  const saved = (await savedWorld(page))!;
  expect(saved.terrain.tiles).toEqual(generateTerrain(saved.seed).tiles);
});

test('choosing a biome through the native picker waits for explicit confirmation', async ({ page }) => {
  await page.goto('/?debug=1');
  await expect(page.locator('#new-world')).toBeEnabled();
  await expect.poll(async () => (await savedWorld(page))?.seed).toBeDefined();
  const original = (await savedWorld(page))!;
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  const navigations: string[] = [];
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
  await page.locator('#settings').click();
  await page.locator('#new-world').click();
  const picker = page.getByLabel('Island shape', { exact: true });
  await picker.click();
  await page.keyboard.press('p');
  await page.keyboard.press('Enter');
  await expect(picker).toHaveValue('phoenix');
  await expect(page.locator('#new-dialog')).toBeVisible();
  // Native popup and keyboard activation can report coordinates outside the dialog.
  await picker.dispatchEvent('click', { clientX: 0, clientY: 0 });
  await expect(page.locator('#new-dialog')).toBeVisible();
  await expect(page.locator('#loading-screen')).toBeHidden();
  expect((await savedWorld(page))!.terrain).toEqual(original.terrain);
  expect((await savedWorld(page))!.seed).toBe(original.seed);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
  expect(navigations).toEqual([]);
  // The actual confirmation button remains operable with the keyboard.
  await page.locator('#confirm-new').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#new-dialog')).toBeHidden();
  await expect.poll(async () => (await savedWorld(page))?.seed).not.toBe(original.seed);
  const saved = (await savedWorld(page))!;
  expect(saved.terrain.tiles).toEqual(generateTerrain(saved.seed, 512, 384, 'phoenix').tiles);
  expect(navigations).toEqual([]);
});

for (const query of ['', '?debug=1']) {
  test(`previews nature and island shape changes and creates the displayed map with ${query || 'public mode'}`, async ({ page }) => {
    await page.goto(`/${query}`);
    await expect(page.locator('#loading-screen')).toBeHidden();
    await expect.poll(async () => (await savedWorld(page))?.seed).toBeDefined();
    const previousSeed = (await savedWorld(page))!.seed;
    await page.locator('#settings').click(); await page.locator('#new-world').click();
    const preview = page.getByRole('img', { name: 'Preview of the new island', exact: true });
    await expect(preview).toBeVisible();
    const pixels = () => preview.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
    const nature = page.getByLabel('Nature', { exact: true });
    await nature.selectOption('grassland');
    const grassland = await pixels();
    await nature.selectOption('permafrost');
    expect(await pixels()).not.toBe(grassland);
    await nature.selectOption('grassland');
    expect(await pixels()).toBe(grassland);
    if (query) {
      const shape = page.getByLabel('Island shape', { exact: true });
      await shape.selectOption('turtle');
      const turtle = await pixels();
      await shape.selectOption('whale');
      expect(await pixels()).not.toBe(turtle);
      await shape.selectOption('');
    }
    const displayed = await pixels();
    expect((await savedWorld(page))!.seed).toBe(previousSeed);
    // Confirming must keep the preview seed even if another random seed would differ.
    await page.evaluate(() => { crypto.getRandomValues = () => { throw new Error('Seed already chosen'); }; });
    await page.locator('#confirm-new').click();
    await expect(page.locator('#loading-screen')).toBeHidden();
    await expect.poll(async () => (await savedWorld(page))?.seed).not.toBe(previousSeed);
    const saved = (await savedWorld(page))!;
    const fromSavedMap = await page.evaluate(async terrain => {
      const terrainModule = '/src/core/terrain.ts', previewModule = '/src/render/world-preview.ts';
      const { TerrainMap } = await import(terrainModule);
      const { drawWorldPreview } = await import(previewModule);
      const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 96;
      drawWorldPreview(canvas, new TerrainMap(terrain.width, terrain.height, terrain));
      return canvas.toDataURL();
    }, saved.terrain);
    expect(fromSavedMap).toBe(displayed);
  });
}
