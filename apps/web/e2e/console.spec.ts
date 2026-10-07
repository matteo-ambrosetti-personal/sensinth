import { expect, test, type Page } from '@playwright/test';

async function allSourcesOff(page: Page): Promise<void> {
  const on = page.locator('#sources input[type="checkbox"]:checked');
  while ((await on.count()) > 0) {
    const id = await on.first().getAttribute('id');
    await page.locator(`label[for="${id}"]`).first().click();
    await expect(page.locator(`#${id}`)).not.toBeChecked();
  }
}

async function turnOn(page: Page, id: string): Promise<void> {
  await page.locator(`label[for="src-${id}"]`).first().click();
  await expect(page.locator(`#src-${id}`)).toBeChecked();
}

/** A fingerprint of what the screen shows now. */
async function screenPixels(page: Page): Promise<string> {
  return page.locator('#stage').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 7) h = (h * 31 + (d[i] ?? 0)) >>> 0;
    return `${c.width}x${c.height}:${h}`;
  });
}

test('the screen shows the band, and it moves with the music', async ({ page }) => {
  await page.goto('/');
  await allSourcesOff(page);
  await turnOn(page, 'sim');
  await expect(page.locator('#stage')).toHaveAttribute('aria-label', /waits for Play/);
  await page.locator('#play').click();
  await expect(page.locator('#stage')).toHaveAttribute('aria-label', /playing/, {
    timeout: 8000,
  });
  const a = await screenPixels(page);
  await page.waitForTimeout(700);
  const b = await screenPixels(page);
  expect(a.startsWith('192x108')).toBe(true);
  expect(b).not.toBe(a);
  // Every style has its own scene.
  for (const name of ['Techno', 'Jazz', 'Minimal']) {
    await page.locator('.style-chip', { hasText: name }).first().click();
    await expect(page.locator('#stage')).toHaveAttribute('aria-label', new RegExp(name), {
      timeout: 8000,
    });
  }
});

test('the drift graph follows the piece bar by bar', async ({ page }) => {
  await page.goto('/');
  await allSourcesOff(page);
  await turnOn(page, 'sim');
  await page.locator('#tempo').fill('200');
  await page.locator('#play').click();
  await expect(page.locator('#drift-now')).toHaveText(/^\d+%$/, { timeout: 10000 });
  await expect(page.locator('#drift')).toHaveAttribute('aria-label', /After \d+ bars/);
});

test('one source drives everything; two share it out', async ({ page }) => {
  await page.goto('/');
  await allSourcesOff(page);
  await turnOn(page, 'sim');
  const groups = page.locator('#areas .area-group');
  await expect(groups).toHaveCount(1);
  await expect(groups.first().locator(':scope > .area-chips .area-chip')).toHaveCount(10);
  await expect(page.locator('#areas-note')).toContainText('drives everything');

  await turnOn(page, 'keyboard');
  await expect(groups).toHaveCount(2);
  const chips = async (i: number) =>
    groups.nth(i).locator(':scope > .area-chips .area-chip').allTextContents();
  const a = await chips(0);
  const b = await chips(1);
  // Every area belongs to exactly one of them.
  expect(a.length + b.length).toBe(10);
  expect(a.filter((x) => b.includes(x))).toEqual([]);
  await expect(page.locator('#areas-note')).toContainText('its own part');
});

test('a key press says what it will do, then lands at the next bar', async ({ page }) => {
  await page.goto('/');
  await allSourcesOff(page);
  await turnOn(page, 'keyboard');
  await page.locator('label:has(#det-on)').click();
  await page.locator('#det-loop').selectOption('2');
  await page.locator('#tempo').fill('80');
  await page.locator('#play').click();
  await expect(page.locator('#song-panel')).toBeVisible();
  await page.locator('h1').first().click();
  // Wait for the start of a bar, so the press is still pending for a while.
  await expect(page.locator('#now-pos')).toHaveText(/\.1$/, { timeout: 8000 });
  await page.keyboard.press('KeyQ');
  await expect(page.locator('#banner')).toBeVisible({ timeout: 2000 });
  await expect(page.locator('#banner')).toContainText(/Q ▸ Rewrite T1/i);
  await expect(page.locator('#pending .change')).toHaveCount(1);
  // Then it lands: in the changes, out of the pending list.
  await expect(page.locator('#changes .change')).toHaveCount(1, { timeout: 5000 });
  await expect(page.locator('#changes .change')).toContainText('Rewrite T1');
  await expect(page.locator('#pending .change')).toHaveCount(0);
  await expect(page.locator('#banner')).toContainText(/New song/i);
});

test('with sensors off, moving the pointer never changes the seed’s song', async ({ page }) => {
  await page.goto('/');
  await allSourcesOff(page);
  await turnOn(page, 'pointer');
  await page.locator('label:has(#det-on)').click();
  await page.locator('#det-sensors').selectOption('off');
  await page.locator('#det-loop').selectOption('2');
  await page.locator('#play').click();
  await expect(page.locator('#g-change')).toHaveText('the seed’s own', { timeout: 8000 });
  for (let i = 0; i < 12; i++) {
    await page.mouse.move(40 + i * 70, 60 + (i % 3) * 300);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(2500);
  await expect(page.locator('#g-change')).toHaveText('the seed’s own');
  await expect(page.locator('#zones li').first()).toContainText('Sensors are off');
});
