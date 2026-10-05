import { expect, test, type Page } from '@playwright/test';

/**
 * The Mac app's bridge, faked: webkit.messageHandlers.sensinth answers the
 * way apps/mac/Sources/Bridge.swift does, through window.sensinthNative.
 */
async function fakeMacApp(page: Page, motion: 'works' | 'cancelled'): Promise<void> {
  await page.addInitScript((motion) => {
    type Receive = (m: unknown) => void;
    const w = window as unknown as {
      webkit: unknown;
      sensinthNative?: { receive: Receive };
    };
    const channels = [
      {
        id: 'mac.lid',
        kind: 'lid.angle',
        label: 'Lid angle',
        unit: '°',
        range: [0, 180],
        adaptive: true,
        minSpan: 20,
        rateHz: 30,
      },
      {
        id: 'mac.light',
        kind: 'light',
        label: 'Light',
        unit: 'lx',
        range: [0, 10000],
        adaptive: true,
        minSpan: 30,
        rateHz: 2,
      },
      {
        id: 'mac.chipTemp',
        kind: 'temperature.device',
        label: 'Chip temperature',
        unit: '°C',
        adaptive: true,
        minSpan: 3,
        rateHz: 1,
      },
      {
        id: 'mac.cpu',
        kind: 'cpu.load',
        label: 'CPU load',
        range: [0, 1],
        adaptive: false,
        rateHz: 2,
      },
      {
        id: 'mac.idle',
        kind: 'idle',
        label: 'Idle time',
        unit: 's',
        range: [0, 120],
        adaptive: false,
        rateHz: 2,
      },
    ];
    const motionChannels = [
      {
        id: 'mac.shake',
        kind: 'motion.accel',
        label: 'Shake (Mac)',
        unit: 'm/s²',
        range: [0, 20],
        adaptive: true,
        minSpan: 0.4,
        rateHz: 50,
      },
      {
        id: 'mac.pitch',
        kind: 'orientation.pitch',
        label: 'Tilt forward–back (Mac)',
        unit: '°',
        range: [-90, 90],
        adaptive: true,
        minSpan: 10,
        rateHz: 50,
      },
    ];
    let sensors = false;
    let moving = false;
    const reply = (m: unknown) => setTimeout(() => w.sensinthNative?.receive(m), 10);
    w.webkit = {
      messageHandlers: {
        sensinth: {
          postMessage(m: { type: string; on?: boolean }) {
            if (m.type === 'describe') reply({ type: 'describe', channels, motion: true });
            if (m.type === 'start') sensors = true;
            if (m.type === 'stop') sensors = false;
            if (m.type === 'motion' && m.on) {
              if (motion === 'works') {
                moving = true;
                reply({ type: 'motion', status: 'on', channels: motionChannels });
              } else {
                reply({
                  type: 'motion',
                  status: 'error',
                  message: 'Cancelled: motion needs your password.',
                });
              }
            }
            if (m.type === 'motion' && !m.on) moving = false;
          },
        },
      },
    };
    let i = 0;
    setInterval(() => {
      i++;
      const r: [string, number][] = [];
      if (sensors)
        r.push(
          ['mac.lid', 100 + (i % 20)],
          ['mac.light', 250],
          ['mac.chipTemp', 48],
          ['mac.cpu', 0.3],
          ['mac.idle', 1],
        );
      if (moving) r.push(['mac.shake', i % 30 < 3 ? 6 : 0.1], ['mac.pitch', 12]);
      if (r.length) w.sensinthNative?.receive({ type: 'readings', r });
    }, 50);
  }, motion);
}

function sensorRow(page: Page, label: string) {
  return page.locator('.sensor').filter({ has: page.getByText(label, { exact: true }) });
}

test('the Mac app starts with its own sensors on', async ({ page }) => {
  await fakeMacApp(page, 'works');
  await page.goto('/');
  await expect(page.locator('#src-mac')).toBeChecked();
  await expect(sensorRow(page, 'Lid angle')).toBeVisible();
  await expect(sensorRow(page, 'Lid angle').locator('.sensor-value')).toContainText('°');
  await expect(sensorRow(page, 'Chip temperature').locator('.sensor-routes')).toContainText(
    '→ texture',
  );
  await expect(sensorRow(page, 'Idle time').locator('.sensor-routes')).toContainText('→ energy');
  // The app reads the lid itself, so the WebHID source is not offered.
  await expect(page.locator('#src-lid')).toHaveCount(0);
});

test('Mac motion adds shake and tilt once the password is given', async ({ page }) => {
  await fakeMacApp(page, 'works');
  await page.goto('/');
  await page.locator('label[for="src-macMotion"]').first().click();
  await expect(page.locator('#src-macMotion')).toBeChecked();
  await expect(sensorRow(page, 'Shake (Mac)')).toBeVisible();
  await expect(sensorRow(page, 'Tilt forward–back (Mac)').locator('.sensor-value')).toContainText(
    '12',
  );
});

test('cancelling the password prompt explains itself', async ({ page }) => {
  await fakeMacApp(page, 'cancelled');
  await page.goto('/');
  await page.locator('label[for="src-macMotion"]').first().click();
  await expect(page.locator('.source.is-error .source-msg')).toContainText(
    'motion needs your password',
  );
  await expect(sensorRow(page, 'Shake (Mac)')).toHaveCount(0);
});
