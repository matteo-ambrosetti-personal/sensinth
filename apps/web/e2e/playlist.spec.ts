import { expect, test, type Page } from '@playwright/test';

/** The simulated sensors on, so there is always something moving. */
async function simulated(page: Page): Promise<void> {
  await page.locator('label[for="src-sim"]').first().click();
  await expect(page.locator('#src-sim')).toBeChecked();
}

test('a piece has a form, ends, is kept with its diagram, and another one starts', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Short pieces, so the test hears one end.
  await page.goto('/?piece=20-26');
  await simulated(page);
  await page.locator('.style-chip', { hasText: 'Techno' }).click();
  await expect(page.locator('#playlist-on')).toBeChecked();
  await page.locator('#play').click();

  // The piece opens with its intro, and says which piece it is.
  await expect(page.locator('#form')).toBeVisible();
  await expect(page.locator('#form-bar .form-cell').first()).toHaveText('Intro');
  await expect(page.locator('#form-text')).toContainText('Piece 1');
  await expect(page.locator('#pieces-status')).toHaveText('recording this piece');
  // The sensors say what they do, in words.
  await expect(page.locator('#does .fxrow').first()).toBeVisible();
  await expect(page.locator('#does .fx-what').first()).not.toBeEmpty();
  // Then the riff.
  await expect(page.locator('#form-bar .form-cell[data-kind="riff"]')).toBeVisible({
    timeout: 30_000,
  });

  // It ends, is kept, and the next one starts from its intro.
  await expect(page.locator('#form-text')).toContainText('Piece 2', { timeout: 120_000 });
  const piece = page.locator('#pieces .piece').first();
  await expect(piece).toBeVisible({ timeout: 10_000 });
  await expect(piece.locator('.piece-title')).toContainText('Piece 1 · Techno');
  await expect(piece.locator('.piece-meta')).toContainText('Intro → Riff');
  await expect(piece.locator('.piece-meta')).toContainText('Outro');
  await expect(piece.locator('audio')).toHaveCount(1);
  // The diagram is a picture with a row per sensor.
  const svg = await piece
    .locator('.piece-diagram img')
    .evaluate(async (img: HTMLImageElement) => (await fetch(img.src)).text());
  expect(svg).toContain('<svg');
  expect(svg).toContain('Piece 1 · Techno');
  expect(svg).toContain('Shake (sim)');
  // The recording is a real file.
  const bytes = await piece
    .locator('audio')
    .evaluate(async (a: HTMLAudioElement) => (await (await fetch(a.src)).blob()).size);
  expect(bytes).toBeGreaterThan(20_000);

  // Both downloads hand over a file.
  const [music] = await Promise.all([
    page.waitForEvent('download'),
    piece.getByRole('button', { name: 'Download the music' }).click(),
  ]);
  expect(music.suggestedFilename()).toMatch(/^sensinth-\d{8}-\d{4}-techno\.(webm|m4a|ogg)$/);
  const [diagram] = await Promise.all([
    page.waitForEvent('download'),
    piece.getByRole('button', { name: 'Download the diagram' }).click(),
  ]);
  expect(diagram.suggestedFilename()).toMatch(/-techno-sensors\.svg$/);

  // Stopped pieces are kept too, and the shelf survives a reload.
  await page.locator('#play').click();
  await page.reload();
  await expect(page.locator('#pieces .piece').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('the shelf keeps the latest three pieces', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/?piece=8-10');
  await simulated(page);
  await page.locator('.style-chip', { hasText: 'Drum & bass' }).click();
  await page.locator('#play').click();
  // Skip through pieces: each one stopped after a while is kept.
  for (let i = 2; i <= 5; i++) {
    await page.waitForTimeout(21_000);
    await page.locator('#next-piece').click();
    await expect(page.locator('#form-text')).toContainText(`Piece ${i}`, { timeout: 15_000 });
  }
  // The fourth piece is kept a moment after it ends: wait for it, then count.
  const titles = page.locator('#pieces .piece-title');
  await expect(titles.first()).toContainText('Piece 4', { timeout: 15_000 });
  await expect(page.locator('#pieces .piece')).toHaveCount(3);
  await expect(titles.nth(2)).toContainText('Piece 2');
});

test('with the playlist off the piece never ends and nothing is recorded', async ({ page }) => {
  await page.goto('/');
  await simulated(page);
  await page.locator('label:has(#playlist-on)').click();
  await expect(page.locator('#playlist-on')).not.toBeChecked();
  await page.locator('#play').click();
  await expect(page.locator('#now-chord')).not.toHaveText('–', { timeout: 5000 });
  await expect(page.locator('#form')).toBeHidden();
  await expect(page.locator('#pieces-status')).toHaveText('playlist off');
  await page.reload();
  await expect(page.locator('#playlist-on')).not.toBeChecked();
});

test('the sensors pick the next piece’s style when asked to', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?piece=8-10');
  await simulated(page);
  await page.locator('#playlist-styles').selectOption('sensors');
  await page.locator('.style-chip', { hasText: 'Chiptune' }).click();
  await page.locator('#play').click();
  await expect(page.locator('#form-text')).toContainText('Piece 2', { timeout: 90_000 });
  // Another style than the one just played, and its key on the console is the one lit.
  const lit = page.locator('.style-chip[aria-checked="true"]');
  await expect(lit).toHaveCount(1);
  await expect(lit).not.toHaveText('Chiptune');
});
