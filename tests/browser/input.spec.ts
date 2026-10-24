import { expect, test, type Page } from '@playwright/test';
import type { Renderer } from '../../src/render/renderer';
import type { GameCommand } from '../../src/core/types';

type InputGlobal = typeof globalThis & { inputFixture: { renderer: Renderer; commands: GameCommand[]; blocked: boolean; tool: string } };

test.beforeEach(async ({ page }) => {
  await page.route('**/input-fixture', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0"><canvas style="width:800px;height:600px" tabindex="0"></canvas></body>' }));
  await page.goto('/input-fixture');
  await page.evaluate(async () => {
    const inputPath = '/src/input/controller.ts', renderPath = '/src/render/renderer.ts', contentPath = '/src/content/defaults.ts';
    const [{ DesktopController }, { Renderer }, { createRegistry }] = await Promise.all([import(inputPath), import(renderPath), import(contentPath)]);
    const renderer = new Renderer(document.querySelector('canvas')!);
    renderer.resize(); renderer.camera.fit(48, 48);
    const fixture: InputGlobal['inputFixture'] = { renderer, commands: [], blocked: false, tool: 'core:human' };
    (globalThis as InputGlobal).inputFixture = fixture;
    const registry = createRegistry();
    const controller = new DesktopController(renderer, {
      tool: () => registry.tools.get(fixture.tool), select: (id: string) => { fixture.tool = id; }, tools: () => registry.tools.values(),
      dispatch: (command: GameCommand) => fixture.commands.push(command), togglePause: () => {},
      dimensions: () => ({ x: 48, y: 48 }), blocked: () => fixture.blocked, cameraChanged: () => {},
    });
    const update = (now: number): void => { controller.update(now); requestAnimationFrame(update); };
    requestAnimationFrame(update);
  });
});

const state = (page: Page) => page.evaluate(() => {
  const { renderer, commands } = (globalThis as InputGlobal).inputFixture;
  return { x: renderer.camera.x, y: renderer.camera.y, zoom: renderer.camera.zoom, commands };
});

test('summoning captures the current screen corners after zooming and panning', async ({ page }) => {
  await page.evaluate(() => { (globalThis as InputGlobal).inputFixture.tool = 'core:ufo'; });
  await page.mouse.move(400, 250); await page.mouse.wheel(0, -180);
  await page.mouse.down({ button: 'right' }); await page.mouse.move(450, 280, { steps: 3 }); await page.mouse.up({ button: 'right' });
  await page.mouse.click(400, 250);
  const result = await page.evaluate(() => {
    const { renderer, commands } = (globalThis as InputGlobal).inputFixture;
    const camera = renderer.camera, first = camera.screenToWorld(0, 0), last = camera.screenToWorld(camera.width, camera.height);
    return { command: commands.at(-1), viewport: { left: first.x, top: first.y, right: last.x, bottom: last.y } };
  });
  expect(result.command).toMatchObject({ kind: 'use-tool', toolId: 'core:ufo', viewport: result.viewport });
});

test('applies one tool on release and tolerates small click movements', async ({ page }) => {
  const before = await state(page);
  await page.mouse.move(400, 250); await page.mouse.down();
  expect((await state(page)).commands).toHaveLength(0);
  await page.mouse.move(402, 251); await page.mouse.up();
  const after = await state(page);
  expect(after.commands).toHaveLength(1);
  expect(after.commands[0]).toMatchObject({ kind: 'use-tool', toolId: 'core:human' });
  expect([after.x, after.y]).toEqual([before.x, before.y]);
});

test('left, middle and right dragging pan without applying tools or clicks on release', async ({ page }) => {
  for (const button of ['left', 'middle', 'right'] as const) {
    const before = await state(page);
    await page.mouse.move(350, 250); await page.mouse.down({ button });
    await page.mouse.move(390, 270, { steps: 5 });
    await expect(page.locator('canvas')).toHaveClass('panning');
    await page.mouse.up({ button });
    await expect(page.locator('canvas')).not.toHaveClass('panning');
    const after = await state(page);
    expect(after.x).toBeCloseTo(before.x - 40 / (8 * before.zoom));
    expect(after.y).toBeCloseTo(before.y - 20 / (8 * before.zoom));
    expect(after.commands).toHaveLength(0);
    await page.mouse.move(450, 300);
    expect(await state(page)).toEqual(after);
  }
});

test('thunderstorm activates during a stationary hold and stops when dragging begins', async ({ page }) => {
  await page.evaluate(() => { (globalThis as InputGlobal).inputFixture.tool = 'core:rain'; });
  await page.mouse.move(350, 250); await page.mouse.down();
  await page.mouse.move(400, 280, { steps: 3 });
  await page.waitForTimeout(350);
  expect((await state(page)).commands).toHaveLength(0);
  await page.mouse.up();
  await page.mouse.down();
  await expect.poll(async () => (await state(page)).commands.length).toBeGreaterThan(1);
  await page.mouse.move(450, 300, { steps: 3 });
  const count = (await state(page)).commands.length;
  await page.waitForTimeout(160); await page.mouse.up();
  const after = await state(page);
  expect(after.commands).toHaveLength(count);
  expect(after.commands.every(command => command.kind === 'use-tool' && command.toolId === 'core:rain')).toBe(true);
});

test('Hammer of Dawn starts once, follows left dragging and hovering, and keeps right dragging for panning', async ({ page }) => {
  await page.evaluate(() => { (globalThis as InputGlobal).inputFixture.tool = 'core:hammer-of-dawn'; });
  await page.mouse.move(350, 250);
  const before = await state(page);
  await page.mouse.down(); await page.mouse.move(480, 290, { steps: 5 });
  await page.waitForTimeout(350); await page.mouse.up();
  const aimed = await state(page);
  expect(aimed.commands.filter(command => command.kind === 'use-tool')).toHaveLength(1);
  expect(aimed.commands.some(command => command.kind === 'aim-tool' && command.x > 30)).toBe(true);
  expect([aimed.x, aimed.y]).toEqual([before.x, before.y]);
  await expect(page.locator('canvas')).not.toHaveClass('panning');
  await page.mouse.move(530, 310);
  const hovered = await state(page);
  expect(hovered.commands.at(-1)).toMatchObject({ kind: 'aim-tool', toolId: 'core:hammer-of-dawn' });
  expect(hovered.commands.length).toBeGreaterThan(aimed.commands.length);
  await page.mouse.down({ button: 'right' }); await page.mouse.move(560, 330, { steps: 3 });
  await expect(page.locator('canvas')).toHaveClass('panning');
  expect((await state(page)).commands).toHaveLength(hovered.commands.length);
  await page.mouse.up({ button: 'right' });
  const panned = await state(page);
  expect(panned.x).toBeCloseTo(before.x - 30 / (8 * before.zoom));
  expect(panned.y).toBeCloseTo(before.y - 20 / (8 * before.zoom));
  expect(panned.commands.filter(command => command.kind === 'use-tool')).toHaveLength(1);
});

test('blur and blocking a gesture cancel it without applying the selected tool', async ({ page }) => {
  await page.mouse.move(350, 250); await page.mouse.down();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.mouse.up();
  await page.mouse.down();
  await page.evaluate(() => { (globalThis as InputGlobal).inputFixture.blocked = true; });
  await page.mouse.move(420, 300); await page.mouse.up();
  expect((await state(page)).commands).toHaveLength(0);
  await expect(page.locator('canvas')).not.toHaveClass('panning');
  await page.evaluate(() => { (globalThis as InputGlobal).inputFixture.blocked = false; });
  await page.mouse.click(400, 250);
  expect((await state(page)).commands).toHaveLength(1);
});

test('kaiju movement keys and firing release on blur, dialogs and tool switches', async ({ page }) => {
  await page.evaluate(() => { (globalThis as InputGlobal).inputFixture.tool = 'core:kaiju'; });
  await page.mouse.move(400, 250); await page.mouse.down(); await page.keyboard.down('KeyW'); await page.keyboard.down('KeyD');
  await expect.poll(async () => (await state(page)).commands.at(-1)).toMatchObject({ kind: 'control-tool', x: 1, y: -1, attacking: true, active: true });
  await page.keyboard.up('KeyW'); await page.keyboard.up('KeyD'); await page.mouse.up();
  await expect.poll(async () => (await state(page)).commands.at(-1)).toMatchObject({ kind: 'control-tool', x: 0, y: 0, attacking: false });
  await page.keyboard.down('ArrowLeft'); await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(async () => (await state(page)).commands.filter(c => c.kind === 'control-tool').at(-1)).toMatchObject({ x: 0, y: 0, attacking: false });
  await page.keyboard.up('ArrowLeft'); await page.keyboard.down('KeyS');
  await page.evaluate(() => { (globalThis as InputGlobal).inputFixture.blocked = true; });
  await expect.poll(async () => (await state(page)).commands.at(-1)).toMatchObject({ kind: 'control-tool', x: 0, y: 0, attacking: false, active: false });
  await page.keyboard.up('KeyS');
  await page.evaluate(() => { const f = (globalThis as InputGlobal).inputFixture; f.blocked = false; f.tool = 'core:human'; });
  await page.keyboard.press('KeyW');
  expect((await state(page)).commands.filter(c => c.kind === 'control-tool').at(-1)).toMatchObject({ active: false });
});
