import { expect, test, type CDPSession, type Page } from '@playwright/test';
import type { GameCommand } from '../../src/core/types';
import type { Renderer } from '../../src/render/renderer';
import { flatWorld } from '../helpers';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
test.skip(({ browserName }) => browserName === 'firefox', 'Firefox does not support mobile viewport emulation.');
test.beforeEach(async ({ page }) => { await page.routeWebSocket('**', socket => socket.close()); });

type MobileGlobal = typeof globalThis & { mobileFixture: { renderer: Renderer; commands: GameCommand[]; tool: string; blocked: boolean } };
const state = (page: Page) => page.evaluate(() => {
  const { renderer, commands } = (globalThis as MobileGlobal).mobileFixture;
  return { x: renderer.camera.x, y: renderer.camera.y, zoom: renderer.camera.zoom, commands };
});
const touch = (session: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', points: { id: number; x: number; y: number }[]) =>
  session.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(p => ({ ...p, radiusX: 2, radiusY: 2, force: 1 })) });

async function fixture(page: Page): Promise<void> {
  await page.route('**/mobile-input', route => route.fulfill({ contentType: 'text/html', body: `<meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}canvas{width:100vw;height:100dvh;touch-action:none}#controls{position:fixed;bottom:0;left:0}button{width:64px;height:64px;touch-action:none}</style><canvas tabindex="0"></canvas><div id="controls"><button data-control="KeyD">Right</button><button data-control="attack">Attack</button></div>` }));
  await page.goto('/mobile-input');
  await page.evaluate(async () => {
    const paths = ['/src/input/controller.ts', '/src/render/renderer.ts', '/src/content/defaults.ts'];
    const [{ InputController }, { Renderer }, { createRegistry }] = await Promise.all(paths.map(path => import(path)));
    const renderer = new Renderer(document.querySelector('canvas')!); renderer.resize(); renderer.camera.fit(48, 48);
    const f: MobileGlobal['mobileFixture'] = { renderer, commands: [], tool: 'core:human', blocked: false };
    (globalThis as MobileGlobal).mobileFixture = f;
    const registry = createRegistry(), controller = new InputController(renderer, {
      tool: () => registry.tools.get(f.tool), select: (id: string) => { f.tool = id; }, tools: () => registry.tools.values(),
      dispatch: (command: GameCommand) => f.commands.push(command), togglePause: () => {},
      dimensions: () => ({ x: 48, y: 48 }), blocked: () => f.blocked, cameraChanged: () => {},
    });
    controller.bindTouchControls(document.querySelector('#controls'));
    const update = (now: number) => { controller.update(now); requestAnimationFrame(update); }; requestAnimationFrame(update);
  });
}

test('a real touchscreen tap applies exactly one power', async ({ page }) => {
  await fixture(page);
  const before = await state(page); await page.touchscreen.tap(195, 300);
  const after = await state(page);
  expect(after.commands.filter(c => c.kind === 'use-tool')).toHaveLength(1);
  expect(after.commands[0]).toMatchObject({ kind: 'use-tool', toolId: 'core:human' });
  expect([after.x, after.y, after.zoom]).toEqual([before.x, before.y, before.zoom]);
});

test('one-finger swipes pan for ordinary, painting and aimed tools without firing', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native multi-touch injection uses the Chromium device protocol.');
  await fixture(page); const session = await page.context().newCDPSession(page);
  for (const tool of ['core:human', 'core:raise-land', 'core:hammer-of-dawn', 'core:kaiju']) {
    await page.evaluate(tool => { const f = (globalThis as MobileGlobal).mobileFixture; f.tool = tool; f.commands.length = 0; }, tool);
    const before = await state(page);
    await touch(session, 'touchStart', [{ id: 0, x: 150, y: 300 }]);
    await touch(session, 'touchMove', [{ id: 0, x: 190, y: 330 }]);
    await touch(session, 'touchEnd', []);
    const after = await state(page);
    expect(after.x).toBeCloseTo(before.x - 40 / (8 * before.zoom), 1);
    expect(after.y).toBeCloseTo(before.y - 30 / (8 * before.zoom), 1);
    expect(after.commands.filter(c => c.kind === 'use-tool')).toHaveLength(0);
    expect(after.commands.some(c => c.kind === 'control-tool' && c.attacking)).toBe(false);
  }
});

test('pinching keeps the map under the midpoint and lifting either finger never applies a power', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native multi-touch injection uses the Chromium device protocol.');
  await fixture(page); const session = await page.context().newCDPSession(page);
  const anchor = await page.evaluate(() => (globalThis as MobileGlobal).mobileFixture.renderer.camera.screenToWorld(180, 300));
  const before = await state(page);
  await touch(session, 'touchStart', [{ id: 0, x: 140, y: 300 }]);
  await touch(session, 'touchStart', [{ id: 0, x: 140, y: 300 }, { id: 1, x: 220, y: 300 }]);
  await touch(session, 'touchMove', [{ id: 0, x: 110, y: 290 }, { id: 1, x: 250, y: 290 }]);
  const after = await state(page);
  expect(after.zoom).toBeCloseTo(before.zoom * 1.75, 1);
  const under = await page.evaluate(() => (globalThis as MobileGlobal).mobileFixture.renderer.camera.screenToWorld(180, 290));
  expect(under.x).toBeCloseTo(anchor.x, 1); expect(under.y).toBeCloseTo(anchor.y, 1);
  await touch(session, 'touchEnd', [{ id: 0, x: 110, y: 290 }]);
  await touch(session, 'touchMove', [{ id: 1, x: 270, y: 300 }]);
  await page.waitForTimeout(400); await touch(session, 'touchEnd', []);
  expect((await state(page)).commands.filter(c => c.kind === 'use-tool')).toHaveLength(0);
  await page.touchscreen.tap(195, 300);
  expect((await state(page)).commands.filter(c => c.kind === 'use-tool')).toHaveLength(1);
});

test('holding arms painting and beams, while a second finger immediately releases a beam', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native multi-touch injection uses the Chromium device protocol.');
  await fixture(page); const session = await page.context().newCDPSession(page);
  for (const tool of ['core:raise-land', 'core:hammer-of-dawn']) {
    await page.evaluate(tool => { const f = (globalThis as MobileGlobal).mobileFixture; f.tool = tool; f.commands.length = 0; }, tool);
    const before = await state(page);
    await touch(session, 'touchStart', [{ id: 0, x: 150, y: 300 }]);
    await expect.poll(async () => (await state(page)).commands.filter(c => c.kind === 'use-tool').length).toBeGreaterThan(0);
    await touch(session, 'touchMove', [{ id: 0, x: 220, y: 320 }]);
    const steered = await state(page);
    expect([steered.x, steered.y]).toEqual([before.x, before.y]);
    if (tool === 'core:hammer-of-dawn') {
      expect(steered.commands.some(c => c.kind === 'aim-tool')).toBe(true);
      await touch(session, 'touchStart', [{ id: 0, x: 220, y: 320 }, { id: 1, x: 280, y: 320 }]);
      expect((await state(page)).commands.filter(c => c.kind === 'release-tool')).toHaveLength(1);
      await touch(session, 'touchEnd', [{ id: 1, x: 280, y: 320 }]); await page.waitForTimeout(400);
      expect((await state(page)).commands.filter(c => c.kind === 'use-tool')).toHaveLength(1);
    } else expect(steered.commands.filter(c => c.kind === 'use-tool').length).toBeGreaterThan(1);
    await touch(session, 'touchEnd', []);
  }
});

for (const reason of ['cancel', 'blur', 'blocked', 'tool'] as const) test(`a held touch beam stops on ${reason}`, async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native multi-touch injection uses the Chromium device protocol.');
  await fixture(page); const session = await page.context().newCDPSession(page);
  await page.evaluate(() => { (globalThis as MobileGlobal).mobileFixture.tool = 'core:hammer-of-dawn'; });
  await touch(session, 'touchStart', [{ id: 0, x: 195, y: 300 }]);
  await expect.poll(async () => (await state(page)).commands.filter(c => c.kind === 'use-tool').length).toBe(1);
  if (reason === 'cancel') await touch(session, 'touchCancel', []);
  else await page.evaluate(reason => {
    const f = (globalThis as MobileGlobal).mobileFixture;
    if (reason === 'blur') window.dispatchEvent(new Event('blur'));
    if (reason === 'blocked') f.blocked = true;
    if (reason === 'tool') f.tool = 'core:human';
  }, reason);
  await expect.poll(async () => (await state(page)).commands.filter(c => c.kind === 'release-tool').length).toBe(1);
  if (reason !== 'cancel') await touch(session, 'touchEnd', []);
  expect((await state(page)).commands.filter(c => c.kind === 'use-tool')).toHaveLength(1);
});

test('screen movement and attack can be held together and dialogs release both', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native multi-touch injection uses the Chromium device protocol.');
  await fixture(page); const session = await page.context().newCDPSession(page);
  await page.evaluate(() => { (globalThis as MobileGlobal).mobileFixture.tool = 'core:kaiju'; });
  const right = await page.locator('[data-control=KeyD]').boundingBox(), attack = await page.locator('[data-control=attack]').boundingBox();
  const a = { id: 0, x: right!.x + 25, y: right!.y + 25 }, b = { id: 1, x: attack!.x + 25, y: attack!.y + 25 };
  await touch(session, 'touchStart', [a]); await touch(session, 'touchStart', [a, b]);
  await expect.poll(async () => (await state(page)).commands.at(-1)).toMatchObject({ kind: 'control-tool', x: 1, y: 0, attacking: true });
  await touch(session, 'touchEnd', [a]);
  await expect.poll(async () => (await state(page)).commands.at(-1)).toMatchObject({ x: 0, attacking: true });
  await page.evaluate(() => { (globalThis as MobileGlobal).mobileFixture.blocked = true; });
  await expect.poll(async () => (await state(page)).commands.at(-1)).toMatchObject({ x: 0, attacking: false, active: false });
  await expect(page.locator('[data-control=attack]')).toHaveAttribute('aria-pressed', 'false');
  await touch(session, 'touchEnd', []);
});

async function loadGame(page: Page): Promise<void> {
  const world = flatWorld(); world.paused = true;
  await page.route('**/mobile-save', route => route.fulfill({ contentType: 'text/html', body: '<title>Save fixture</title>' }));
  await page.goto('/mobile-save');
  await page.evaluate(snapshot => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('little-world', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('worlds');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('worlds', 'readwrite'); tx.objectStore('worlds').put(JSON.parse(snapshot), 'last');
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  }), JSON.stringify(world.snapshot()));
  await page.goto('/'); await expect(page.locator('#loading-screen')).toBeHidden();
}

test('undo removes touchscreen placements one at a time and stays clear of landscape movement controls', async ({ page }) => {
  await loadGame(page);
  const undo = page.getByRole('button', { name: 'Undo last action', exact: true });
  await expect(undo).toBeDisabled();
  const target = await page.locator('#world').evaluate(async canvas => {
    const path = '/src/render/camera.ts', { Camera } = await import(path), camera = new Camera();
    camera.width = canvas.clientWidth; camera.height = canvas.clientHeight; camera.fit(48, 48); return camera.worldToScreen(24, 24);
  });
  await page.touchscreen.tap(target.x, target.y);
  await page.touchscreen.tap(target.x + 20, target.y);
  await expect(page.locator('#population')).toHaveText('2');
  await undo.tap();
  await expect(page.locator('#population')).toHaveText('1');
  await expect(undo).toBeEnabled();
  await undo.tap();
  await expect(page.locator('#population')).toHaveText('0');
  await expect(undo).toBeDisabled();
  await page.locator('[data-category=destruction]').tap();
  await page.locator('[data-tool="core:kaiju"]').tap();
  await page.setViewportSize({ width: 844, height: 390 });
  const button = (await undo.boundingBox())!, directions = (await page.locator('.touch-directions').boundingBox())!;
  expect(button.y).toBeGreaterThanOrEqual(directions.y + directions.height);
});

test('the mobile game places people, offers every power and keeps menus usable after rotation', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await loadGame(page);
  await expect(page.locator('.desktop-note')).toHaveCount(0);
  await expect(page.locator('#tool-hint')).toContainText('Tap');
  const target = await page.locator('#world').evaluate(async canvas => {
    const path = '/src/render/camera.ts', { Camera } = await import(path), camera = new Camera();
    camera.width = canvas.clientWidth; camera.height = canvas.clientHeight; camera.fit(48, 48); return camera.worldToScreen(24, 24);
  });
  await page.touchscreen.tap(target.x, target.y); await expect(page.locator('#population')).toHaveText('1');
  await page.locator('[data-category=destruction]').tap();
  for (const button of await page.locator('.tool:not([hidden])').all()) {
    await button.tap(); await expect(button).toHaveAttribute('aria-pressed', 'true');
    const box = (await button.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  await page.locator('[data-tool="core:kaiju"]').tap();
  await expect(page.locator('#touch-controls')).toBeVisible(); await expect(page.locator('#tool-hint')).toContainText('Attack');
  await page.locator('#settings').tap(); await page.locator('#language-select').selectOption('ru');
  await page.locator('#settings-dialog button[value=done]').tap();
  await expect(page.locator('[data-control=attack]')).toHaveText('Атака');
  await page.screenshot({ path: testInfo.outputPath('mobile-portrait.png') });
  const zoom = await page.locator('#zoom-value').textContent();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('#zoom-value')).toHaveText(zoom!);
  for (const selector of ['#settings', '#time-toggle', '#speed-picker', '[data-control=KeyW]', '[data-control=attack]', '.category-tabs']) {
    const box = (await page.locator(selector).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(844); expect(box.y + box.height).toBeLessThanOrEqual(390);
  }
  await page.locator('#speed-picker').tap(); await page.locator('[data-speed="2"]').tap();
  await expect(page.locator('#speed-value')).toHaveText('2×');
  await page.locator('#settings').tap(); await page.locator('#new-world').tap();
  await expect(page.locator('#new-dialog')).toBeVisible();
  await page.locator('#new-dialog button[value=cancel]').tap(); await expect(page.locator('#new-dialog')).not.toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mobile-landscape.png') });
  expect(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth)).toBe(true); expect(errors).toEqual([]);
});

test('the narrow toolbar scrolls with a finger instead of selecting or applying a power', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native touch swiping uses the Chromium device protocol.');
  await page.setViewportSize({ width: 320, height: 480 }); await loadGame(page);
  await page.locator('[data-category=destruction]').tap();
  const session = await page.context().newCDPSession(page), dock = page.locator('.tool-dock'), box = (await dock.boundingBox())!;
  expect(await dock.evaluate(e => e.scrollWidth > e.clientWidth)).toBe(true);
  const selected = await page.locator('.tool[aria-pressed=true]').getAttribute('data-tool');
  await touch(session, 'touchStart', [{ id: 0, x: 280, y: box.y + 25 }]);
  for (const x of [240, 200, 160, 120, 80]) await touch(session, 'touchMove', [{ id: 0, x, y: box.y + 25 }]);
  await touch(session, 'touchEnd', []);
  await expect.poll(() => dock.evaluate(e => e.scrollLeft)).toBeGreaterThan(0);
  await expect(page.locator('.tool[aria-pressed=true]')).toHaveAttribute('data-tool', selected!);
  expect(await page.evaluate(() => document.body.scrollWidth)).toBe(320);
});
