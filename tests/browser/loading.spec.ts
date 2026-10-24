import { expect, test, type Page } from '@playwright/test';
import { LANGUAGE_KEY } from '../../src/i18n';
import { type WorldSnapshot } from '../../src/core/types';
import { flatWorld } from '../helpers';

type LoadingProbe = typeof window & {
  releaseLoading: () => void;
  revealedWorlds: { pixel: number[]; population: string | null; progress: string | null }[];
  loadingProgress: number[];
};

async function observeReveal(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe = window as LoadingProbe;
    probe.revealedWorlds = [];
    probe.loadingProgress = [0];
    new MutationObserver(records => {
      for (const record of records) {
        const screen = record.target as HTMLElement;
        if (screen.id === 'loading-progress') {
          const percent = Number(screen.getAttribute('aria-valuenow'));
          if (probe.loadingProgress.at(-1) !== percent) probe.loadingProgress.push(percent);
          continue;
        }
        if (screen.id !== 'loading-screen' || !screen.hidden) continue;
        const canvas = document.querySelector<HTMLCanvasElement>('#world')!;
        probe.revealedWorlds.push({
          pixel: [...canvas.getContext('2d')!.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data],
          population: document.querySelector('#population')!.textContent,
          progress: document.querySelector('#loading-progress')!.getAttribute('aria-valuenow'),
        });
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['hidden', 'aria-valuenow'] });
  });
}

async function seedWorld(page: Page): Promise<WorldSnapshot> {
  await page.route('**/loading-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Loading fixture</title>' }));
  await page.goto('/loading-fixture');
  const world = flatWorld();
  world.spawn('core:person', { x: 24, y: 24 }); world.paused = true;
  const snapshot = world.snapshot();
  await page.evaluate(snapshot => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('little-world', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('worlds');
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('worlds', 'readwrite');
      tx.objectStore('worlds').put(snapshot, 'last');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    open.onerror = () => reject(open.error);
  }), snapshot as unknown);
  return snapshot;
}

async function savedSeed(page: Page): Promise<number> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('little-world', 1);
    open.onsuccess = () => {
      const db = open.result, request = db.transaction('worlds').objectStore('worlds').get('last');
      request.onsuccess = () => { db.close(); resolve(request.result?.seed); };
      request.onerror = () => reject(request.error);
    };
    open.onerror = () => reject(open.error);
  }));
}

test('startup is visible before the bundle arrives and reveals a painted world', async ({ page }) => {
  await observeReveal(page);
  await page.setViewportSize({ width: 390, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let release!: () => void;
  const bundle = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/src/main.ts*', async route => { await bundle; await route.continue(); });
  await page.goto('/', { waitUntil: 'commit' });
  try {
    await expect(page.locator('#loading-screen')).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('Loading world…');
    await expect(page.getByRole('progressbar', { name: 'Loading world…' })).toHaveText('0%');
    await expect(page.locator('#loading-progress')).toHaveAttribute('aria-valuenow', '0');
    await expect(page.locator('#world')).toHaveCount(0);
    await expect(page.locator('#app')).toHaveJSProperty('inert', true);
    expect(await page.locator('#loading-screen').boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 640 });
    await expect(page.locator('.loading-indicator span').first()).toHaveCSS('animation-name', 'none');
    const card = (await page.locator('.loading-card').boundingBox())!;
    expect(card.x).toBeGreaterThan(0); expect(card.x + card.width).toBeLessThan(390);
  } finally { release(); }
  await expect(page.locator('#loading-screen')).toBeHidden();
  await expect(page.locator('#app')).toHaveJSProperty('inert', false);
  await expect(page.locator('#time-toggle')).toBeEnabled();
  const revealed = await page.evaluate(() => (window as LoadingProbe).revealedWorlds);
  expect(revealed).toHaveLength(1);
  expect(revealed[0].pixel.slice(0, 3).some(value => value > 0)).toBe(true);
  expect(revealed[0].population).toBe('0');
  expect(revealed[0].progress).toBe('100');
  expect(await page.evaluate(() => (window as LoadingProbe).loadingProgress)).toEqual([0, 25, 50, 75, 100]);
});

test('restoration keeps controls blocked until the saved world is painted', async ({ page }) => {
  const snapshot = await seedWorld(page);
  await observeReveal(page);
  await page.addInitScript(key => {
    localStorage.setItem(key, 'es');
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = (...args) => {
      indexedDB.open = open;
      const request = open(...args);
      let released = false;
      request.addEventListener('success', event => {
        if (released) return;
        event.stopImmediatePropagation();
        (window as LoadingProbe).releaseLoading = () => { released = true; request.dispatchEvent(new Event('success')); };
      });
      return request;
    };
  }, LANGUAGE_KEY);
  await page.goto('/');
  await expect(page.locator('#loading-message')).toHaveText('Cargando mundo…');
  await expect(page.locator('#loading-screen')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Cargando mundo…' })).toHaveText('25%');
  await expect(page.locator('#time-toggle')).toBeDisabled();
  await expect(page.locator('#app')).toHaveJSProperty('inert', true);
  await page.keyboard.press('Space'); await page.keyboard.press('4');
  await page.mouse.click(720, 442);
  await expect(page.locator('#population')).toHaveText('0');
  await expect(page.locator('#loading-progress')).toHaveAttribute('aria-valuenow', '25');
  await page.waitForFunction(() => typeof (window as LoadingProbe).releaseLoading === 'function');
  await page.evaluate(() => (window as LoadingProbe).releaseLoading());
  await expect(page.locator('#loading-screen')).toBeHidden();
  await expect(page.locator('#population')).toHaveText('1');
  await expect(page.locator('#time-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#speed-value')).toHaveText('1×');
  const revealed = await page.evaluate(() => (window as LoadingProbe).revealedWorlds);
  expect(revealed).toHaveLength(1); expect(revealed[0].population).toBe('1');
  expect(revealed[0].pixel.slice(0, 3).some(value => value > 0)).toBe(true);
  expect(revealed[0].progress).toBe('100');
  expect(await page.evaluate(() => (window as LoadingProbe).loadingProgress)).toEqual([0, 25, 50, 75, 100]);
  expect(await savedSeed(page)).toBe(snapshot.seed);
});

test('new-world loading blocks input, reveals the new map and leaves autosave in the background', async ({ page }) => {
  const snapshot = await seedWorld(page);
  await observeReveal(page);
  await page.goto('/');
  await expect(page.locator('#loading-screen')).toBeHidden();
  await page.evaluate(() => {
    const frame = window.requestAnimationFrame.bind(window);
    const pending: FrameRequestCallback[] = [];
    let released = false;
    window.requestAnimationFrame = callback => frame(now => {
      const screen = document.querySelector<HTMLElement>('#loading-screen')!;
      if (!released && !screen.hidden && screen.dataset.mode === 'create') pending.push(callback);
      else callback(now);
    });
    (window as LoadingProbe).releaseLoading = () => {
      released = true;
      pending.splice(0).forEach(callback => frame(callback));
    };
    // Keep the write pending to prove it does not hold the loading screen open.
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args: Parameters<typeof transaction>) {
      const tx = transaction.apply(this, args);
      if (args[1] === 'readwrite') tx.addEventListener('complete', event => event.stopImmediatePropagation());
      return tx;
    };
  });
  await page.locator('#settings').click(); await page.locator('#new-world').click();
  await page.locator('#confirm-new').click();
  await expect(page.locator('#loading-screen')).toBeVisible();
  await expect(page.locator('#loading-message')).toHaveText('Creating world…');
  await expect(page.getByRole('progressbar', { name: 'Creating world…' })).toHaveText('0%');
  await expect(page.locator('#new-dialog')).toBeHidden();
  await expect(page.locator('#app')).toHaveJSProperty('inert', true);
  await expect(page.locator('#time-toggle')).toBeDisabled();
  await page.keyboard.press('Space'); await page.keyboard.press('4'); await page.keyboard.press('Escape');
  await page.mouse.click(720, 442);
  await expect(page.locator('#loading-screen')).toBeVisible();
  await expect(page.locator('#population')).toHaveText('1');
  expect(await savedSeed(page)).toBe(snapshot.seed);
  await page.evaluate(() => (window as LoadingProbe).releaseLoading());
  await expect(page.locator('#loading-screen')).toBeHidden();
  await expect(page.locator('#population')).toHaveText('0');
  await expect(page.locator('#world')).toBeFocused();
  await expect(page.locator('#app')).toHaveJSProperty('inert', false);
  await expect(page.locator('#time-toggle')).toBeEnabled();
  await expect(page.locator('#save-status')).toHaveText('Saving new world…');
  await expect.poll(() => savedSeed(page)).not.toBe(snapshot.seed);
  const revealed = await page.evaluate(() => (window as LoadingProbe).revealedWorlds);
  expect(revealed.map(world => world.population)).toEqual(['1', '0']);
  expect(revealed.every(world => world.pixel.slice(0, 3).some(value => value > 0))).toBe(true);
  expect(revealed.every(world => world.progress === '100')).toBe(true);
  expect(await page.evaluate(() => (window as LoadingProbe).loadingProgress)).toEqual([0, 25, 50, 75, 100, 0, 50, 100]);
});

test('unavailable storage still dismisses loading and allows play', async ({ page }) => {
  await page.addInitScript(() => { indexedDB.open = () => { throw new Error('Storage unavailable'); }; });
  await page.goto('/');
  await expect(page.locator('#loading-screen')).toBeHidden();
  await expect(page.locator('#time-toggle')).toBeEnabled();
  await expect(page.locator('#save-warning')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.locator('#time-toggle')).toHaveAttribute('aria-pressed', 'true');
});

test('failed world creation restores controls and retains the previous world', async ({ page }) => {
  const snapshot = await seedWorld(page);
  await page.goto('/');
  await expect(page.locator('#loading-screen')).toBeHidden();
  await page.evaluate(() => { crypto.getRandomValues = () => { throw new Error('Seed unavailable'); }; });
  await page.locator('#settings').click(); await page.locator('#new-world').click();
  await page.locator('#confirm-new').click();
  await expect(page.locator('#toast')).toHaveText('Could not create the world. Try again.');
  await expect(page.locator('#loading-progress')).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('#loading-screen')).toBeHidden();
  await expect(page.locator('#app')).toHaveJSProperty('inert', false);
  await expect(page.locator('#population')).toHaveText('1');
  await expect(page.locator('#time-toggle')).toBeEnabled();
  expect(await savedSeed(page)).toBe(snapshot.seed);
});

test('startup failure offers a working retry instead of endless loading', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('loading-retry-tested')) return;
    sessionStorage.setItem('loading-retry-tested', 'true');
    crypto.getRandomValues = () => { throw new Error('Seed unavailable'); };
  });
  await page.goto('/');
  await expect(page.locator('#loading-message')).toHaveText('Could not load the world.');
  await expect(page.locator('.loading-indicator')).toBeHidden();
  await expect(page.locator('#loading-progress')).toBeHidden();
  await expect(page.locator('#loading-progress')).toHaveAttribute('aria-valuenow', '50');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeFocused();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('#loading-screen')).toBeHidden();
  await expect(page.locator('#time-toggle')).toBeEnabled();
});
