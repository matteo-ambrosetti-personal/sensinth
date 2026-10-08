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
  // A source with one sensor still says which sensor moves what.
  const keyboard = page.locator('#areas .area-group[data-group="keyboard"]');
  await expect(keyboard.locator('.area-channels li')).toHaveCount(1);
  await expect(keyboard.locator('.area-channels li')).toContainText('→');
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

test('a menu stepped with the keyboard keeps its keys while a song plays', async ({ page }) => {
  await page.goto('/');
  await allSourcesOff(page);
  await turnOn(page, 'keyboard');
  await page.locator('label:has(#det-on)').click();
  await page.locator('#play').click();
  await expect(page.locator('#song-panel')).toBeVisible({ timeout: 8000 });
  const repeat = page.locator('#det-repeat');
  const before = await repeat.inputValue();
  await repeat.focus();
  await page.keyboard.press('ArrowDown');
  await expect(repeat).not.toHaveValue(before);
  await expect(repeat).toBeFocused();
  // The key went to the menu, not to the music.
  await page.waitForTimeout(300);
  await expect(page.locator('#pending .change')).toHaveCount(0);
});

test('only the track an edit changed flashes when it lands', async ({ page }) => {
  await page.goto('/');
  await allSourcesOff(page);
  await turnOn(page, 'keyboard');
  await page.locator('label:has(#det-on)').click();
  await page.locator('#det-loop').selectOption('2');
  await page.locator('#tempo').fill('160');
  await page.locator('#play').click();
  await expect(page.locator('#song-panel')).toBeVisible({ timeout: 8000 });
  await page.locator('h1').first().click();
  await page.keyboard.press('KeyQ');
  await expect(page.locator('#changes .change')).toHaveCount(1, { timeout: 5000 });
  // From now on, note every track row that lights up.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { flashed: string[] }).flashed = seen;
    new MutationObserver((records) => {
      for (const r of records) {
        const el = r.target as HTMLElement;
        if (el.classList.contains('is-flash') && el.dataset.slot) seen.push(el.dataset.slot);
      }
    }).observe(document.querySelector('#tracks') as Node, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  });
  await page.keyboard.press('KeyW');
  await expect(page.locator('#changes .change')).toHaveCount(2, { timeout: 5000 });
  await page.waitForTimeout(200);
  const flashed = await page.evaluate(() => (window as unknown as { flashed: string[] }).flashed);
  expect([...new Set(flashed)]).toEqual(['t2']);
});

test('the Blues screen paints all of its picture', async ({ page }) => {
  await page.goto('/');
  await page.locator('.style-chip', { hasText: 'Chiptune' }).click();
  await page.waitForTimeout(300);
  await page.locator('.style-chip', { hasText: 'Blues' }).click();
  // After the wipe, the yard left of the porch is painted, not left black.
  await page.waitForTimeout(1500);
  const black = await page.locator('#stage').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 64, 96, 14).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0) n++;
    return n;
  });
  expect(black).toBe(0);
});

test('Stop while Start over is starting the audio stops the music', async ({ page }) => {
  // A slow device: the audio takes a moment to start.
  await page.addInitScript(() => {
    const resume = AudioContext.prototype.resume;
    AudioContext.prototype.resume = function (this: AudioContext) {
      return new Promise<void>((done) => setTimeout(done, 400)).then(() => resume.call(this));
    };
  });
  await page.goto('/');
  await allSourcesOff(page);
  await turnOn(page, 'sim');
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Stop', { timeout: 8000 });
  await page.locator('#restart').click();
  await page.locator('#play').click();
  await page.waitForTimeout(1200);
  await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Play');
  await expect(page.locator('#now-key')).toHaveText('Stopped');
});
