import { expect, test, type Page } from '@playwright/test';

async function useSeed(page: Page, seed: number): Promise<void> {
  const on = page.locator('#det-on');
  if (!(await on.isChecked())) await page.locator('label:has(#det-on)').click();
  await expect(on).toBeChecked();
  await page.locator('#det-seed').fill(String(seed));
  await page.locator('#det-seed').press('Enter');
  await page.locator('#det-seed').blur();
}

async function allSourcesOff(page: Page): Promise<void> {
  const on = page.locator('#sources input[type="checkbox"]:checked');
  while ((await on.count()) > 0) {
    const id = await on.first().getAttribute('id');
    await page.locator(`label[for="${id}"]`).first().click();
    await expect(page.locator(`#${id}`)).not.toBeChecked();
  }
}

/** The tracks the song starts with. */
async function tracksOnPlay(page: Page): Promise<string[]> {
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'true');
  const rows = page.locator('#tracks .track:not(.is-fx)');
  await expect(rows.first()).toBeVisible({ timeout: 8000 });
  const names = await rows.locator('.track-name').allTextContents();
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'false');
  return names;
}

test('the deterministic settings are remembered', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#det-on')).not.toBeChecked();
  await expect(page.locator('#det-seed')).toBeDisabled();
  await expect(page.locator('#det-loop')).toBeDisabled();
  await useSeed(page, 1234);
  await page.locator('#det-loop').selectOption('4');
  await page.locator('#det-repeat').selectOption('accumulate');
  await page.locator('#det-sensors').selectOption('steps');
  await expect(page.locator('#det-desc')).toContainText('4-bar song that loops');
  await expect(page.locator('#det-desc')).toContainText('does it once more');
  await page.reload();
  await expect(page.locator('#det-on')).toBeChecked();
  await expect(page.locator('#det-seed')).toHaveValue('1234');
  await expect(page.locator('#det-loop')).toHaveValue('4');
  await expect(page.locator('#det-repeat')).toHaveValue('accumulate');
  await expect(page.locator('#det-sensors')).toHaveValue('steps');
  await expect(page.locator('#hint')).toContainText('Seed 1234');
});

test('the same seed plays the same tracks, another seed others', async ({ page }) => {
  await page.goto('/');
  await useSeed(page, 42);
  const first = await tracksOnPlay(page);
  const again = await tracksOnPlay(page);
  expect(first.length).toBeGreaterThanOrEqual(3);
  expect(again).toEqual(first);
  const others = new Set<string>();
  for (const seed of [7, 8, 9]) {
    await useSeed(page, seed);
    others.add((await tracksOnPlay(page)).join('|'));
  }
  others.add(first.join('|'));
  expect(others.size).toBeGreaterThan(1);
});

test('loops with no sensor; a key changes the song, and toggles back', async ({ page }) => {
  await page.goto('/');
  await allSourcesOff(page);
  await useSeed(page, 42);
  await page.locator('#det-loop').selectOption('2');
  await expect(page.locator('#play')).toBeEnabled();
  await page.locator('#play').click();
  await expect(page.locator('#g-hash-label')).toHaveText('Seed');
  await expect(page.locator('#g-hash')).toHaveText('42');
  await expect(page.locator('#g-key')).toContainText('from the seed');
  await expect(page.locator('#song-panel')).toBeVisible();
  await expect(page.locator('#song-loop')).toContainText('of 2');
  await expect(page.locator('#changes-empty')).toBeVisible();
  await expect(page.locator('#g-change')).toHaveText('the seed’s own');

  // Turn the keyboard on and press O: the key moves up a fifth from the next bar.
  await page.locator('label[for="src-keyboard"]').first().click();
  await expect(page.locator('#src-keyboard')).toBeChecked();
  await page.locator('h1').first().click();
  await page.keyboard.press('KeyO');
  const change = page.locator('#changes .change');
  await expect(change).toHaveCount(1, { timeout: 4000 });
  await expect(change).toContainText('Key O');
  await expect(change).toContainText('Key up a fifth');
  await expect(page.locator('#g-change')).toContainText('1 change');
  const version = await page.locator('#g-change').textContent();
  // Nothing more happens: the new song stays.
  await page.waitForTimeout(1500);
  await expect(page.locator('#g-change')).toHaveText(version ?? '');
  // Toggle: O again goes back to the seed's own song.
  await page.keyboard.press('KeyO');
  await expect(change).toHaveCount(0, { timeout: 4000 });
  await expect(page.locator('#g-change')).toHaveText('the seed’s own');
  // Typing into the seed field changes nothing.
  await page.locator('#det-seed').press('KeyA');
  await page.waitForTimeout(800);
  await expect(change).toHaveCount(0);
});

test('lists what every key does', async ({ page }) => {
  await page.goto('/');
  await useSeed(page, 42);
  await page.locator('#play').click();
  await page.locator('.keymap summary').click();
  const table = page.locator('#keymap');
  await expect(table).toContainText('Rotate track n right');
  await expect(table).toContainText('A–K');
  await expect(table).toContainText('Key up a fifth');
  await expect(table).toContainText('Other keys');
});

test('a recording replays its key presses from Play, the same every time', async ({ page }) => {
  await page.goto('/');
  await allSourcesOff(page);
  const recording = {
    format: 'sensinth-recording',
    version: 1,
    startedAt: '2026-10-05T12:00:00.000Z',
    descriptors: [
      { id: 'computer.keys', kind: 'keys.rate', label: 'Typing', range: [0, 15], rateHz: 30 },
    ],
    samples: [
      [0, 0, 0],
      [6, 0, 0],
    ],
    // O, then L: key up a fifth, other chords.
    events: [
      [0.3, 0, 'key', 21, 0.8],
      [0.6, 0, 'key', 34, 0.8],
    ],
  };
  await page.locator('#load-recording').setInputFiles({
    name: 'typing.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(recording)),
  });
  await expect(page.locator('#src-replay')).toBeChecked();
  await useSeed(page, 42);
  await page.locator('#det-loop').selectOption('2');
  const versions: string[] = [];
  for (let take = 0; take < 2; take++) {
    // Let the replay run on before Play: Play starts it over.
    await page.waitForTimeout(1200);
    await page.locator('#play').click();
    await expect(page.locator('#g-change')).toContainText('2 changes', { timeout: 5000 });
    await expect(page.locator('#changes .change')).toHaveCount(2);
    versions.push((await page.locator('#g-change').textContent()) ?? '');
    await page.locator('#play').click();
    await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'false');
  }
  expect(versions[0]).toContain('2 changes');
  expect(versions[1]).toBe(versions[0]);
});

test('renders the same song for the same seed and keys', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/render-test.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const render = (keys: { code: string; at: number }[]) =>
    page.evaluate(
      (k) => window.sensinthRender('chiptune', 8, { seed: 42, loopBars: 2, keys: k }),
      keys,
    );
  const quiet = await render([]);
  const a = await render([{ code: 'KeyO', at: 2 }]);
  const b = await render([{ code: 'KeyO', at: 2 }]);
  expect(quiet.versions).toEqual(['base']);
  expect(a.versions.length).toBe(2);
  expect(a.versions[0]).toBe('base');
  // The same notes; the browser's audio engine itself varies in the sixth digit.
  expect({ ...b, rms: 0, peak: 0 }).toEqual({ ...a, rms: 0, peak: 0 });
  expect(Math.abs(b.rms - a.rms) / a.rms).toBeLessThan(1e-4);
});

test('a browser on a Mac explains where the tilt is', async ({ browser }) => {
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  });
  const page = await context.newPage();
  await page.goto('/');
  const row = page.locator('.source').filter({ has: page.locator('#src-motion') });
  await expect(page.locator('#src-motion')).toBeDisabled();
  await expect(row).toContainText('Browsers can’t read a Mac’s tilt sensor');
  await expect(row.locator('.source-link')).toHaveAttribute('href', /mac-latest/);
  await context.close();
});
