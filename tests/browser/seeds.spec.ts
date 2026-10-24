import { expect, test, type Page } from '@playwright/test';
import type { WorldSnapshot } from '../../src/core/types';
import { languages, translate } from '../../src/i18n';

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**', socket => socket.close());
  await page.goto('/');
  await expect(page.locator('#loading-screen')).toBeHidden();
  await expect.poll(async () => (await savedWorld(page))?.seed).toBeDefined();
});

async function savedWorld(page: Page): Promise<WorldSnapshot | undefined> {
  const serialized = await page.evaluate(() => new Promise<string | undefined>((resolve, reject) => {
    const request = indexedDB.open('little-world', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, read = db.transaction('worlds').objectStore('worlds').get('last');
      read.onsuccess = () => { resolve(JSON.stringify(read.result)); db.close(); };
      read.onerror = () => { reject(read.error); db.close(); };
    };
  }));
  return serialized === undefined ? undefined : JSON.parse(serialized);
}

async function openNewWorld(page: Page): Promise<void> {
  await page.locator('#settings').click();
  await page.locator('#new-world').click();
}

const previewPixels = (page: Page) => page.locator('#world-preview').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());

test('typed seeds reproduce the preview and saved map across creation and reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openNewWorld(page);
  await page.locator('#nature-select').selectOption('grassland');
  await page.locator('#new-dialog').getByLabel('World seed', { exact: true }).fill('123456789');
  const preview = await previewPixels(page);
  await page.locator('#world-seed').fill('123456790');
  expect(await previewPixels(page)).not.toBe(preview);
  await page.locator('#world-seed').fill('123456789');
  expect(await previewPixels(page)).toBe(preview);
  await page.locator('#confirm-new').click();
  await expect(page.locator('#loading-screen')).toBeHidden();
  await expect.poll(async () => (await savedWorld(page))?.seed).toBe(123456789);
  const created = (await savedWorld(page))!;

  await page.reload();
  await expect(page.locator('#loading-screen')).toBeHidden();
  await page.locator('#settings').click();
  await expect(page.locator('#settings-dialog').getByLabel('World seed', { exact: true })).toHaveValue('123456789');
  await expect(page.locator('#current-world-seed')).toHaveAttribute('readonly', '');
  expect((await savedWorld(page))!.terrain).toEqual(created.terrain);

  await page.locator('#new-world').click();
  await page.locator('#nature-select').selectOption('grassland');
  await page.locator('#world-seed').fill('123456789');
  expect(await previewPixels(page)).toBe(preview);
  await page.locator('#confirm-new').click();
  await expect(page.locator('#loading-screen')).toBeHidden();
  await expect(page.locator('#save-status')).toBeHidden();
  expect((await savedWorld(page))!.terrain).toEqual(created.terrain);
  expect(errors).toEqual([]);
});

test('rejects invalid input and accepts both seed boundaries without changing the current world early', async ({ page }) => {
  const original = (await savedWorld(page))!;
  await openNewWorld(page);
  for (const value of ['', '-1', '1.5', '1e3', 'hello', '4294967296', '999999999999999999999']) {
    await page.locator('#world-seed').fill(value);
    await expect(page.locator('#seed-error')).toBeVisible();
    await expect(page.locator('#world-seed')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#confirm-new')).toBeDisabled();
    await expect(page.locator('#world-preview')).toBeHidden();
    await page.keyboard.press('Enter');
    await expect(page.locator('#new-dialog')).toBeVisible();
    expect((await savedWorld(page))!.seed).toBe(original.seed);
  }
  for (const value of ['0', '4294967295']) {
    await page.locator('#world-seed').fill(value);
    await expect(page.locator('#seed-error')).toBeHidden();
    await expect(page.locator('#world-preview')).toBeVisible();
    await expect(page.locator('#confirm-new')).toBeEnabled();
    await page.locator('#confirm-new').click();
    await expect(page.locator('#loading-screen')).toBeHidden();
    await expect.poll(async () => (await savedWorld(page))?.seed).toBe(Number(value));
    await page.reload();
    await expect(page.locator('#loading-screen')).toBeHidden();
    await page.locator('#settings').click();
    await expect(page.locator('#current-world-seed')).toHaveValue(value);
    await page.locator('#new-world').click();
  }
});

test('randomizing changes the seed and preview, keeps settings and cancels without replacing the world', async ({ page }) => {
  await page.goto('/?changelog=1');
  await expect(page.locator('#loading-screen')).toBeHidden();
  const original = (await savedWorld(page))!;
  for (const cancel of ['button', 'escape']) {
    await openNewWorld(page);
    await page.locator('#nature-select').selectOption('jungle');
    await page.locator('#biome-select').selectOption('turtle');
    const seed = await page.locator('#world-seed').inputValue(), preview = await previewPixels(page);
    await page.getByRole('button', { name: 'Randomize', exact: true }).click();
    await expect(page.locator('#world-seed')).not.toHaveValue(seed);
    expect(await previewPixels(page)).not.toBe(preview);
    await expect(page.locator('#nature-select')).toHaveValue('jungle');
    await expect(page.locator('#biome-select')).toHaveValue('turtle');
    await page.locator('#world-seed').fill('invalid');
    await page.locator('#randomize-seed').click();
    await expect(page.locator('#confirm-new')).toBeEnabled();
    if (cancel === 'button') await page.locator('#new-dialog button[value="cancel"]').click();
    else await page.keyboard.press('Escape');
    await expect(page.locator('#new-dialog')).toBeHidden();
    expect((await savedWorld(page))!.seed).toBe(original.seed);
    expect((await savedWorld(page))!.terrain).toEqual(original.terrain);
  }
});

test('copies the current seed to the system clipboard', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Clipboard permissions are supported by Chromium in Playwright.');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const seed = (await savedWorld(page))!.seed;
  await page.locator('#settings').click();
  await page.getByRole('button', { name: 'Copy seed', exact: true }).click();
  await expect(page.locator('#seed-copy-status')).toHaveText('Seed copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(String(seed));
  await expect(page.locator('#settings-dialog')).toBeVisible();
});

test('selects the seed for manual copying when clipboard access is unavailable', async ({ page }) => {
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: undefined }));
  await page.locator('#settings').click();
  await page.locator('#copy-seed').click();
  await expect(page.locator('#seed-copy-status')).toHaveText('Could not copy. Copy the selected seed manually.');
  await expect(page.locator('#current-world-seed')).toBeFocused();
  expect(await page.locator('#current-world-seed').evaluate((input: HTMLInputElement) =>
    input.value.slice(input.selectionStart!, input.selectionEnd!))).toBe(String((await savedWorld(page))!.seed));
  await expect(page.locator('#settings-dialog')).toBeVisible();
});

test('localizes seed controls and validation in every supported language', async ({ page }) => {
  for (const language of languages) {
    await page.locator('#settings').click();
    await page.locator('#language-select').selectOption(language.id);
    await expect(page.locator('#settings-dialog').getByLabel(translate('World seed', language.id), { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: translate('Copy seed', language.id), exact: true })).toBeVisible();
    await page.locator('#new-world').click();
    await expect(page.locator('#new-dialog').getByLabel(translate('World seed', language.id), { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: translate('Randomize', language.id), exact: true })).toBeVisible();
    await page.locator('#world-seed').fill('invalid');
    await expect(page.locator('#seed-error')).toHaveText(translate('Enter a whole number from 0 to 4294967295.', language.id));
    await page.keyboard.press('Escape');
  }
});
