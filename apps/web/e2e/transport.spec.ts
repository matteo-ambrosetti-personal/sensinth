import { expect, test, type Page } from '@playwright/test';

/** Only the keyboard on, so nothing else changes the song. */
async function keyboardOnly(page: Page): Promise<void> {
  const on = page.locator('#sources input[type="checkbox"]:checked');
  while ((await on.count()) > 0) {
    const id = await on.first().getAttribute('id');
    await page.locator(`label[for="${id}"]`).first().click();
    await expect(page.locator(`#${id}`)).not.toBeChecked();
  }
  await page.locator('label[for="src-keyboard"]').first().click();
  await expect(page.locator('#src-keyboard')).toBeChecked();
}

test('a style brings its suggested tempo', async ({ page }) => {
  await page.goto('/');
  await page.locator('.style-chip', { hasText: 'Lo-fi' }).click();
  await expect(page.locator('#tempo-value')).toHaveText('82');
  await page.locator('#tempo-up').click();
  await expect(page.locator('#tempo-value')).toHaveText('83');
  await page.locator('.style-chip', { hasText: 'Techno' }).click();
  await expect(page.locator('#tempo-value')).toHaveText('128');
  // The tempo you set stays until you pick another style.
  await page.locator('#tempo-down').click();
  await page.reload();
  await expect(page.locator('#tempo-value')).toHaveText('127');
});

test('start over plays the seed’s own song again', async ({ page }) => {
  await page.goto('/');
  const restart = page.locator('#restart');
  await expect(restart).toBeDisabled();
  await keyboardOnly(page);
  await page.locator('label:has(#det-on)').click();
  await page.locator('#det-loop').selectOption('2');
  await page.locator('#play').click();
  await expect(restart).toBeEnabled();
  await page.locator('h1').first().click();
  await page.keyboard.press('KeyO');
  await expect(page.locator('#g-change')).toContainText('1 change', { timeout: 4000 });
  await restart.click();
  await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#g-change')).toHaveText('the seed’s own');
  await expect(page.locator('#song-loop')).toContainText('Bar 1 of 2');
  await page.locator('#play').click();
  await expect(restart).toBeDisabled();
});

test('the Android app keeps playing in the background until Stop', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as {
      playbackCalls: string[];
      playbackStop?: () => void;
      sensinthPlaybackStub: unknown;
    };
    w.playbackCalls = [];
    w.sensinthPlaybackStub = {
      start: async () => void w.playbackCalls.push('start'),
      stop: async () => void w.playbackCalls.push('stop'),
      addListener: async (_event: string, listener: () => void) => {
        w.playbackStop = listener;
        return { remove: async () => {} };
      },
    };
  });
  await page.goto('/');
  const calls = () =>
    page.evaluate(() => (window as unknown as { playbackCalls: string[] }).playbackCalls);
  await page.locator('label:has(#det-on)').click();
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'true');
  expect(await calls()).toEqual(['start']);
  // Starting over keeps the notification.
  await page.locator('#restart').click();
  await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'true');
  expect(await calls()).toEqual(['start']);
  // Stop in the notification stops the music.
  await page.evaluate(() => (window as unknown as { playbackStop: () => void }).playbackStop());
  await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'false');
  expect(await calls()).toEqual(['start']);
  await page.locator('#play').click();
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'false');
  expect(await calls()).toEqual(['start', 'start', 'stop']);
});
