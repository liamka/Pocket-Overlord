import { expect, test, type Page } from '@playwright/test';
import type { Renderer } from '../../src/render/renderer';
import type { GameCommand } from '../../src/core/types';
import type { InputController } from '../../src/input/controller';

type InputGlobal = typeof globalThis & { inputFixture: { renderer: Renderer; commands: GameCommand[]; blocked: boolean; tool: string; placementSucceeds: boolean; manual: boolean; controller?: InputController } };

test.beforeEach(async ({ page }) => {
  await page.route('**/input-fixture', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0"><canvas style="width:800px;height:600px" tabindex="0"></canvas></body>' }));
  await page.goto('/input-fixture');
  await page.evaluate(async () => {
    const inputPath = '/src/input/controller.ts', renderPath = '/src/render/renderer.ts', contentPath = '/src/content/defaults.ts';
    const [{ InputController }, { Renderer }, { createRegistry }] = await Promise.all([import(inputPath), import(renderPath), import(contentPath)]);
    const renderer = new Renderer(document.querySelector('canvas')!);
    renderer.resize(); renderer.camera.fit(48, 48);
    const fixture: InputGlobal['inputFixture'] = { renderer, commands: [], blocked: false, tool: 'core:human', placementSucceeds: true, manual: false };
    (globalThis as InputGlobal).inputFixture = fixture;
    const registry = createRegistry();
    const controller = new InputController(renderer, {
      tool: () => registry.tools.get(fixture.tool), select: (id: string) => { fixture.tool = id; }, tools: () => registry.tools.values(),
      dispatch: (command: GameCommand) => { fixture.commands.push(command); return fixture.placementSucceeds; }, togglePause: () => {}, stepSpeed: () => {},
      dimensions: () => ({ x: 48, y: 48 }), blocked: () => fixture.blocked, cameraChanged: () => {},
    });
    fixture.controller = controller;
    const update = (now: number): void => { if (!fixture.manual) controller.update(now); requestAnimationFrame(update); };
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
  await page.evaluate(() => { (globalThis as InputGlobal).inputFixture.tool = 'core:dynamite'; });
  const before = await state(page);
  await page.mouse.move(400, 250); await page.mouse.down();
  expect((await state(page)).commands).toHaveLength(0);
  await page.mouse.move(402, 251); await page.mouse.up();
  const after = await state(page);
  expect(after.commands).toHaveLength(1);
  expect(after.commands[0]).toMatchObject({ kind: 'use-tool', toolId: 'core:dynamite' });
  expect([after.x, after.y]).toEqual([before.x, before.y]);
});

test('left, middle and right dragging pan without applying tools or clicks on release', async ({ page }) => {
  await page.evaluate(() => { (globalThis as InputGlobal).inputFixture.tool = 'core:dynamite'; });
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

for (const race of ['human', 'elf', 'orc', 'dwarf']) {
  test(`${race} appears immediately and repeats while held, counting successful placements`, async ({ page }) => {
    await page.evaluate(race => { (globalThis as InputGlobal).inputFixture.tool = `core:${race}`; }, race);
    const before = await state(page);
    await page.mouse.move(350, 250); await page.mouse.down();
    expect((await state(page)).commands).toHaveLength(1);
    expect(await page.evaluate(() => (globalThis as InputGlobal).inputFixture.renderer.placementCount)).toBe(1);
    await page.mouse.move(420, 280);
    await expect.poll(async () => (await state(page)).commands.length).toBeGreaterThan(1);
    const held = await state(page);
    expect([held.x, held.y]).toEqual([before.x, before.y]);
    const snapshot = await page.evaluate(() => {
      const fixture = (globalThis as InputGlobal).inputFixture;
      fixture.placementSucceeds = false;
      return { count: fixture.renderer.placementCount, commands: fixture.commands.length };
    });
    expect(snapshot.count).toBe(snapshot.commands);
    await expect.poll(async () => (await state(page)).commands.length).toBeGreaterThan(snapshot.commands);
    expect(await page.evaluate(() => (globalThis as InputGlobal).inputFixture.renderer.placementCount)).toBe(snapshot.count);
    await page.mouse.up();
    expect(await page.evaluate(() => (globalThis as InputGlobal).inputFixture.renderer.placementCount)).toBeUndefined();
    const stopped = (await state(page)).commands.length;
    await page.waitForTimeout(120);
    expect((await state(page)).commands).toHaveLength(stopped);
  });
}

test('held placements double every two seconds and restart on the next press', async ({ page }) => {
  await page.evaluate(() => { (globalThis as InputGlobal).inputFixture.manual = true; });
  await page.mouse.move(350, 250); await page.mouse.down();
  const counts = await page.evaluate(() => {
    const fixture = (globalThis as InputGlobal).inputFixture;
    const controller = fixture.controller!;
    const started = (controller as unknown as { gesture: { started: number } }).gesture.started;
    return [499, 999, 1999, 2999, 3999, 4999, 5999].map(ms => {
      controller.update(started + ms);
      return { commands: fixture.commands.length, count: fixture.renderer.placementCount };
    });
  });
  expect(counts).toEqual([1, 2, 4, 8, 12, 20, 28].map(count => ({ commands: count, count })));
  await page.mouse.up(); await page.mouse.down();
  expect(await page.evaluate(() => (globalThis as InputGlobal).inputFixture.renderer.placementCount)).toBe(1);
  await page.mouse.up();
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

test('Hammer of Dawn starts once, follows held left dragging, stops on release and keeps right dragging for panning', async ({ page }) => {
  await page.evaluate(() => { (globalThis as InputGlobal).inputFixture.tool = 'core:hammer-of-dawn'; });
  await page.mouse.move(350, 250);
  const before = await state(page);
  expect(before.commands).toHaveLength(0);
  await page.mouse.down(); await page.mouse.move(480, 290, { steps: 5 });
  await page.waitForTimeout(350); await page.mouse.up();
  const aimed = await state(page);
  expect(aimed.commands.filter(command => command.kind === 'use-tool')).toHaveLength(1);
  expect(aimed.commands.some(command => command.kind === 'aim-tool' && command.x > 30)).toBe(true);
  expect([aimed.x, aimed.y]).toEqual([before.x, before.y]);
  await expect(page.locator('canvas')).not.toHaveClass('panning');
  await page.mouse.move(530, 310);
  const hovered = await state(page);
  expect(hovered.commands.at(-1)).toMatchObject({ kind: 'release-tool', toolId: 'core:hammer-of-dawn' });
  expect(hovered.commands).toEqual(aimed.commands);
  await page.mouse.down({ button: 'right' }); await page.mouse.move(560, 330, { steps: 3 });
  await expect(page.locator('canvas')).toHaveClass('panning');
  expect((await state(page)).commands).toHaveLength(hovered.commands.length);
  await page.mouse.up({ button: 'right' });
  const panned = await state(page);
  expect(panned.x).toBeCloseTo(before.x - 30 / (8 * before.zoom));
  expect(panned.y).toBeCloseTo(before.y - 20 / (8 * before.zoom));
  expect(panned.commands.filter(command => command.kind === 'use-tool')).toHaveLength(1);
});

for (const reason of ['blur', 'visibility', 'cancel', 'capture', 'blocked', 'tool'] as const) {
  test(`Hammer of Dawn releases on ${reason}`, async ({ page }) => {
    await page.evaluate(() => { (globalThis as InputGlobal).inputFixture.tool = 'core:hammer-of-dawn'; });
    await page.mouse.move(350, 250); await page.mouse.down();
    await page.evaluate(reason => {
      const fixture = (globalThis as InputGlobal).inputFixture, canvas = fixture.renderer.canvas;
      if (reason === 'blur') window.dispatchEvent(new Event('blur'));
      else if (reason === 'visibility') document.dispatchEvent(new Event('visibilitychange'));
      else if (reason === 'cancel') canvas.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }));
      else if (reason === 'capture') canvas.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 1 }));
      else if (reason === 'blocked') fixture.blocked = true;
      else fixture.tool = 'core:human';
    }, reason);
    await expect.poll(async () => (await state(page)).commands.at(-1)).toEqual({ kind: 'release-tool', toolId: 'core:hammer-of-dawn' });
    await page.mouse.up(); await page.mouse.move(400, 300);
    expect((await state(page)).commands.filter(command => command.kind === 'release-tool')).toHaveLength(1);
    expect((await state(page)).commands.filter(command => command.kind === 'use-tool')).toHaveLength(1);
  });
}

test('Hammer of Dawn stops when left is released while the right button remains held', async ({ page }) => {
  await page.evaluate(() => { (globalThis as InputGlobal).inputFixture.tool = 'core:hammer-of-dawn'; });
  await page.mouse.move(350, 250); await page.mouse.down(); await page.mouse.down({ button: 'right' });
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).commands.at(-1)).toMatchObject({ kind: 'release-tool' });
  await page.mouse.up({ button: 'right' });
});

test('changing speed and pausing preserve a held Hammer of Dawn until mouse release', async ({ page }) => {
  await page.evaluate(() => { (globalThis as InputGlobal).inputFixture.tool = 'core:hammer-of-dawn'; });
  await page.mouse.move(350, 250); await page.mouse.down();
  await page.keyboard.press('+'); await page.keyboard.press('Space'); await page.keyboard.press('Space');
  expect((await state(page)).commands.filter(command => command.kind === 'release-tool')).toHaveLength(0);
  await page.mouse.up();
  expect((await state(page)).commands.at(-1)).toMatchObject({ kind: 'release-tool' });
});

test('blur and blocking a gesture cancel it without applying the selected tool', async ({ page }) => {
  await page.evaluate(() => { (globalThis as InputGlobal).inputFixture.tool = 'core:dynamite'; });
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
