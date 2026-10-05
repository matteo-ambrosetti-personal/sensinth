import { expect, test } from '@playwright/test';

test('every style renders audible, unclipped, finite audio', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/render-test.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const styles = await page.evaluate(() => window.sensinthStyles);
  expect(styles.length).toBeGreaterThan(0);
  for (const id of styles) {
    const stats = await page.evaluate((s) => window.sensinthRender(s, 8), id);
    expect(stats.nonFinite, `${id}: NaN/Infinity samples`).toBe(0);
    expect(stats.events, `${id}: notes`).toBeGreaterThan(25);
    expect(stats.rms, `${id}: not silent`).toBeGreaterThan(0.01);
    expect(stats.peak, `${id}: below 0 dBFS`).toBeLessThan(1);
    expect(stats.tracks.length, `${id}: tracks`).toBeGreaterThanOrEqual(4);
  }
});

test('muting tracks silences exactly them', async ({ page }) => {
  await page.goto('/render-test.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const all = await page.evaluate(() => window.sensinthRender('chiptune', 8));
  const none = await page.evaluate(() => window.sensinthRender('chiptune', 8, { none: true }));
  const one = await page.evaluate(() => window.sensinthRender('chiptune', 8, { only: 't1' }));
  expect(none.rms).toBeLessThan(0.002);
  expect(one.rms).toBeGreaterThan(0.005);
  expect(one.rms).toBeLessThan(all.rms);
  // Muting never changes what the engine writes.
  expect(one.events).toBe(all.events);
});

test('the app loads and plays', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#styles [role="radio"]').first()).toBeVisible();
  await expect(page.locator('#sensors li').first()).toBeVisible();
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#now-chord')).not.toHaveText('–', { timeout: 5000 });
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});
