import { expect, test, type Page } from '@playwright/test';

/** Frames drawn in two seconds, and the longest one, in ms. */
function frames(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ frames: number; worst: number }>((res) => {
        const t0 = performance.now();
        let n = 0;
        let worst = 0;
        let last = t0;
        const f = (t: number) => {
          n++;
          worst = Math.max(worst, t - last);
          last = t;
          if (t - t0 < 2000) requestAnimationFrame(f);
          else res({ frames: n, worst: Math.round(worst) });
        };
        requestAnimationFrame(f);
      }),
  );
}

// Temporary: measures how fast each page draws in each engine, then fails to print it.
test('diag: how fast the pages draw', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  const idle = await frames(page);
  await page.locator('label[for="src-sim"]').first().click();
  await page.locator('#play').click();
  await page.waitForTimeout(1500);
  const play = await frames(page);
  await page.locator('#mode-flow').click();
  await expect(page.locator('.flow-sensor').first()).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(1500);
  const flow = await frames(page);
  const scroll = await page.evaluate(() => window.scrollY);
  await page.locator('#mode-lab').click();
  await page.waitForTimeout(1500);
  const lab = await frames(page);
  expect(JSON.stringify({ idle, play, flow, lab, scroll, errors: errors.slice(0, 5) })).toBe(
    'diag',
  );
});
