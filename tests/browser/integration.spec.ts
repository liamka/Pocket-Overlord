import { expect, test } from '@playwright/test';
import { migrationWorld } from '../helpers';
import { migrations } from '../../src/systems/migration';
import { LANGUAGE_KEY } from '../../src/i18n';

test('loads newcomer status in the real game, translates it and preserves it after reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const world = migrationWorld(), family = [...world.query('person')];
  world.tick = 300; migrations(world);
  for (const [i, e] of family.entries()) {
    Object.assign(e.components.position!, { x: 34 + i * 2, y: 22 }); world.spatial.update(e);
  }
  world.tick = 330; migrations(world); world.paused = true;
  family[1].components.citizen!.integration!.status = 'settled';
  family[2].components.citizen!.integration!.status = 'isolated';
  world.announce(`${world.society.villages[1].name}: Cora 1 settled into the community`);
  await page.route('**/integration-storage', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Save fixture</title>' }));
  await page.goto('/integration-storage');
  const snapshot: unknown = world.snapshot();
  await page.evaluate(({ snapshot, languageKey }) => new Promise<void>((resolve, reject) => {
    localStorage.setItem(languageKey, 'en');
    const open = indexedDB.open('little-world', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('worlds');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('worlds', 'readwrite');
      tx.objectStore('worlds').put(snapshot, 'last');
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  }), { snapshot, languageKey: LANGUAGE_KEY });
  await page.goto('/');
  await expect(page.locator('#village-list')).toContainText('Newcomers: 1 settling in · 1 settled · 1 isolated');
  await expect(page.locator('#chronicle')).toContainText('Cora 1 settled into the community');
  await page.reload();
  await expect(page.locator('#village-list')).toContainText('Newcomers: 1 settling in · 1 settled · 1 isolated');
  await page.evaluate(key => localStorage.setItem(key, 'ru'), LANGUAGE_KEY);
  await page.reload();
  await expect(page.locator('#village-list')).toContainText('Переселенцы: 1 осваиваются · 1 прижились · 1 изолированы');
  await expect(page.locator('#chronicle')).toContainText('Cora 1 прижился в общине');
  expect(errors).toEqual([]);
});
