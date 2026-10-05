import { expect, test, type Page } from '@playwright/test';

async function useSeed(page: Page, seed: number): Promise<void> {
  const on = page.locator('#det-on');
  if (!(await on.isChecked())) await page.locator('label:has(#det-on)').click();
  await expect(on).toBeChecked();
  await page.locator('#det-seed').fill(String(seed));
  await page.locator('#det-seed').press('Enter');
  await page.locator('#det-seed').blur();
}

/** The tracks the piece starts with: machine and length of each. */
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

test('the deterministic switch and seed are remembered', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#det-on')).not.toBeChecked();
  await expect(page.locator('#det-seed')).toBeDisabled();
  await useSeed(page, 1234);
  await expect(page.locator('#det-desc')).toContainText('The seed writes the tracks');
  await page.reload();
  await expect(page.locator('#det-on')).toBeChecked();
  await expect(page.locator('#det-seed')).toHaveValue('1234');
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

test('plays with every sensor off, and every key typed plays a note', async ({ page }) => {
  await page.goto('/');
  // Every source off: deterministic mode still plays.
  const on = page.locator('#sources input[type="checkbox"]:checked');
  while ((await on.count()) > 0) {
    const id = await on.first().getAttribute('id');
    await page.locator(`label[for="${id}"]`).first().click();
    await expect(page.locator(`#${id}`)).not.toBeChecked();
  }
  await useSeed(page, 42);
  await expect(page.locator('#play')).toBeEnabled();
  await page.locator('#play').click();
  await expect(page.locator('#g-hash-label')).toHaveText('Seed');
  await expect(page.locator('#g-hash')).toHaveText('42');
  await expect(page.locator('#g-key')).toContainText('from the seed');
  await expect(page.locator('#g-change')).toHaveText('0');

  // Typing needs the keyboard: switch Pointer & keys on, then type.
  await page.locator('label[for="src-pointer"]').first().click();
  await expect(page.locator('#src-pointer')).toBeChecked();
  for (const key of ['a', 's', 'd', 'f']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(120);
  }
  await expect(page.locator('#g-change')).toHaveText('4', { timeout: 4000 });
  // Typing into the seed field plays nothing.
  await page.locator('#det-seed').press('5');
  await page.waitForTimeout(300);
  await expect(page.locator('#g-change')).toHaveText('4');
});

test('renders the same piece for the same seed and typing, a close one when a little off', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto('/render-test.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const render = (interval: number) =>
    page.evaluate(
      (i) => window.sensinthRender('chiptune', 8, { seed: 42, keys: { key: 'a', interval: i } }),
      interval,
    );
  const a = await render(0.25);
  const b = await render(0.25);
  const slower = await render(0.255);
  expect(a.eventNotes).toBeGreaterThan(50);
  // The same notes; the browser's audio engine itself varies in the sixth digit.
  expect({ ...b, rms: 0, peak: 0 }).toEqual({ ...a, rms: 0, peak: 0 });
  expect(Math.abs(b.rms - a.rms) / a.rms).toBeLessThan(1e-4);
  // A little slower: the same tracks, nearly the same notes, a slightly different sound.
  expect(slower.tracks).toEqual(a.tracks);
  expect(Math.abs(slower.events - a.events)).toBeLessThanOrEqual(a.events * 0.05);
  const drift = Math.abs(slower.rms - a.rms) / a.rms;
  expect(drift).toBeLessThan(0.1);
});

test('a recording replays its presses from Play, the same every time', async ({ page }) => {
  await page.goto('/');
  const on = page.locator('#sources input[type="checkbox"]:checked');
  while ((await on.count()) > 0) {
    const id = await on.first().getAttribute('id');
    await page.locator(`label[for="${id}"]`).first().click();
    await expect(page.locator(`#${id}`)).not.toBeChecked();
  }
  // Six presses in the first two seconds; a last reading makes it four seconds long.
  const recording = {
    format: 'sensinth-recording',
    version: 1,
    startedAt: '2026-10-05T12:00:00.000Z',
    descriptors: [
      { id: 'computer.keys', kind: 'keys.rate', label: 'Typing', range: [0, 15], rateHz: 30 },
      { id: 'phone.light', kind: 'light', label: 'Light', range: [0, 10000], rateHz: 10 },
    ],
    samples: [
      [0, 1, 250],
      [4, 1, 260],
    ],
    events: [0.3, 0.6, 0.9, 1.2, 1.5, 1.8].map((t, i) => [t, 0, 'key', i, 0.8]),
  };
  await page.locator('#load-recording').setInputFiles({
    name: 'typing.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(recording)),
  });
  await expect(page.locator('#src-replay')).toBeChecked();
  await useSeed(page, 42);
  for (let take = 0; take < 2; take++) {
    // Let the replay run on before Play: Play starts it over.
    await page.waitForTimeout(1200);
    await page.locator('#play').click();
    await expect(page.locator('#g-hash')).toHaveText('42');
    await expect(page.locator('#g-change')).toHaveText('6', { timeout: 4000 });
    await page.waitForTimeout(600);
    await expect(page.locator('#g-change')).toHaveText('6');
    await page.locator('#play').click();
    await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'false');
  }
});
