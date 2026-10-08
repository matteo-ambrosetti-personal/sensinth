import { expect, test, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Reads a dial's displayed value (0..100). */
async function dial(page: Page, name: string): Promise<number> {
  const row = page.locator('.dial').filter({ has: page.getByText(name, { exact: true }) });
  return Number(await row.locator('.dial-value').textContent());
}

function sensorRow(page: Page, label: string) {
  return page.locator('.sensor').filter({ has: page.getByText(label, { exact: true }) });
}

/** The live sensors are on the Lab page; the sources and the dials on Play. */
async function toLab(page: Page): Promise<void> {
  await page.locator('#mode-lab').click();
}

async function toPlay(page: Page): Promise<void> {
  await page.locator('#mode-play').click();
}

test.describe('on a phone', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 400, height: 860 } });

  test.beforeEach(async ({ page }) => {
    // Stand-in for the phone's motion hardware: 60 Hz events, shaking on demand.
    await page.addInitScript(() => {
      const w = window as unknown as { shake: boolean };
      w.shake = false;
      let i = 0;
      setInterval(() => {
        i++;
        const a = w.shake ? 12 * Math.abs(Math.sin(i / 3)) : 0.02;
        window.dispatchEvent(
          new DeviceMotionEvent('devicemotion', {
            acceleration: { x: a, y: 0, z: 0 },
            accelerationIncludingGravity: { x: a, y: 0, z: 9.81 },
            rotationRate: { alpha: w.shake ? 200 : 0, beta: 0, gamma: 0 },
            interval: 16,
          }),
        );
        window.dispatchEvent(
          new DeviceOrientationEvent('deviceorientation', { alpha: 10, beta: 30, gamma: -10 }),
        );
      }, 16);
    });
  });

  test('motion is on by default and shaking raises the energy', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#src-motion')).toBeChecked();
    await expect(page.locator('#src-sim')).not.toBeChecked();
    await toLab(page);
    await expect(sensorRow(page, 'Shake')).toBeVisible();
    await expect(sensorRow(page, 'Tilt')).toBeVisible();
    await expect(sensorRow(page, 'Time of day')).toBeVisible();

    await toPlay(page);
    await page.waitForTimeout(2500);
    const calm = await dial(page, 'Energy');
    await page.evaluate(() => ((window as unknown as { shake: boolean }).shake = true));
    await expect.poll(() => dial(page, 'Energy'), { timeout: 8000 }).toBeGreaterThan(calm + 25);
    await toLab(page);
    await expect(sensorRow(page, 'Shake').locator('.route.trigger').first()).toContainText('onset');
  });
});

test('on a computer, the pointer and keyboard drive the music', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#src-pointer')).toBeChecked();
  await expect(page.locator('#src-sim')).not.toBeChecked();
  await toLab(page);
  await expect(sensorRow(page, 'Pointer speed')).toBeVisible();
  await toPlay(page);
  await page.waitForTimeout(2000);
  const calm = await dial(page, 'Energy');
  const deadline = Date.now() + 4000;
  for (let i = 0; Date.now() < deadline; i++) {
    await page.mouse.move(100 + (i % 2) * 600, 200 + (i % 3) * 150, { steps: 4 });
  }
  expect(await dial(page, 'Energy')).toBeGreaterThan(calm + 20);
  await page.keyboard.type('sensinth');
  await toLab(page);
  await expect(sensorRow(page, 'Typing').locator('.sensor-value')).not.toHaveText('0.00 keys/s');
});

test('motion reports a clear error on a computer without sensors', async ({ page }) => {
  await page.goto('/');
  await page.locator('label[for="src-motion"]').first().click();
  await expect(page.locator('.source.is-error')).toContainText('No motion sensor answered', {
    timeout: 5000,
  });
  await expect(page.locator('#src-motion')).not.toBeChecked();
});

test.describe('with camera, microphone and location allowed', () => {
  test.use({
    permissions: ['camera', 'microphone', 'geolocation'],
    geolocation: { latitude: 45.4641, longitude: 9.1912 },
  });

  test('camera and microphone become live channels', async ({ page }) => {
    await page.goto('/');
    await page.locator('label[for="src-camera"]').first().click();
    await page.locator('label[for="src-mic"]').first().click();
    await expect(page.locator('#src-camera')).toBeChecked();
    await expect(page.locator('#src-mic')).toBeChecked();
    await expect(page.locator('.cam-preview')).toBeVisible();
    await toLab(page);
    for (const label of ['Camera brightness', 'Camera color', 'Camera movement', 'Sound']) {
      await expect(sensorRow(page, label).locator('.sensor-value')).not.toHaveText('–', {
        timeout: 5000,
      });
    }
    await toPlay(page);
    await expect(page.locator('.source.is-error')).toHaveCount(0);
  });

  test('every piece started at the same place is in the same key', async ({ page }) => {
    await page.goto('/');
    await page.locator('label[for="src-location"]').first().click();
    await toLab(page);
    await expect(sensorRow(page, 'Speed')).toBeVisible({ timeout: 8000 });
    const keys: string[] = [];
    for (let i = 0; i < 3; i++) {
      await page.locator('#play').click();
      await expect(page.locator('#now-key')).toHaveText(/^[A-G][#b]? /, { timeout: 8000 });
      keys.push(((await page.locator('#now-key').textContent()) ?? '').split(' ')[0] ?? '');
      await page.locator('#play').click();
    }
    expect(new Set(keys).size).toBe(1);
  });
});

test('a recorded session downloads and replays', async ({ page }) => {
  await page.goto('/');
  await page.locator('label[for="src-sim"]').first().click();
  await toLab(page);
  await expect(sensorRow(page, 'Shake (sim)')).toBeVisible();
  await toPlay(page);
  await page.locator('#record').click();
  await page.waitForTimeout(1500);
  const download = page.waitForEvent('download');
  await page.locator('#record').click();
  const file = join(
    await mkdtemp(join(tmpdir(), 'sensinth-')),
    (await download).suggestedFilename(),
  );
  await (await download).saveAs(file);
  await expect(page.locator('#recorder-status')).toContainText('Saved');

  await page.locator('#load-recording').setInputFiles(file);
  await expect(page.locator('#src-replay')).toBeChecked();
  await toLab(page);
  await expect(sensorRow(page, 'Shake (sim) (replay)')).toBeVisible();
  await expect(sensorRow(page, 'Shake (sim) (replay)').locator('.sensor-value')).not.toHaveText(
    '–',
  );

  await page.locator('#load-recording').setInputFiles({
    name: 'notes.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"hello": 1}'),
  });
  await expect(page.locator('#recorder-status')).toContainText('Not a Sensinth sensor recording');
});
