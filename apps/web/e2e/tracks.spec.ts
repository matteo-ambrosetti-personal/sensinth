import { expect, test, type Locator, type Page } from '@playwright/test';

/** A hash of a canvas's pixels, to see whether it changed. */
function pixels(canvas: Locator): Promise<number> {
  return canvas.evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 7) h = (h * 31 + (d[i] ?? 0)) | 0;
    return h;
  });
}

async function level(track: Locator): Promise<number> {
  return Number(await track.locator('.track-scope').getAttribute('data-level'));
}

async function startWithSimulatedSensors(page: Page, style?: string): Promise<void> {
  await page.goto('/');
  if (style) await page.locator('.style-chip', { hasText: style }).click();
  await page.locator('label[for="src-sim"]').first().click();
  await expect(page.locator('#src-sim')).toBeChecked();
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'true');
}

test('each track shows its own scope, step grid, params and mute', async ({ page }) => {
  // Chiptune always has 5–7 tracks; Free, the default, may have as few as 3.
  await startWithSimulatedSensors(page, 'Chiptune');
  const rows = page.locator('#tracks .track:not(.is-fx)');
  await expect(rows.first()).toBeVisible({ timeout: 8000 });
  expect(await rows.count()).toBeGreaterThanOrEqual(4);
  await expect(rows.first().locator('.track-grid')).toHaveAttribute(
    'aria-label',
    /\d+ steps, \d+ trigs/,
  );
  await expect(rows.first().locator('.track-params li')).toHaveCount(6);

  // The playhead moves.
  const grid = rows.first().locator('.track-grid');
  const before = await pixels(grid);
  await expect.poll(() => pixels(grid), { timeout: 3000 }).not.toBe(before);

  // Find a track that is sounding, mute it: its scope goes flat, the others play on.
  let playing: Locator | undefined;
  await expect
    .poll(
      async () => {
        for (const row of await rows.all()) {
          if ((await level(row)) > 0.0005) {
            playing = row;
            return true;
          }
        }
        return false;
      },
      { timeout: 10000 },
    )
    .toBe(true);
  const track = playing as Locator;
  await track.locator('.mute').click();
  await expect(track.locator('.mute')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => level(track), { timeout: 4000 }).toBe(0);
  await expect(track).toHaveClass(/is-muted/);
  await track.locator('.mute').click();
  await expect(track.locator('.mute')).toHaveAttribute('aria-pressed', 'false');
});

test('the FX lane shows its effects and fires them', async ({ page }) => {
  await startWithSimulatedSensors(page);
  const lane = page.locator('#tracks .track.is-fx');
  await expect(lane).toBeVisible({ timeout: 8000 });
  await expect(lane.locator('.track-name')).toHaveText('FX lane');
  await expect(lane.locator('.track-grid')).toHaveAttribute('aria-label', /\d+ trigs/);
  // Sensor events, the lane and the song's structure fire effects within a few bars.
  await expect(lane.locator('.track-fx-now')).toHaveClass(/is-on/, { timeout: 20000 });
  await lane.locator('.mute').click();
  await expect(lane.locator('.mute')).toHaveAttribute('aria-pressed', 'true');
});

test('the modulation matrix routes every sensor at least twice', async ({ page }) => {
  await startWithSimulatedSensors(page);
  // Every routing is on the Flow page, with the diagram.
  await page.locator('#mode-flow').click();
  const sensors = page.locator('#matrix .mod-group').first();
  await expect(sensors).toContainText('Sensors', { timeout: 8000 });
  const count = Number((await sensors.textContent())?.split('·')[1]);
  // Ten simulated channels, at least two strong routes each.
  expect(count).toBeGreaterThanOrEqual(20);
  await expect(page.locator('#matrix')).toContainText('LFOs');
  await expect(page.locator('#matrix')).toContainText('Chaos');
  // Bars move: some route adds something right now.
  await expect
    .poll(
      () =>
        page
          .locator('#matrix .mod-value')
          .evaluateAll(
            (els) => els.filter((e) => parseFloat((e as HTMLElement).style.width) > 1).length,
          ),
      { timeout: 5000 },
    )
    .toBeGreaterThan(5);
  await page.locator('#mode-play').click();
  await expect(page.locator('#g-hash')).toHaveText(/^#[0-9a-f]{6}$/);
  await expect(page.locator('#g-key')).toContainText(/[A-G]/);
});

test('no sensor, no music', async ({ page }) => {
  await page.goto('/');
  // A computer starts with the pointer, the keyboard and the clock: switch them off.
  for (const id of ['pointer', 'keyboard', 'device']) {
    if (await page.locator(`#src-${id}`).isChecked()) {
      await page.locator(`label[for="src-${id}"]`).first().click();
    }
    await expect(page.locator(`#src-${id}`)).not.toBeChecked();
  }
  await expect(page.locator('#play')).toBeDisabled();
  await expect(page.locator('#hint')).toContainText('Turn on at least one sensor source');
  await page.locator('label[for="src-sim"]').first().click();
  await expect(page.locator('#play')).toBeEnabled();
});
