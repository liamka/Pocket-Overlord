import { expect, test, type Page } from '@playwright/test';
import { SAVE_VERSION, SIMULATION_SPEEDS, speedLabel, Terrain, type WorldSnapshot } from '../../src/core/types';
import { declareWar, formAlliance } from '../../src/systems/diplomacy';
import { advance, diplomaticWorld, flatWorld, migrationWorld, pioneerWorld, villageWorld } from '../helpers';
import { LANGUAGE_KEY } from '../../src/i18n';
import { assignHouse } from '../../src/systems/society';
import { migrations } from '../../src/systems/migration';
import { localizedSettlementName, settlementName } from '../../src/content/settlement-names';
import { languages } from '../../src/i18n';
import { createRegistry } from '../../src/content/defaults';
import { STORM } from '../../src/content/thunderstorms';

test.describe('undo', () => {
  test.beforeEach(async ({ page }) => { await page.routeWebSocket('**', socket => socket.close()); });
  const saveNow = async (page: Page): Promise<void> => {
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  };

  test('restores one placement at a time, ignores navigation and invalid actions, and persists the result after reload', async ({ page }) => {
    await seed(page); await expect(page.locator('#loading-screen')).toBeHidden();
    const undo = page.getByRole('button', { name: 'Отменить последнее действие', exact: true });
    await expect(undo).toBeDisabled();
    await page.mouse.click(1150, 200);
    await expect(undo).toBeDisabled();
    const first = point(20, 20), second = point(28, 20);
    await page.mouse.click(first.x, first.y);
    await saveNow(page);
    await expect.poll(async () => (await readSave(page))?.entities.length).toBe(1);
    const before = (await readSave(page))!;
    await page.mouse.click(second.x, second.y);
    await expect(page.locator('#population')).toHaveText('2');
    await page.mouse.click(1150, 200);
    await page.mouse.move(700, 250); await page.mouse.down({ button: 'right' });
    await page.mouse.move(740, 270, { steps: 4 }); await page.mouse.up({ button: 'right' });
    await page.mouse.wheel(0, -100);
    const zoom = await page.locator('#zoom-value').textContent();
    await undo.click();
    await expect(page.locator('#population')).toHaveText('1');
    await expect(undo).toBeEnabled();
    await expect(page.locator('#zoom-value')).toHaveText(zoom!);
    await expect.poll(() => readSave(page)).toEqual(before);
    await page.reload(); await expect(page.locator('#loading-screen')).toBeHidden();
    await expect(page.locator('#population')).toHaveText('1');
    await expect(undo).toBeDisabled();
    expect(await readSave(page)).toEqual(before);
  });

  test('undoes many actions in order and retains older history after a new action', async ({ page }) => {
    await seed(page); await expect(page.locator('#loading-screen')).toBeHidden();
    await expect(page.locator('#save-status')).toBeHidden();
    const before = (await readSave(page))!;
    const undo = page.locator('#undo');
    for (let i = 0; i < 32; i++) {
      const target = point(14 + i % 8 * 3, 14 + Math.floor(i / 8) * 3);
      await page.mouse.click(target.x, target.y);
    }
    await expect(page.locator('#population')).toHaveText('32');
    for (let remaining = 31; remaining >= 27; remaining--) {
      await undo.click();
      await expect(page.locator('#population')).toHaveText(String(remaining));
    }
    const target = point(36, 28); await page.mouse.click(target.x, target.y);
    await expect(page.locator('#population')).toHaveText('28');
    for (let remaining = 27; remaining >= 0; remaining--) {
      await expect(undo).toBeEnabled();
      await undo.click();
      await expect(page.locator('#population')).toHaveText(String(remaining));
    }
    await expect(undo).toBeDisabled();
    await expect.poll(() => readSave(page)).toEqual(before);
  });

  test('restores an entire brush stroke and keeps it available after a no-op stroke', async ({ page }) => {
    await seed(page); await expect(page.locator('#loading-screen')).toBeHidden();
    await expect(page.locator('#save-status')).toBeHidden();
    const before = (await readSave(page))!;
    await page.locator('[data-category="biomes"]').click();
    await page.locator('[data-tool="core:raise-land"]').click();
    const start = point(16, 24), end = point(32, 24);
    await page.mouse.click(start.x, start.y);
    await expect(page.locator('#undo')).toBeDisabled();
    await page.locator('[data-tool="core:lower-land"]').click();
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 16 }); await page.mouse.up();
    await saveNow(page);
    await expect.poll(async () => (await readSave(page))?.terrain.tiles[24 * 48 + 32]).toBe(Terrain.Water);
    const painted = (await readSave(page))!;
    for (let x = 16; x <= 32; x++) expect(painted.terrain.tiles[24 * 48 + x]).toBe(Terrain.Water);
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 16 }); await page.mouse.up();
    await page.locator('#undo').click();
    await expect.poll(() => readSave(page)).toEqual(before);
    await expect(page.locator('#undo')).toBeDisabled();
  });

  test('restores destroyed terrain and entities after an explosion while keeping current playback settings', async ({ page }) => {
    const world = flatWorld(); world.paused = true;
    world.spawn('core:house', { x: 24, y: 24 });
    await seed(page, world.snapshot()); await expect(page.locator('#loading-screen')).toBeHidden();
    await expect(page.locator('#save-status')).toBeHidden();
    const before = (await readSave(page))!;
    await page.locator('[data-category="destruction"]').click();
    await page.locator('[data-tool="core:dynamite"]').click();
    const target = point(24, 24); await page.mouse.click(target.x, target.y);
    await page.keyboard.press('4');
    await expect.poll(async () => (await readSave(page))?.terrain.tiles.includes(Terrain.Crater)).toBe(true);
    await page.keyboard.press('1');
    await page.locator('#undo').click();
    await expect.poll(() => readSave(page)).toEqual({ ...before, paused: true, speed: 4 });
    await expect(page.locator('#time-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#speed-value')).toHaveText('4×');
  });

  test('aligns the tall undo button with the desktop panel, shows its hint and clears when a new world is created', async ({ page }) => {
    await seed(page); await expect(page.locator('#loading-screen')).toBeHidden();
    const undo = page.locator('#undo'), tooltip = page.locator('#undo-tooltip');
    await undo.hover();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText('Отменить последнее действие');
    await page.keyboard.press('Escape'); await expect(tooltip).toBeHidden();
    await page.mouse.move(700, 200);
    const target = point(24, 24); await page.mouse.click(target.x, target.y);
    await expect(undo).toBeEnabled();
    await undo.focus(); await expect(tooltip).toBeVisible();
    await page.locator('#settings').focus(); await expect(tooltip).toBeHidden();
    for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      const button = (await undo.boundingBox())!, panel = (await page.locator('.panel-content').boundingBox())!;
      const settings = (await page.locator('#settings').boundingBox())!;
      expect(button.x).toBeGreaterThanOrEqual(0); expect(button.x).toBeLessThan(24);
      expect(button.y).toBeGreaterThanOrEqual(0);
      if (viewport.width > 1100) {
        expect(button.y + button.height / 2).toBeCloseTo(panel.y + panel.height / 2, 1);
        expect(button.y + button.height / 2).toBeCloseTo(settings.y + settings.height / 2, 1);
      } else expect(viewport.height - button.y - button.height).toBe(24);
      expect(button.x + button.width).toBeLessThan(panel.x);
      expect(button.height).toBeGreaterThan(settings.height * 2);
      expect(button.height).toBeLessThanOrEqual(settings.height * 2 + 12);
      expect(button.width).toBeGreaterThanOrEqual(44);
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.locator('#settings').click(); await page.locator('#new-world').click();
    await page.locator('#confirm-new').click();
    await expect(page.locator('#loading-screen')).toBeHidden();
    await expect(page.locator('#undo')).toBeDisabled();
  });
});

// Existing scenarios explicitly select Russian; fresh-install defaults are tested separately.
test.use({ storageState: { cookies: [], origins: [
  { origin: 'http://127.0.0.1:5173', localStorage: [{ name: LANGUAGE_KEY, value: 'ru' }] },
] } });

type ContentTestGlobal = typeof globalThis & { contentTest: {
  world: import('../../src/core/world').World;
  saves: import('../../src/persistence/storage').SaveService;
  renderer: import('../../src/render/renderer').Renderer;
} };

async function chooseSpeed(page: Page, speed: typeof SIMULATION_SPEEDS[number]): Promise<void> {
  await page.locator('#speed-picker').click();
  await page.getByRole('menuitemradio', { name: speedLabel(speed), exact: true }).click();
}

async function readSave(page: Page): Promise<WorldSnapshot | undefined> {
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

async function seed(page: Page, data?: unknown): Promise<void> {
  // Set up IndexedDB on a blank same-origin page before the real app starts.
  await page.route('**/storage-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Storage fixture</title>' }));
  await page.goto('/storage-fixture');
  const snapshot = data ?? { ...flatWorld().snapshot(), paused: true };
  await page.evaluate(snapshot => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('little-world', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('worlds');
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('worlds', 'readwrite');
      tx.objectStore('worlds').put(snapshot, 'last');
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
    open.onerror = () => reject(open.error);
  }), snapshot);
  await page.goto('/');
  await expect(page.locator('#save-status')).not.toHaveText('Загрузка мира…');
}

async function readBackups(page: Page): Promise<unknown[]> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('little-world', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('worlds');
      const keys = tx.objectStore('worlds').getAllKeys(), values = tx.objectStore('worlds').getAll();
      tx.oncomplete = () => { db.close(); resolve(values.result.filter((_, i) => String(keys.result[i]).startsWith('backup:'))); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
}

function point(x: number, y: number): { x: number; y: number } {
  // 48×48 fixture, 1440×960 viewport, Camera.fit caps zoom at 2.
  return { x: 720 + (x - 24) * 16, y: 960 * 0.46 + (y - 24) * 16 };
}

async function badgeColors(page: Page, position: { x: number; y: number }, width = 48, height = 48): Promise<{ white: number; heart: number; weapon: number }> {
  return page.evaluate(({ position, width, height }) => {
    const canvas = document.querySelector<HTMLCanvasElement>('#world')!;
    const w = canvas.clientWidth, h = canvas.clientHeight, dpr = canvas.width / w;
    const zoom = Math.max(0.175, Math.min(2, w / (width * 8 * 0.93), (h - 220) / (height * 8 * 0.93)));
    const x = Math.round(w / 2 - width / 2 * 8 * zoom) + (Math.round(position.x * 8) - 9) * zoom;
    const y = Math.round((h - 200) / 2 - height / 2 * 8 * zoom) + (Math.round(position.y * 8) - 37) * zoom;
    const pixels = canvas.getContext('2d')!.getImageData(Math.floor(x * dpr), Math.floor(y * dpr), Math.ceil(19 * zoom * dpr), Math.ceil(22 * zoom * dpr)).data;
    const result = { white: 0, heart: 0, weapon: 0 };
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] === 255 && pixels[i + 1] === 246 && pixels[i + 2] === 219) result.white++;
      if (pixels[i] === 232 && pixels[i + 1] === 88 && pixels[i + 2] === 120) result.heart++;
      if (pixels[i] === 82 && pixels[i + 1] === 97 && pixels[i + 2] === 107) result.weapon++;
    }
    return result;
  }, { position, width, height });
}

test('a new couple gets one brief heart that pauses with the world and then expires', async ({ page }) => {
  const world = flatWorld(), house = world.spawn('core:house', { x: 24, y: 24 })!, village = assignHouse(world, house);
  const positions = [{ x: 20, y: 24 }, { x: 28, y: 24 }];
  for (const [i, position] of positions.entries()) {
    const person = world.spawn('core:person', position)!;
    person.components.person!.homeId = house.id; person.components.person!.sex = i ? 'b' : 'a'; person.components.person!.reproduceIn = 999;
    person.components.citizen!.villageId = village.id; person.components.motion!.speed = 0;
  }
  await seed(page, { ...world.snapshot(), paused: true });
  for (const p of positions) expect((await badgeColors(page, p)).heart).toBe(0);
  await page.keyboard.press('2');
  await expect(page.locator('#families')).toHaveText('1');
  await page.keyboard.press('1');
  const colors = await badgeColors(page, positions[0]); expect(colors.heart).toBeGreaterThan(20); expect(colors.white).toBeGreaterThan(100);
  expect((await badgeColors(page, positions[1])).heart).toBe(0);
  await page.waitForTimeout(1200);
  expect((await badgeColors(page, positions[0])).heart).toBeGreaterThan(20);
  expect((await badgeColors(page, positions[1])).heart).toBe(0);
  await page.keyboard.press('4');
  await expect.poll(async () => (await badgeColors(page, positions[0])).heart).toBe(0);
  await page.keyboard.press('1');
  for (const p of positions) expect((await badgeColors(page, p)).white).toBe(0);
});

test('weapons survive loading without permanent pregnancy hearts or fire badges', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const world = diplomaticWorld(4);
  formAlliance(world, 1, 2); declareWar(world, 1, 3); advance(world, 1);
  const people = [...world.query('person')];
  for (const e of people) e.components.motion!.speed = 0;
  const soldier = people.find(e => e.components.citizen!.task === 'fight' && e.components.citizen!.villageId === 2)!;
  const mother = people.find(e => e.components.citizen!.villageId === 4 && e.components.person!.sex === 'a')!;
  mother.components.citizen!.pregnancy = 4; mother.components.citizen!.fatherId = mother.components.citizen!.partnerId;
  const burning = people.find(e => e.components.citizen!.villageId === 4 && e.id !== mother.id && e.components.person!.sex === 'b')!;
  burning.components.thermal!.burning = true; burning.components.thermal!.temperature = 100;
  await seed(page, { ...world.snapshot(), paused: true });
  for (let reload = 0; reload < 2; reload++) {
    await expect.poll(async () => (await badgeColors(page, soldier.components.position!, 96, 64)).weapon).toBeGreaterThan(20);
    expect((await badgeColors(page, soldier.components.position!, 96, 64)).white).toBeGreaterThan(100);
    expect((await badgeColors(page, mother.components.position!, 96, 64)).heart).toBe(0);
    expect((await badgeColors(page, burning.components.position!, 96, 64)).white).toBe(0);
    if (!reload) await page.reload();
  }
  expect(errors).toEqual([]);
});

test('several couples in a crowd show no more heart pixels than one couple', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const counts: number[] = [];
  for (const count of [2, 8]) {
    const world = flatWorld();
    const homes = [24, 28].map(x => world.spawn('core:house', { x, y: 18 })!);
    homes.forEach(home => assignHouse(world, home));
    for (let i = 0; i < count; i++) {
      const e = world.spawn('core:person', { x: 20 + i % 4 * 0.6, y: 25 + Math.floor(i / 4) * 0.6 })!;
      Object.assign(e.components.person!, { homeId: homes[Math.floor(i / 4)].id, sex: i % 2 ? 'b' : 'a', reproduceIn: 999 });
      e.components.citizen!.villageId = 1; e.components.motion!.speed = 0;
    }
    await seed(page, { ...world.snapshot(), paused: true });
    await page.keyboard.press('2'); await expect(page.locator('#families')).toHaveText(String(count / 2));
    await page.keyboard.press('1');
    counts.push(await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('#world')!, pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let hearts = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 232 && pixels[i + 1] === 88 && pixels[i + 2] === 120) hearts++;
      return hearts;
    }));
  }
  expect(counts[0]).toBeGreaterThan(20); expect(counts[1]).toBe(counts[0]); expect(errors).toEqual([]);
});

for (const paused of [false, true]) {
  test(`ten rapid clicks at one point spawn ten people (paused: ${paused})`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await seed(page, { ...flatWorld().snapshot(), paused });
    await expect(page.locator('#zoom-value')).toHaveText('200%');
    const target = point(20, 20);
    for (let i = 0; i < 10; i++) {
      await page.mouse.click(target.x, target.y);
      if (i < 9) await page.waitForTimeout(150);
    }
    await expect(page.locator('#population')).toHaveText('10');
    expect(errors).toEqual([]);
  });
}

test('sea placement, swimming, drowning and underwater explosions survive paused autosave', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const world = flatWorld();
  for (let y = 0; y < 48; y++) for (let x = 24; x < 48; x++) world.terrain.set(x, y, x < 28 ? Terrain.Water : Terrain.DeepWater);
  await seed(page, { ...world.snapshot(), paused: true });
  for (let i = 0; i < 10; i++) await page.mouse.click(...Object.values(point(39.5, 20.5)) as [number, number]);
  await page.mouse.click(...Object.values(point(26.5, 32.5)) as [number, number]);
  await expect(page.locator('#population')).toHaveText('11');
  await page.locator('[data-category="destruction"]').click(); await page.getByRole('button', { name: 'Динамит', exact: true }).click(); await page.mouse.click(...Object.values(point(35, 10)) as [number, number]);
  await page.locator('[data-category="destruction"]').click(); await page.getByRole('button', { name: 'Ракета', exact: true }).click(); await page.mouse.click(...Object.values(point(40, 36)) as [number, number]);
  await expect.poll(async () => (await readSave(page))?.entities.filter(e => e.components.explosive).length, { timeout: 7000 }).toBe(2);
  const stopped = (await readSave(page))!;
  expect(stopped.tick).toBe(0); expect(stopped.entities.filter(e => e.components.person)).toHaveLength(11);
  expect(stopped.entities.filter(e => e.components.explosive).map(e => e.components.explosive!.fuse)).toEqual([2, 1.25]);
  await page.reload(); await expect(page.locator('#population')).toHaveText('11');
  await expect(page.locator('#time-toggle')).toHaveAttribute('aria-pressed', 'true');
  await chooseSpeed(page, 4);
  await expect(page.locator('#population')).toHaveText('1');
  await page.locator('.speed-controls').getByRole('button', { name: 'Стоп', exact: true }).click();
  await expect.poll(async () => (await readSave(page))?.entities.filter(e => e.components.person).length, { timeout: 7000 }).toBe(1);
  const saved = (await readSave(page))!, survivor = saved.entities.find(e => e.components.person)!;
  expect(survivor.components.position!.x).toBeLessThan(24);
  expect(saved.entities.filter(e => e.components.explosive)).toHaveLength(0);
  expect(saved.terrain.tiles.filter((_, i) => i % 48 >= 24)).toEqual(stopped.terrain.tiles.filter((_, i) => i % 48 >= 24));
  expect(errors).toEqual([]);
});

test('caravan travels between settlements, survives reload and delivers its cargo once', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const world = villageWorld();
  world.terrain.tiles.fill(Terrain.Sand);
  for (const road of world.society.roads) {
    road.built = road.tiles.length;
    for (const i of road.tiles) world.terrain.tiles[i] = Terrain.Road;
  }
  for (const person of world.query('person', 'motion')) person.components.motion!.speed = 0;
  for (const relation of world.society.relations) relation.nextDecision = 100000;
  world.society.villages[0].food = 60; world.society.villages[1].food = 0; world.tick = 899; world.paused = true;
  await seed(page, world.snapshot());
  await chooseSpeed(page, 4);
  await expect(page.locator('#caravan-count')).toHaveText('1');
  await page.locator('.speed-controls').getByRole('button', { name: 'Стоп', exact: true }).click();
  await expect.poll(async () => (await readSave(page))?.entities.filter(e => e.components.caravan).length, { timeout: 7000 }).toBe(1);
  const departed = (await readSave(page))!;
  expect(departed.society.villages.map(v => v.food)).toEqual([48, 0]);
  expect(departed.entities.find(e => e.components.caravan)!.components.caravan!.food).toBe(12);
  await page.reload(); await expect(page.locator('#caravan-count')).toHaveText('1');
  expect((await readSave(page))!.entities.find(e => e.components.caravan)).toEqual(departed.entities.find(e => e.components.caravan));
  await chooseSpeed(page, 4);
  await expect(page.locator('#chronicle')).toContainText('доставлено еды — 12');
  await page.locator('.speed-controls').getByRole('button', { name: 'Стоп', exact: true }).click();
  await expect.poll(async () => (await readSave(page))?.society.villages[1].food, { timeout: 7000 }).toBe(12);
  const delivered = (await readSave(page))!, wagon = delivered.entities.find(e => e.components.caravan)!;
  expect(wagon.components.caravan!.returning).toBe(true); expect(wagon.components.caravan!.food).toBe(0);
  expect(wagon.components.position!.x).toBeGreaterThan(departed.entities.find(e => e.components.caravan)!.components.position!.x);
  await page.reload(); await expect(page.locator('#caravan-count')).toHaveText('1');
  await chooseSpeed(page, 4);
  await expect(page.locator('#caravan-count')).toHaveText('0');
  await page.locator('.speed-controls').getByRole('button', { name: 'Стоп', exact: true }).click();
  await expect.poll(async () => (await readSave(page))?.entities.filter(e => e.components.caravan).length, { timeout: 7000 }).toBe(0);
  expect((await readSave(page))!.society.villages.map(v => v.food)).toEqual([48, 12]);
  expect(errors).toEqual([]);
});

test('dynamite breaks a road and residents repair it after walking there, including across reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const world = villageWorld(), road = world.society.roads[0];
  for (let i = 0; i < world.terrain.tiles.length; i++) world.terrain.set(i % 48, Math.floor(i / 48), Terrain.Sand);
  for (const r of world.society.relations) r.nextDecision = 1e9;
  for (const v of world.society.villages) v.food = 500;
  for (const e of world.query('person')) e.components.person!.sex = 'b';
  road.built = road.tiles.length;
  for (const i of road.tiles) world.terrain.set(i % 48, Math.floor(i / 48), Terrain.Road);
  const middle = road.tiles[Math.floor(road.tiles.length / 2)];
  await seed(page, { ...world.snapshot(), paused: true });
  await expect(page.locator('#relations')).toContainText('Дорог 1');
  await page.locator('[data-category="destruction"]').click(); await page.getByRole('button', { name: 'Динамит', exact: true }).click();
  await page.mouse.click(...Object.values(point(middle % 48 + 0.5, Math.floor(middle / 48) + 0.5)) as [number, number]);
  await page.keyboard.press('4');
  await expect(page.locator('#relations')).toContainText('Дорог 0');
  await page.keyboard.press('1');
  await expect.poll(async () => (await readSave(page))?.terrain.tiles[middle], { timeout: 7000 }).toBe(Terrain.Crater);
  const broken = (await readSave(page))!;
  expect(road.tiles.filter(i => broken.terrain.tiles[i] !== Terrain.Road).length).toBeGreaterThan(4);
  await page.keyboard.press('2');
  await expect.poll(async () => (await readSave(page))?.entities.some(e => e.components.citizen?.repair), { timeout: 15000 }).toBe(true);
  await page.keyboard.press('1');
  await expect.poll(async () => (await readSave(page))?.paused, { timeout: 7000 }).toBe(true);
  const working = (await readSave(page))!;
  expect(working.entities.some(e => e.components.citizen?.repair)).toBe(true);
  await page.reload();
  await expect(page.locator('#time-toggle')).toHaveAttribute('aria-pressed', 'true');
  expect(await readSave(page)).toEqual(working);
  await page.keyboard.press('4');
  await expect(page.locator('#relations')).toContainText('Дорог 1', { timeout: 20000 });
  await page.keyboard.press('1');
  await expect.poll(async () => {
    const saved = await readSave(page);
    return saved?.paused && road.tiles.every(i => saved.terrain.tiles[i] === Terrain.Road);
  }, { timeout: 7000 }).toBe(true);
  const repaired = (await readSave(page))!;
  expect(repaired.terrain.recovery.some(s => road.tiles.includes(s.index))).toBe(false);
  expect(errors).toEqual([]);
});

test('time menu selects every speed, steps with arrows and restores a paused maximum speed', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await seed(page, { ...flatWorld().snapshot(), version: 11, speed: 5000, paused: true });
  await expect(page.locator('#speed-value')).toHaveText('40×');
  await expect(page.locator('#time-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#speed-menu')).toBeHidden();
  for (const speed of SIMULATION_SPEEDS) {
    await chooseSpeed(page, speed);
    await expect(page.locator('#speed-value')).toHaveText(speedLabel(speed));
    await expect(page.locator('#speed-picker')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#time-toggle')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#time-toggle').click();
    await expect(page.locator('#time-toggle')).toHaveAttribute('aria-label', 'Старт');
  }
  await expect(page.locator('#time-faster')).toBeDisabled();
  await page.locator('#time-slower').click();
  await expect(page.locator('#speed-value')).toHaveText('10×');
  await page.locator('#time-faster').click();
  await expect(page.locator('#speed-value')).toHaveText('40×');
  await page.locator('#time-toggle').click();
  await expect.poll(async () => { const s = await readSave(page); return s?.paused && s.speed === 40 && s.tick > 0; }, { timeout: 7000 }).toBe(true);
  const saved = (await readSave(page))!;
  expect(saved.tick).toBeGreaterThan(0);
  await page.reload();
  await expect(page.locator('#speed-value')).toHaveText('40×');
  await expect(page.locator('#time-toggle')).toHaveAttribute('aria-pressed', 'true');
  expect((await readSave(page))!.tick).toBe(saved.tick);
  await page.locator('#time-toggle').click();
  await expect(page.locator('#speed-value')).toHaveText('40×');
  await page.locator('#time-toggle').click();
  await chooseSpeed(page, 0.2);
  await expect(page.locator('#time-slower')).toBeDisabled();
  await page.locator('#time-faster').click();
  await expect(page.locator('#speed-value')).toHaveText('1×');
  await page.keyboard.press('1');
  expect(errors).toEqual([]);
});

test('time menu supports keyboard navigation, dismissal and fits compact screens', async ({ page }) => {
  await seed(page);
  await page.locator('#speed-picker').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: '1×', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page.locator('#speed-value')).toHaveText('⅕×');
  await expect(page.locator('#speed-picker')).toBeFocused();
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('End');
  await expect(page.getByRole('menuitemradio', { name: '40×', exact: true })).toBeFocused();
  await page.keyboard.press('Home'); await page.keyboard.press('Escape');
  await expect(page.locator('#speed-menu')).toBeHidden();
  await expect(page.locator('#speed-value')).toHaveText('⅕×');
  await page.locator('#speed-picker').click();
  await page.locator('[data-category="destruction"]').click(); await page.getByRole('button', { name: 'Динамит', exact: true }).click();
  await expect(page.locator('#speed-menu')).toBeHidden();
  await page.locator('#speed-picker').click(); await page.keyboard.press('Tab');
  await expect(page.locator('#speed-menu')).toBeHidden();
  for (const [width, height] of [[1440, 960], [900, 650], [700, 500]]) {
    await page.setViewportSize({ width, height });
    await page.locator('#speed-picker').click();
    const box = (await page.locator('#speed-menu').boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThan(width); expect(box.y + box.height).toBeLessThan(height);
    await page.keyboard.press('Escape');
  }
});

test('number keys and numpad set speed without changing tools or acting inside settings', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await seed(page);
  await page.locator('[data-category="destruction"]').click(); await page.getByRole('button', { name: 'Динамит', exact: true }).click();
  await expect(page.locator('.tool kbd')).toHaveCount(0);
  await expect(page.locator('#tool-key')).toBeHidden();
  await expect(page.locator('.selected-power')).toHaveCount(0);
  const controls = page.locator('.speed-controls');
  await expect(controls.getByRole('button')).toHaveCount(4);
  for (const prefix of ['', 'Numpad']) for (const [key, speed] of [['4', 4], ['3', 2], ['2', 1], ['1', 0]] as const) {
    await page.keyboard.press(`${prefix}${key}`);
    await expect(page.locator('#time-toggle')).toHaveAttribute('aria-pressed', String(speed === 0));
    if (speed) await expect(page.locator(`[data-speed="${speed}"]`)).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#speed-menu [aria-checked="true"]')).toHaveCount(1);
    await expect(page.locator('#tool-name')).toHaveText('Динамит');
  }
  for (const modifier of ['Control', 'Alt', 'Meta']) {
    await page.keyboard.press(`${modifier}+3`);
    await expect(page.locator('#time-toggle')).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  for (const key of ['2', '3', '4']) {
    await page.keyboard.press(key);
    await expect(page.locator('#time-toggle')).toHaveAttribute('aria-pressed', 'true');
  }
  await page.keyboard.press('Escape');
  await page.locator('#world').focus();
  await page.keyboard.press('4'); await page.keyboard.press('Space');
  await expect(page.locator('#time-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await expect(page.locator('[data-speed="4"]')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('1');
  expect(errors).toEqual([]);
});

for (const speed of [1, 2, 4]) {
  test(`speed keys queue bombs while stopped and run at ${speed}x`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await seed(page);
    const controls = page.locator('.speed-controls');
    await expect(controls.getByRole('button')).toHaveCount(4);
    await page.keyboard.press('1');
    await expect(page.locator('#time-toggle')).toHaveAttribute('aria-pressed', 'true');
    const box = (await controls.boundingBox())!;
    const panel = (await page.locator('.game-panel').boundingBox())!;
    expect(box.x).toBeGreaterThan(1100); expect(box.y).toBeGreaterThan(0); expect(box.y + box.height).toBeLessThan(panel.y);
    await page.locator('[data-category="destruction"]').click(); await page.getByRole('button', { name: 'Динамит', exact: true }).click();
    for (const [x, y] of [[12, 15], [20, 15]]) await page.mouse.click(...Object.values(point(x, y)) as [number, number]);
    await page.locator('[data-category="destruction"]').click(); await page.getByRole('button', { name: 'Ракета', exact: true }).click();
    for (const [x, y] of [[30, 32], [38, 32]]) await page.mouse.click(...Object.values(point(x, y)) as [number, number]);
    await expect.poll(async () => (await readSave(page))?.entities.filter(e => e.components.explosive).length, { timeout: 7000 }).toBe(4);
    const stopped = (await readSave(page))!;
    expect(stopped.tick).toBe(0);
    expect(stopped.entities.filter(e => e.components.explosive).map(e => e.components.explosive!.fuse)).toEqual([2, 2, 1.25, 1.25]);
    // Measure browser key events so automation latency is not counted as a game-speed bug.
    await page.evaluate(() => document.addEventListener('keydown', event => {
      if (['1', '2', '3', '4'].includes(event.key)) performance.mark(event.key === '1' ? 'playback-stop' : 'playback-start');
    }, { capture: true }));
    await page.keyboard.press(speed === 1 ? '2' : speed === 2 ? '3' : '4');
    await expect(page.locator('#speed-value')).toHaveText(`${speed}×`);
    await expect(page.locator('#tool-name')).toHaveText('Ракета');
    await page.waitForTimeout(750);
    await page.keyboard.press('1');
    const elapsed = await page.evaluate(() => (performance.getEntriesByName('playback-stop').at(-1)!.startTime - performance.getEntriesByName('playback-start').at(-1)!.startTime) / 1000);
    await expect.poll(async () => { const s = await readSave(page); return !!s && s.tick > 0 && s.paused; }, { timeout: 7000 }).toBe(true);
    const saved = (await readSave(page))!;
    expect(saved.tick).toBeGreaterThan(18 * speed);
    expect(Math.abs(saved.tick - elapsed * 30 * speed)).toBeLessThan(4 * speed);
    expect(saved.speed).toBe(speed);
    expect(saved.entities.filter(e => e.components.explosive)).toHaveLength((saved.tick < 38 ? 2 : 0) + (saved.tick < 60 ? 2 : 0));
    if (speed === 4) expect(saved.terrain.tiles).toContain(Terrain.Crater);
    await page.reload();
    await expect(page.locator('#time-toggle')).toHaveAttribute('aria-pressed', 'true');
    expect((await readSave(page))?.tick).toBe(saved.tick);
    await page.locator('#world').focus(); await page.keyboard.press('Space');
    await expect(page.locator('#speed-value')).toHaveText(`${speed}×`);
    await chooseSpeed(page, 1);
    await expect(page.locator('#speed-value')).toHaveText('1×');
    await page.keyboard.press('1');
    await page.setViewportSize({ width: 900, height: 650 });
    const compactPanel = (await page.locator('.game-panel').boundingBox())!;
    for (const button of await controls.getByRole('button').all()) {
      const bounds = (await button.boundingBox())!;
      expect(bounds.x).toBeGreaterThan(650); expect(bounds.x + bounds.width).toBeLessThan(900);
      expect(bounds.y).toBeGreaterThan(0); expect(bounds.y + bounds.height).toBeLessThan(compactPanel.y);
    }
    expect(errors).toEqual([]);
  });
}

test('village statistics stay hidden while their data and simulation survive reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const world = villageWorld(); advance(world, 30);
  await seed(page, world.snapshot());
  await expect(page.locator('#village-count')).toHaveText('2');
  await expect(page.locator('#society-panel')).toBeHidden();
  const stats = (await page.locator('.world-stats').boundingBox())!;
  expect(stats.y).toBe(12); expect(stats.x).toBe(12);
  await expect.poll(async () => Number(await page.locator('#families').textContent())).toBeGreaterThan(0);
  await expect.poll(async () => Number(await page.locator('#fields').textContent())).toBeGreaterThan(1);
  await expect(page.locator('#relations')).toContainText('Дорог 1');
  await expect.poll(async () => Number(await page.locator('#children').textContent()), { timeout: 15000 }).toBeGreaterThan(0);
  await expect(page.locator('#chronicle')).toContainText('родился ребёнок');
  await page.locator('.speed-controls').getByRole('button', { name: 'Стоп', exact: true }).click();
  await expect.poll(async () => (await readSave(page))?.paused, { timeout: 7000 }).toBe(true);
  const saved = (await readSave(page))!;
  expect(saved.society.villages.some(v => v.harvested > 0)).toBe(true);
  await page.reload();
  await expect(page.locator('#village-count')).toHaveText('2');
  await expect(page.locator('#society-panel')).toBeHidden();
  await expect(page.locator('#population')).toHaveText(String(saved.entities.filter(e => e.components.person).length));
  await expect(page.locator('#time-toggle')).toHaveAttribute('aria-pressed', 'true');
  expect((await readSave(page))?.society).toEqual(saved.society);
  await page.setViewportSize({ width: 900, height: 650 });
  const compactStats = (await page.locator('.world-stats').boundingBox())!;
  expect(compactStats.y).toBe(12); expect(compactStats.x).toBe(12);
  await expect(page.locator('#society-panel')).toBeHidden();
  expect(errors).toEqual([]);
});

test('settlement cultivates its only nearby fertile patch', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const world = villageWorld([{ x: 24, y: 24 }]);
  world.terrain.tiles.fill(Terrain.Sand);
  for (let y = 23; y <= 25; y++) for (let x = 32; x <= 34; x++) world.terrain.set(x, y, Terrain.Grass);
  await seed(page, world.snapshot());
  await expect(page.locator('#fields')).toHaveText('0');
  await expect(page.locator('#fields')).toHaveText('1', { timeout: 7000 });
  await expect.poll(async () => (await readSave(page))?.entities.find(e => e.components.farm)?.components.position, { timeout: 7000 }).toEqual({ x: 33.5, y: 24.5 });
  await expect.poll(async () => (await readSave(page))?.society.villages[0].harvested ?? 0, { timeout: 30000 }).toBeGreaterThan(0);
  await expect(page.locator('#chronicle')).toContainText('урожай');
  expect(errors).toEqual([]);
});

test('blast landscape recovers gradually, survives reload and pauses with the world', async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const world = flatWorld();
  world.command({ kind: 'use-tool', toolId: 'core:dynamite', x: 18, y: 22 });
  world.command({ kind: 'use-tool', toolId: 'core:rocket', x: 30, y: 22 });
  advance(world, 2); world.command({ kind: 'speed', speed: 0 });
  const initial = world.snapshot(), initialDamage = initial.terrain.recovery.length;
  expect(initialDamage).toBeGreaterThan(100);
  await seed(page, initial);
  await chooseSpeed(page, 4);
  await expect.poll(async () => {
    const save = await readSave(page);
    return !!save && save.terrain.recovery.length > 0 && save.terrain.recovery.length < initialDamage;
  }, { timeout: 36000 }).toBe(true);
  await page.locator('.speed-controls').getByRole('button', { name: 'Стоп', exact: true }).click();
  await expect.poll(async () => { const s = await readSave(page); return !!s && s.tick > initial.tick && s.paused; }, { timeout: 7000 }).toBe(true);
  const partial = (await readSave(page))!;
  expect(partial.terrain.recovery.some(state => state.age > 0)).toBe(true);
  expect(partial.terrain.tiles).toContain(Terrain.Crater);
  await page.reload();
  await expect(page.locator('#time-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(5200);
  expect((await readSave(page))?.terrain).toEqual(partial.terrain);
  await chooseSpeed(page, 4);
  await expect.poll(async () => (await readSave(page))?.terrain.recovery.length, { timeout: 96000 }).toBe(0);
  const recovered = (await readSave(page))!;
  expect(recovered.terrain.tiles.every(tile => tile === Terrain.Grass)).toBe(true);
  expect(recovered.entities).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('three alliances gather for a common campaign and preserve their war on reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const world = diplomaticWorld();
  for (const [a, b] of [[1, 2], [3, 4], [5, 6], [7, 8]]) formAlliance(world, a, b);
  declareWar(world, 1, 7); declareWar(world, 3, 7); declareWar(world, 5, 8);
  await seed(page, world.snapshot());
  await expect(page.locator('#alliance-count')).toHaveText('4');
  await expect(page.locator('#war-count')).toHaveText('1');
  await expect(page.locator('.alliance-card')).toHaveCount(4);
  await expect(page.locator('.campaign-card')).toHaveCount(1);
  await expect(page.locator('#campaigns')).toContainText('Сбор войск · 6 против 2');
  for (const village of world.society.villages) await expect(page.locator('#campaigns')).toContainText(localizedSettlementName(world.seed, village, 'ru'));
  await expect(page.locator('#campaigns')).toContainText('Совместный поход · 6 против 2', { timeout: 15000 });
  await page.locator('.speed-controls').getByRole('button', { name: 'Стоп', exact: true }).click();
  await expect.poll(async () => (await readSave(page))?.paused, { timeout: 7000 }).toBe(true);
  const saved = (await readSave(page))!;
  expect(saved.society.wars[0].attackers).toEqual([1, 2, 3, 4, 5, 6]);
  expect(saved.society.wars[0].defenders).toEqual([7, 8]);
  await page.reload();
  await expect(page.locator('#time-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#alliance-count')).toHaveText('4');
  await expect(page.locator('#campaigns')).toContainText('Совместный поход · 6 против 2');
  expect((await readSave(page))?.society).toEqual(saved.society);
  await page.setViewportSize({ width: 900, height: 650 });
  await expect(page.locator('#society-panel')).toBeHidden();
  await expect(page.locator('.campaign-card')).toHaveCount(1);
  expect(await page.locator('body').evaluate(e => e.scrollWidth)).toBe(900);
  expect(errors).toEqual([]);
});

test('thunderstorm replaces rain, draws lightning, burns objects and restores its paused state', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.routeWebSocket('**', socket => socket.close());
  const world = flatWorld(); world.paused = true;
  const targets = ['core:person', 'core:house', 'core:tree'].map(type => world.spawn(type, { x: 24, y: 24 })!);
  targets[0].components.motion!.speed = 0;
  await seed(page, world.snapshot()); await expect(page.locator('#loading-screen')).toBeHidden();
  await page.locator('[data-category="destruction"]').click();
  const tool = page.getByRole('button', { name: 'Гроза', exact: true });
  await tool.click();
  await expect(page.locator('[data-category="nature"]')).toHaveCount(0);
  await expect(tool).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Дождь', exact: true })).toHaveCount(0);
  await expect(page.locator('#tool-hint')).toContainText('Молнии поджигают');
  const target = await page.locator('#world').evaluate(canvas => ({ x: canvas.clientWidth / 2, y: (canvas.clientHeight - 200) / 2 }));
  await page.mouse.click(target.x, target.y);
  const lightningPixels = () => page.locator('#world').evaluate((canvas, target) => {
    const surface = canvas as HTMLCanvasElement, scale = surface.width / surface.clientWidth;
    const image = surface.getContext('2d')!.getImageData((target.x - 56) * scale, (target.y - 90) * scale, 112 * scale, 50 * scale);
    let count = 0;
    for (let i = 0; i < image.data.length; i += 4) if (image.data[i] > 220 && image.data[i + 1] > 210 && image.data[i + 2] > 150) count++;
    return count;
  }, target);
  expect(await lightningPixels()).toBe(0);
  await page.locator('#world').focus(); await page.keyboard.press('2');
  await expect.poll(lightningPixels, { intervals: [50] }).toBeGreaterThan(5);
  await page.keyboard.press('1');
  await expect(page.locator('#time-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect.poll(async () => (await readSave(page))?.entities.filter(e => e.components.thermal?.burning).length).toBe(3);
  const saved = (await readSave(page))!;
  expect(saved.scenarios.some(scenario => scenario.id === STORM.id)).toBe(true);
  expect(saved.effects).toHaveLength(0);
  for (const original of targets) {
    const burnt = saved.entities.find(entity => entity.id === original.id)!;
    expect(burnt.components.thermal!.burning).toBe(true);
    expect(burnt.components.health!.current).toBeLessThan(original.components.health!.current);
  }
  await page.mouse.move(100, 100);
  await page.screenshot({ path: '/tmp/pocket-overlord-thunderstorm.png' });
  await page.reload(); await expect(page.locator('#loading-screen')).toBeHidden();
  await expect(tool).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-category="destruction"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(lightningPixels).toBeGreaterThan(5);
  expect((await readSave(page))?.scenarios).toEqual(saved.scenarios);
  expect(errors).toEqual([]);
});

test('four tools, keyboard, pause, camera, settlement and autosave reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await seed(page);
  await expect(page.locator('#zoom-value')).toHaveText('200%');
  await expect(page.getByRole('button', { name: 'Человек', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(...Object.values(point(20, 20)) as [number, number]);
  await page.mouse.click(...Object.values(point(22, 20)) as [number, number]);
  await expect(page.locator('#population')).toHaveText('2');
  await page.locator('[data-category="destruction"]').click(); await page.getByRole('button', { name: 'Динамит', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Динамит', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(...Object.values(point(35, 35)) as [number, number]);
  await expect.poll(async () => (await readSave(page))?.entities.filter(e => e.components.explosive).length, { timeout: 7000 }).toBe(1);
  await page.reload();
  await expect(page.locator('#population')).toHaveText('2');
  await expect(page.locator('#time-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await readSave(page))?.entities.find(e => e.components.explosive)?.components.explosive?.fuse).toBe(2);
  await page.locator('.speed-controls').getByRole('button', { name: 'Старт', exact: true }).click();
  await expect.poll(async () => (await readSave(page))?.terrain.tiles.includes(5), { timeout: 8000 }).toBe(true);
  await expect.poll(async () => Number(await page.locator('#houses').innerText()), { timeout: 15000 }).toBeGreaterThan(0);
  await page.locator('[data-category="destruction"]').click(); await page.getByRole('button', { name: 'Гроза', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Гроза', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(...Object.values(point(35, 35)) as [number, number]);
  await page.mouse.down(); await page.waitForTimeout(400); await page.mouse.up();
  await page.locator('[data-category="destruction"]').click(); await page.getByRole('button', { name: 'Ракета', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ракета', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(...Object.values(point(35, 15)) as [number, number]);
  await page.waitForTimeout(1500);
  const zoom = await page.locator('#zoom-value').innerText();
  await page.mouse.wheel(0, -250); await expect(page.locator('#zoom-value')).not.toHaveText(zoom);
  await page.mouse.down({ button: 'right' }); await page.mouse.move(800, 500, { steps: 4 }); await page.mouse.up({ button: 'right' });
  await page.locator('#world').focus(); await page.keyboard.press('Space');
  await expect(page.locator('#time-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#settings').click();
  await page.getByRole('button', { name: 'Новый мир', exact: true }).click();
  await expect(page.locator('#settings-dialog')).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Начать новый мир?' })).toBeVisible();
  await page.getByRole('button', { name: 'Оставить этот' }).click();
  await expect(page.locator('#population')).not.toHaveText('0');
  await page.locator('#settings').click();
  await page.getByRole('button', { name: 'Новый мир', exact: true }).click();
  await expect(page.locator('#settings-dialog')).toBeHidden();
  await page.getByRole('button', { name: 'Создать мир', exact: true }).click();
  await expect(page.locator('#population')).toHaveText('0');
  await expect(page.locator('#save-status')).toBeHidden();
  const islandSeed = (await readSave(page))!.seed;
  await page.locator('#settings').click();
  await page.getByRole('button', { name: 'Новый мир', exact: true }).click();
  await expect(page.locator('#settings-dialog')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Начать новый мир?' })).toBeHidden();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect((await readSave(page))!.seed).toBe(islandSeed);
  expect(errors).toEqual([]);
});

for (const version of [999, SAVE_VERSION]) {
  test(`autosaves after an unreadable save and preserves its backup (version: ${version})`, async ({ page }) => {
    const raw = { version, valuable: 'preserve-this' };
    await seed(page, raw);
    await expect(page.locator('#save-warning')).toBeHidden();
    await expect(page.locator('#save-status')).toBeHidden();
    await page.locator('.speed-controls').getByRole('button', { name: 'Стоп', exact: true }).click();
    await expect.poll(async () => (await readSave(page))?.paused, { timeout: 7000 }).toBe(true);
    await expect(page.locator('#save-warning')).toBeHidden();
    expect(await readBackups(page)).toEqual([raw]);
    const saved = (await readSave(page))!;
    expect(saved.version).toBe(SAVE_VERSION);
    await page.reload();
    await expect(page.locator('#time-toggle')).toHaveAttribute('aria-pressed', 'true');
    expect((await readSave(page))!.seed).toBe(saved.seed);
    expect(await readBackups(page)).toEqual([raw]);
    await page.locator('#settings').click();
    await page.getByRole('button', { name: 'Новый мир', exact: true }).click();
    await expect(page.locator('#settings-dialog')).toBeHidden();
    await page.getByRole('button', { name: 'Оставить этот' }).click();
    expect(await readSave(page)).toEqual(saved);
    await page.locator('#settings').click();
    await page.getByRole('button', { name: 'Новый мир', exact: true }).click();
    await expect(page.locator('#settings-dialog')).toBeHidden();
    await page.getByRole('button', { name: 'Создать мир', exact: true }).click();
    await expect(page.locator('#save-status')).toBeHidden();
    await expect(page.locator('#save-warning')).toBeHidden();
    expect((await readSave(page))?.version).toBe(SAVE_VERSION);
    expect(await readBackups(page)).toEqual([raw]);
  });
}

test('Napalm Airstrike can be selected, saved on pause and resumed after reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await seed(page, { ...flatWorld().snapshot(), paused: true, speed: 0.2 });
  await page.getByRole('button', { name: 'Разрушение', exact: true }).click();
  const tool = page.getByRole('button', { name: 'Напалмовый авиаудар', exact: true });
  await tool.click();
  await expect(tool).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#tool-hint')).toContainText('сброса 15 напалмовых бомб');
  const icon = await tool.locator('canvas').evaluate(canvas => {
    const pixels = (canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 64, 64).data;
    return pixels.some((value, index) => index % 4 === 3 && value > 0);
  });
  expect(icon).toBe(true);
  await page.mouse.click(...Object.values(point(24, 24)) as [number, number]);
  await expect.poll(async () => (await readSave(page))?.scenarios.some(scenario => scenario.id === 'core:napalm-strike')).toBe(true);
  await page.reload();
  await expect(page.locator('#time-toggle')).toHaveAttribute('aria-pressed', 'true');
  expect((await readSave(page))!.terrain.tiles.every(tile => tile === Terrain.Grass)).toBe(true);
  await page.locator('.speed-controls').getByRole('button', { name: 'Старт', exact: true }).click();
  await expect.poll(async () => (await readSave(page))?.entities.some(entity => entity.typeId === 'core:napalm-fire'), { timeout: 18000 }).toBe(true);
  expect((await readSave(page))!.terrain.tiles).toContain(Terrain.Crater);
  expect(errors).toEqual([]);
});

test('reloading releases a held Hammer of Dawn while Tsar Bomba still resumes from a paused save', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await seed(page, { ...flatWorld().snapshot(), paused: true, speed: 1 });
  await page.getByRole('button', { name: 'Разрушение', exact: true }).click();
  for (const [id, label, x] of [['core:hammer-of-dawn', 'Молот рассвета', 18], ['core:tsar-bomba', 'Царь-бомба 100 Мт', 32]] as const) {
    const button = page.getByRole('button', { name: label, exact: true }); await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#tool-hint')).not.toBeEmpty();
    expect(await button.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).getContext('2d')!
      .getImageData(0, 0, 64, 64).data.some((value, index) => index % 4 === 3 && value > 0))).toBe(true);
    await page.mouse.move(...Object.values(point(x, 24)) as [number, number]);
    await page.mouse.down();
    if (id === 'core:tsar-bomba') await page.mouse.up();
    await expect.poll(async () => (await readSave(page))?.scenarios.some(scenario => scenario.id === id)).toBe(true);
    if (id === 'core:hammer-of-dawn') {
      await page.reload(); await page.mouse.up();
      await expect(page.locator('#loading-screen')).toBeHidden();
      await expect.poll(async () => (await readSave(page))?.scenarios.some(scenario => scenario.id === id)).toBe(false);
    }
  }
  const pending = (await readSave(page))!.scenarios;
  await page.reload();
  await expect(page.locator('#time-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#loading-screen')).toBeHidden();
  expect((await readSave(page))!.scenarios).toEqual(pending);
  await page.locator('.speed-controls').getByRole('button', { name: 'Старт', exact: true }).click();
  await expect(page.locator('#time-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await readSave(page))?.terrain.tiles.includes(Terrain.Crater), { timeout: 10000 }).toBe(true);
  expect(errors).toEqual([]);
});

test('Hammer of Dawn follows the held pointer beyond three seconds and stops after release', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const world = flatWorld(), target = world.spawn('core:tree', { x: 28, y: 28 })!, outside = world.spawn('core:tree', { x: 28, y: 40 })!;
  await seed(page, { ...world.snapshot(), paused: true, speed: 1 });
  await page.getByRole('button', { name: 'Разрушение', exact: true }).click();
  await page.getByRole('button', { name: 'Молот рассвета', exact: true }).click();
  await expect(page.locator('#tool-hint')).toContainText('Ведите курсор');
  await page.keyboard.press('2');
  await page.mouse.move(...Object.values(point(12, 24)) as [number, number]); await page.mouse.down();
  await page.mouse.move(...Object.values(point(36, 24)) as [number, number], { steps: 6 });
  await expect.poll(async () => {
    const state = (await readSave(page))?.scenarios.find(scenario => scenario.id === 'core:hammer-of-dawn')?.state;
    return (state as unknown as { strikes: { elapsed: number }[] } | undefined)?.strikes[0]?.elapsed ?? 0;
  }, { timeout: 15000 }).toBeGreaterThan(5);
  await expect.poll(async () => (await readSave(page))?.entities.some(entity => entity.id === target.id), { timeout: 10000 }).toBe(false);
  const saved = (await readSave(page))!;
  expect(saved.entities.some(entity => entity.id === outside.id)).toBe(true);
  expect(saved.terrain.tiles[28 * 48 + 28]).toBe(Terrain.Crater);
  await page.mouse.up();
  await page.mouse.move(...Object.values(point(28, 36)) as [number, number]);
  await expect.poll(async () => (await readSave(page))?.scenarios.some(scenario => scenario.id === 'core:hammer-of-dawn')).toBe(false);
  expect((await readSave(page))!.entities.some(entity => entity.id === outside.id)).toBe(true);
  expect(errors).toEqual([]);
});

test('desktop controls stay usable without duplicate pause or help at compact viewport', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 650 }); await page.goto('/');
  await expect(page.locator('.speed-controls').getByRole('button', { name: 'Стоп', exact: true })).toBeEnabled();
  const buttons = page.locator('.tool'); await expect(buttons).toHaveCount(createRegistry().tools.size);
  await expect(page.locator('[data-category]')).toHaveCount(3);
  await expect(page.locator('[data-category="nature"]')).toHaveCount(0);
  const seen = new Set<string>();
  for (const category of ['biomes', 'people', 'destruction']) {
    const count = [...createRegistry().tools.values()].filter(tool => tool.category === category).length;
    const tab = page.locator(`[data-category="${category}"]`);
    await tab.click(); await expect(tab).toHaveAttribute('aria-pressed', 'true');
    const visible = page.locator('.tool:visible'); await expect(visible).toHaveCount(count);
    for (const button of await visible.all()) {
      const id = (await button.getAttribute('data-tool'))!;
      expect(seen.has(id)).toBe(false); seen.add(id);
      const box = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThan(0); expect(box.x + box.width).toBeLessThan(900); expect(box.y + box.height).toBeLessThan(650);
      await button.click(); await expect(button).toHaveAttribute('aria-pressed', 'true');
      await expect(tab).toHaveAttribute('aria-pressed', 'true');
    }
  }
  expect(seen.size).toBe(createRegistry().tools.size);
  await expect(page.locator('#settings')).toHaveCount(1);
  await expect(page.locator('.game-panel #settings, .game-panel #new-world')).toHaveCount(0);
  await expect(page.locator('#pause, #help, #help-dialog')).toHaveCount(0);
  await expect(page.locator('.speed-controls').getByRole('button')).toHaveCount(4);
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 900);
});

test('remembers the selected tab and tool after reload and uses the restored tool', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await seed(page);
  for (const [category, tool] of [
    ['biomes', 'core:biome-swamp'], ['destruction', 'core:rocket'], ['destruction', 'core:rain'], ['people', 'core:elf'],
  ]) {
    await page.locator(`[data-category="${category}"]`).click();
    await page.locator(`[data-tool="${tool}"]`).click();
    const name = await page.locator('#tool-name').textContent(), hint = await page.locator('#tool-hint').textContent();
    await page.reload(); await expect(page.locator('#loading-screen')).toBeHidden();
    await expect(page.locator('[data-category][aria-pressed="true"]')).toHaveAttribute('data-category', category);
    await expect(page.locator('[data-tool][aria-pressed="true"]')).toHaveAttribute('data-tool', tool);
    await expect(page.locator(`[data-tool="${tool}"]`)).toBeVisible();
    await expect(page.locator('#tool-name')).toHaveText(name!);
    await expect(page.locator('#tool-hint')).toHaveText(hint!);
  }
  const target = point(24, 24); await page.mouse.click(target.x, target.y);
  await expect(page.locator('#population')).toHaveText('1');
  await expect.poll(async () => (await readSave(page))?.entities.filter(e => e.typeId === 'core:elf').length).toBe(1);
  await page.locator('[data-category="destruction"]').click();
  await page.reload(); await expect(page.locator('#loading-screen')).toBeHidden();
  await expect(page.locator('[data-category][aria-pressed="true"]')).toHaveAttribute('data-category', 'destruction');
  await expect(page.locator('[data-tool][aria-pressed="true"]')).toHaveAttribute('data-tool', 'core:dynamite');
  expect(errors).toEqual([]);
});

for (const storage of ['unknown tool', 'unavailable storage']) test(`tool selection stays usable with ${storage}`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(storage => {
    if (storage === 'unknown tool') localStorage.setItem('pocket-world.selected-tool', 'removed:tool');
    else Object.defineProperty(window, 'localStorage', { get: () => { throw new DOMException('Storage unavailable', 'SecurityError'); } });
  }, storage);
  await seed(page); await expect(page.locator('#loading-screen')).toBeHidden();
  await expect(page.locator('[data-category][aria-pressed="true"]')).toHaveAttribute('data-category', 'people');
  await expect(page.locator('[data-tool][aria-pressed="true"]')).toHaveAttribute('data-tool', 'core:human');
  await page.locator('[data-category="biomes"]').click();
  await page.locator('[data-tool="core:biome-swamp"]').click();
  await expect(page.locator('[data-tool][aria-pressed="true"]')).toHaveAttribute('data-tool', 'core:biome-swamp');
  expect(errors).toEqual([]);
});

test.describe('settlement migration and seasons', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a saved migrating family walks to its reserved home and stays together after reload', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    const world = migrationWorld(); world.tick = 300; migrations(world); world.paused = true;
    const group = structuredClone(world.society.migrations[0]);
    await seed(page, world.snapshot());
    await expect(page.locator('#population')).toHaveText('3');
    await page.reload(); await expect(page.locator('#season-name')).toHaveText('Spring');
    expect((await readSave(page))!.society.migrations).toEqual([group]);
    await page.keyboard.press('4');
    await expect(page.locator('#chronicle')).toContainText('Migrants arrived in', { timeout: 25000 });
    await page.keyboard.press('1');
    await expect.poll(async () => (await readSave(page))?.paused, { timeout: 7000 }).toBe(true);
    const saved = (await readSave(page))!;
    expect(saved.society.migrations).toHaveLength(0);
    expect(saved.entities.filter(e => group.members.includes(e.id)).every(e => e.components.citizen!.villageId === 2 && e.components.person!.homeId === group.homeIds[0])).toBe(true);
    await page.reload(); await expect(page.locator('#population')).toHaveText('3');
    expect(await readSave(page)).toEqual(saved); expect(errors).toEqual([]);
  });

  test('pioneers establish homes and fields in a new settlement after their journey', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    const world = pioneerWorld(); world.tick = 150; migrations(world); world.paused = true;
    const members = [...world.society.migrations[0].members];
    await seed(page, world.snapshot()); await expect(page.locator('#village-count')).toHaveText('1');
    await page.keyboard.press('4');
    await expect(page.locator('#village-count')).toHaveText('2', { timeout: 25000 });
    await expect.poll(async () => (await readSave(page))?.entities.some(e => e.components.farm?.villageId === 2), { timeout: 10000 }).toBe(true);
    await page.keyboard.press('1');
    await expect.poll(async () => (await readSave(page))?.paused, { timeout: 7000 }).toBe(true);
    const saved = (await readSave(page))!;
    expect(saved.society.roads.some(r => r.a === 1 && r.b === 2)).toBe(true);
    expect(saved.entities.filter(e => members.includes(e.id)).every(e => e.components.citizen!.villageId === 2)).toBe(true);
    await page.reload(); await expect(page.locator('#village-count')).toHaveText('2');
    expect(await readSave(page)).toEqual(saved); expect(errors).toEqual([]);
  });

  test('winter stops harvesting, consumes reserves, and keeps its calendar while paused and reloaded', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    const world = villageWorld([{ x: 24, y: 24 }]);
    world.tick = 5399; world.paused = true; world.society.villages[0].food = 100;
    for (const e of world.query('person')) { e.components.person!.reproduceIn = 100000; e.components.citizen!.hunger = 60; }
    await seed(page, world.snapshot()); await expect(page.locator('#season-name')).toHaveText('Autumn');
    await expect(page.locator('#food-stocks')).toHaveText('100');
    await page.keyboard.press('4'); await expect(page.locator('#season-name')).toHaveText('Winter');
    await expect.poll(async () => Number(await page.locator('#food-stocks').textContent())).toBeLessThan(100);
    await page.keyboard.press('1');
    await expect.poll(async () => {
      const saved = await readSave(page);
      return saved?.paused && saved.tick >= 5400 && saved.society.villages[0].food < 100;
    }, { timeout: 7000 }).toBe(true);
    const saved = (await readSave(page))!;
    expect(saved.society.villages[0].harvested).toBe(0);
    await page.reload(); await expect(page.locator('#season-name')).toHaveText('Winter');
    await expect(page.locator('#season-year')).toHaveText('Year 1');
    await expect(page.locator('#food-stocks')).toHaveText(String(Math.floor(saved.society.villages[0].food)));
    expect(await readSave(page)).toEqual(saved); expect(errors).toEqual([]);
  });
});

for (const savedLanguage of ['ru', 'en'] as const) test(`settlement names from ${savedLanguage} saves follow settings on the map and in diplomacy`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const world = diplomaticWorld(4), used: string[] = [];
  for (const village of world.society.villages) {
    village.name = settlementName(world.seed, village.id, used, savedLanguage); used.push(village.name);
  }
  world.society.history = [];
  formAlliance(world, 1, 2); formAlliance(world, 3, 4); declareWar(world, 1, 3);
  world.paused = true;
  const snapshot = world.snapshot();
  await page.addInitScript(() => {
    const labels = new Set<string>();
    (window as typeof window & { settlementLabels: Set<string> }).settlementLabels = labels;
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (...args: Parameters<typeof fillText>) {
      labels.add(args[0]); return fillText.apply(this, args);
    };
  });
  await seed(page, snapshot);
  for (const { id } of [...languages, languages[0]]) {
    await page.locator('#settings').click();
    await page.evaluate(() => (window as typeof window & { settlementLabels: Set<string> }).settlementLabels.clear());
    await page.locator('#language-select').selectOption(id);
    const names = world.society.villages.map(v => localizedSettlementName(world.seed, v, id));
    await expect(page.locator('.village-row strong')).toHaveText(names);
    for (const name of names) {
      await expect(page.locator('#alliances')).toContainText(name);
      await expect(page.locator('#campaigns')).toContainText(name);
      await expect(page.locator('#chronicle')).toContainText(name);
    }
    await expect.poll(() => page.evaluate(names => names.every(name => (window as typeof window & { settlementLabels: Set<string> }).settlementLabels.has(name)), names)).toBe(true);
    await page.locator('#settings-dialog button[value="done"]').click();
    expect(await readSave(page)).toEqual(snapshot);
  }
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('.village-row strong')).toHaveText(world.society.villages.map(v => localizedSettlementName(world.seed, v, 'en')));
  expect(await readSave(page)).toEqual(snapshot); expect(errors).toEqual([]);
});

test.describe('default interface language', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('starts in English and preserves an explicitly selected language after reload', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page).toHaveTitle('Pocket Overlord — pixel sandbox');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /^Pocket Overlord is a pixel sandbox\./);
    await expect(page.locator('#tool-name')).toHaveText('Human');
    await expect(page.locator('.speed-controls').getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.locator('#language-select')).toHaveValue('en');
    await expect(page.locator('#language-select option').first()).toHaveAttribute('value', 'en');
    await page.locator('#language-select').selectOption('ru');
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    await expect(page.locator('#tool-name')).toHaveText('Человек');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /^Pocket Overlord — пиксельная песочница\./);
  });
});

for (const language of [
  { id: 'en', title: 'Settings', done: 'Done', human: 'Human', storm: 'Thunderstorm', alliance: 'Alliance formed:', campaign: 'Mustering · 2 vs 2' },
  { id: 'zh-CN', title: '设置', done: '完成', human: '人类', storm: '雷暴', alliance: '联盟成立：', campaign: '集结部队 · 2 对 2' },
  { id: 'ja', title: '設定', done: '完了', human: '人間', storm: '雷雨', alliance: '同盟が結成：', campaign: '部隊集結中 · 2 対 2' },
  { id: 'es', title: 'Ajustes', done: 'Listo', human: 'Humano', storm: 'Tormenta eléctrica', alliance: 'Alianza formada:', campaign: 'Reuniendo tropas · 2 contra 2' },
]) {
  test(`settings switches the whole interface to ${language.id} and remembers it without changing the world`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const world = diplomaticWorld(4);
    world.society.villages.forEach((v, i) => { v.name = ['Alpha', 'Beta', 'Gamma', 'Delta'][i]; });
    world.society.history = [];
    formAlliance(world, 1, 2); formAlliance(world, 3, 4); declareWar(world, 1, 3);
    world.paused = true;
    const snapshot = world.snapshot();
    await seed(page, snapshot);
    await page.locator('[data-category="destruction"]').click(); await page.getByRole('button', { name: 'Гроза', exact: true }).click();
    const canvas = await page.locator('#world').elementHandle();
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    await expect(page.locator('#language-select option')).toHaveCount(5);
    await page.locator('#language-select').selectOption(language.id);
    await expect(page.locator('html')).toHaveAttribute('lang', language.id);
    await expect(page.getByRole('dialog', { name: language.title, exact: true })).toBeVisible();
    await expect(page.locator('#settings')).toHaveAttribute('aria-label', language.title);
    await expect(page.locator('#tool-name')).toHaveText(language.storm);
    await expect(page.locator('#tool-hint')).not.toContainText('Удерживайте');
    await expect(page.locator('#chronicle')).toContainText(language.alliance);
    await expect(page.locator('#campaigns')).toContainText(language.campaign);
    await expect(page.locator('#save-status')).toBeHidden();
    expect(await canvas!.evaluate(node => node.isConnected)).toBe(true);
    await page.keyboard.press('1'); await page.keyboard.press('Space');
    await expect(page.locator('#tool-name')).toHaveText(language.storm);
    expect(await readSave(page)).toEqual(snapshot);
    await page.getByRole('button', { name: language.done, exact: true }).click();
    await page.locator('[data-category="people"]').click();
    await page.getByRole('toolbar').getByRole('button', { name: language.human, exact: true }).click();
    await expect(page.locator('#tool-name')).toHaveText(language.human);
    await page.mouse.click(720, 442);
    await expect(page.locator('#population')).toHaveText('17');
    await expect.poll(async () => (await readSave(page))?.entities.filter(e => e.components.person).length, { timeout: 7000 }).toBe(17);
    const saved = await readSave(page);
    expect(saved?.paused).toBe(true); expect(saved?.tick).toBe(snapshot.tick);
    expect(await page.evaluate(key => localStorage.getItem(key), LANGUAGE_KEY)).toBe(language.id);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', language.id);
    await expect(page.locator('#population')).toHaveText('17');
    expect(await readSave(page)).toEqual(saved);
    await page.getByRole('button', { name: language.title, exact: true }).click();
    await expect(page.locator('#language-select')).toHaveValue(language.id);
    await page.setViewportSize({ width: 900, height: 650 });
    const dialog = (await page.locator('#settings-dialog').boundingBox())!;
    expect(dialog.x).toBeGreaterThan(0); expect(dialog.y).toBeGreaterThan(0);
    expect(dialog.x + dialog.width).toBeLessThan(900); expect(dialog.y + dialog.height).toBeLessThan(650);
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-dialog')).toBeHidden();
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 900);
    expect(errors).toEqual([]);
  });
}

test('benchmarks simulation and rendering with 300 residents and explosions', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.locator('.speed-controls').getByRole('button', { name: 'Стоп', exact: true })).toBeEnabled();
  await page.locator('.speed-controls').getByRole('button', { name: 'Стоп', exact: true }).click();
  const measurements = await page.evaluate(async () => {
    const worldModule = '/src/core/world.ts', rendererModule = '/src/render/renderer.ts';
    const { World } = await import(worldModule);
    const { Renderer } = await import(rendererModule);
    const world = new World(4831);
    for (let y = 15; y < 95 && world.population < 300; y += 2) {
      for (let x = 25; x < 140 && world.population < 300; x += 2) {
        if (!world.canStand({ x, y })) continue;
        const person = world.spawn('core:person', { x, y });
        person.components.health = { current: 100000, max: 100000 };
      }
    }
    for (let i = 0; i < 40; i++) world.spawn('core:house', { x: 50 + i % 10 * 4, y: 40 + Math.floor(i / 10) * 5 });
    let i = 0;
    for (const entity of world.query('combustible')) if (i++ % 18 === 0) { entity.components.thermal.temperature = 100; entity.components.thermal.burning = true; }
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;width:1440px;height:960px'; document.body.append(canvas);
    const renderer = new Renderer(canvas); renderer.resize(); renderer.camera.fit(160, 112);
    renderer.draw(world, 0);
    const simulation: number[] = [], rendering: number[] = [];
    for (let frame = 0; frame < 300; frame++) {
      if (frame % 30 === 0) world.events.push({ kind: 'blast', x: 60 + frame % 40, y: 50, radius: 9, power: 150, heat: 100 });
      const start = performance.now(); world.step(); const middle = performance.now();
      renderer.draw(world, frame * 1000 / 30); const end = performance.now();
      simulation.push(middle - start); rendering.push(end - middle);
      if (frame % 15 === 0) await new Promise(requestAnimationFrame);
    }
    canvas.remove();
    const summary = (values: number[]): { average: number; p95: number; max: number } => {
      values.sort((a, b) => a - b);
      return { average: +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(3), p95: +values[Math.floor(values.length * 0.95)].toFixed(3), max: +values.at(-1)!.toFixed(3) };
    };
    return { population: world.population, entities: world.entities.size, simulationMs: summary(simulation), renderingMs: summary(rendering), dpr: devicePixelRatio };
  });
  console.log(JSON.stringify({ browser: testInfo.project.name, ...measurements }));
  expect(measurements.population).toBe(300);
  await testInfo.attach('performance.json', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
});

test('registered content appears in the toolbar and resumes its saved scenario', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/content-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><link rel="stylesheet" href="/src/style.css"></head><body><div id="app"></div></body></html>' }));
  const setup = async (): Promise<void> => {
    await page.goto('/content-fixture');
    await page.evaluate(async () => {
      const paths = ['/src/content/defaults.ts', '/tests/fixtures/content-pack.ts', '/src/core/world.ts', '/src/ui.ts', '/src/render/renderer.ts', '/src/persistence/storage.ts'];
      const [{ createRegistry }, { testContent }, { World }, { UI }, { Renderer }, { IndexedDBBackend, SaveService }] = await Promise.all(paths.map(path => import(path)));
      const registry = createRegistry([testContent]);
      const saves = new SaveService(new IndexedDBBackend('content-test'), registry);
      const loaded = await saves.load();
      let world;
      if (loaded.status === 'loaded') world = new World(loaded.snapshot.seed, registry, loaded.snapshot);
      else {
        const snapshot = new World(12345, registry).snapshot();
        snapshot.entities = []; snapshot.nextEntityId = 1; snapshot.paused = true;
        snapshot.terrain = { width: 48, height: 48, tiles: Array(48 * 48).fill(3), moisture: Array(48 * 48).fill(0), recovery: [] };
        world = new World(snapshot.seed, registry, snapshot);
      }
      const ui = new UI(registry, (id: string) => {
        ui.select(registry.tools.get(id));
        world.command({ kind: 'use-tool', toolId: id, x: 20, y: 20 }); renderer.draw(world, 0);
      });
      const renderer = new Renderer(ui.canvas); renderer.resize(); renderer.camera.fit(48, 48); renderer.draw(world, 0);
      Object.assign(globalThis, { contentTest: { world, saves, renderer } });
    });
  };
  await setup();
  await page.locator('[data-category="nature"]').click();
  const tool = page.getByRole('button', { name: 'Test lantern', exact: true });
  await expect(tool).toBeVisible();
  await expect(tool).toHaveAttribute('aria-pressed', 'true');
  const saved = await page.evaluate(async () => {
    const { world, saves, renderer } = (globalThis as ContentTestGlobal).contentTest;
    const colors = (canvas: HTMLCanvasElement): number => {
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] >= 200 && pixels[i] <= 237 && pixels[i + 1] >= 95 && pixels[i + 1] <= 120 && pixels[i + 2] >= 165 && pixels[i + 2] <= 198) count++;
      return count;
    };
    const iconPixels = colors(document.querySelector('[data-tool="test:lantern"] canvas')!);
    renderer.draw(world, 0);
    const worldPixels = colors(document.querySelector('#world')!);
    world.startScenario('test:lantern-rain'); world.paused = false;
    for (let i = 0; i < 21; i++) world.step();
    world.paused = true; const snapshot = world.snapshot(); await saves.save(snapshot);
    return { snapshot, iconPixels, worldPixels };
  });
  expect(saved.iconPixels).toBeGreaterThan(0); expect(saved.worldPixels).toBeGreaterThan(0);
  expect(saved.snapshot.scenarios[0].state).toEqual({ nextTick: 30, remaining: 2 });
  await setup();
  expect(await page.evaluate(() => (globalThis as ContentTestGlobal).contentTest.world.snapshot())).toEqual(saved.snapshot);
  const completed = await page.evaluate(() => {
    const { world } = (globalThis as ContentTestGlobal).contentTest; world.paused = false;
    for (let i = 0; i < 60; i++) world.step();
    return { active: world.scenarios.length, lanterns: [...world.query('test:charge')].length };
  });
  expect(completed).toEqual({ active: 0, lanterns: 4 }); expect(errors).toEqual([]);
});
