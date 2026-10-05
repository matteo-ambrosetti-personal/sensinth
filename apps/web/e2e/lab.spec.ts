import { expect, test, type Page } from '@playwright/test';

async function dial(page: Page, name: string): Promise<number> {
  const row = page.locator('.dial').filter({ has: page.getByText(name, { exact: true }) });
  return Number(await row.locator('.dial-value').textContent());
}

test('the sensor lab shows one sensor at a time and can solo it', async ({ page }) => {
  await page.goto('/');
  if (!(await page.locator('#src-sim').isChecked())) {
    await page.locator('label[for="src-sim"]').first().click();
  }
  await expect(page.locator('#src-sim')).toBeChecked();

  await page.locator('#mode-lab').click();
  await expect(page.locator('#tempo')).toBeHidden();
  await expect(page.locator('#lab-channel')).toBeVisible();

  await page.selectOption('#lab-channel', 'sim.light');
  await expect(page.locator('#lab-raw-title')).toHaveText('Raw reading (lx)');
  await expect(page.locator('#lab-raw-now')).toHaveText(/\d+(\.\d+)? lx/);
  await expect(page.locator('#lab-drives')).toContainText('brightness');
  await expect(page.locator('#lab-rate')).toHaveText(/^(2\d|3\d)\.\d per second$/, {
    timeout: 5000,
  });
  await expect(page.locator('#lab-range')).toContainText('lx');

  // Both charts have drawn something.
  for (const id of ['lab-raw', 'lab-proc']) {
    const inked = await page.locator(`#${id}`).evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if ((d[i] ?? 0) > 0) n++;
      return n;
    });
    expect(inked).toBeGreaterThan(500);
  }

  // Solo the shake sensor: register (driven by tilt) falls back to its resting value.
  await page.selectOption('#lab-channel', 'sim.accel');
  await page.locator('label:has(#lab-solo)').click();
  await expect(page.locator('#lab-solo')).toBeChecked();
  await expect.poll(() => dial(page, 'Register'), { timeout: 15000 }).toBe(50);

  // Back to Play: solo ends and the play controls return.
  await page.locator('#mode-play').click();
  await expect(page.locator('#tempo')).toBeVisible();
  await expect(page.locator('#lab-solo')).not.toBeChecked();
});
