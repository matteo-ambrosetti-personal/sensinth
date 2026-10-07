import { expect, test, type Page } from '@playwright/test';

/**
 * The Android app's sensor plugin, faked: it lists a Galaxy-like set of
 * channels and streams batched readings the way SensorsPlugin.java does.
 */
async function fakePhone(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const channels = [
      {
        id: 'native.light',
        kind: 'light',
        label: 'Light',
        unit: 'lx',
        range: [0, 100000],
        adaptive: true,
        minSpan: 30,
        rateHz: 5,
      },
      {
        id: 'native.proximity',
        kind: 'proximity',
        label: 'Something near',
        range: [0, 1],
        adaptive: false,
        rateHz: 5,
      },
      { id: 'native.v0', kind: 'cover', label: 'Hall sensor', adaptive: true, rateHz: 5 },
      {
        id: 'native.batteryTemp',
        kind: 'battery.temperature',
        label: 'Battery temperature',
        unit: '°C',
        adaptive: true,
        minSpan: 2,
        rateHz: 1,
      },
      {
        id: 'native.thermal',
        kind: 'thermal',
        label: 'Heat (thermal headroom)',
        range: [0, 1],
        adaptive: false,
        rateHz: 1,
      },
      {
        id: 'native.wifi',
        kind: 'wifi.rssi',
        label: 'Wi-Fi signal',
        unit: 'dBm',
        range: [-100, -30],
        adaptive: false,
        rateHz: 1,
      },
    ];
    let listener: ((b: { r: [string, number][] }) => void) | undefined;
    let i = 0;
    (window as unknown as { sensinthNativeStub: unknown }).sensinthNativeStub = {
      describe: async () => ({ channels }),
      addListener: async (_event: string, fn: (b: { r: [string, number][] }) => void) => {
        listener = fn;
        return { remove: async () => (listener = undefined) };
      },
      start: async () => {
        setInterval(() => {
          i++;
          listener?.({
            r: [
              ['native.light', 300 + 10 * Math.sin(i / 5)],
              ['native.proximity', i % 40 < 5 ? 1 : 0],
              ['native.v0', i % 60 < 30 ? 1 : 0],
              ['native.batteryTemp', 31.5],
              ['native.thermal', 0.42],
              ['native.wifi', -58],
            ],
          });
        }, 50);
      },
      stop: async () => {},
    };
  });
}

function sensorRow(page: Page, label: string) {
  return page.locator('.sensor').filter({ has: page.getByText(label, { exact: true }) });
}

test('the Android app turns every listed phone sensor into a channel', async ({ page }) => {
  await fakePhone(page);
  await page.goto('/');
  // In the app the phone sensors are on from the first start.
  await expect(page.locator('#src-native')).toBeChecked();
  await expect(sensorRow(page, 'Something near')).toBeVisible();
  // Every phone sensor gets its own share of what the phone's source controls.
  for (const name of ['Something near', 'Hall sensor', 'Heat (thermal headroom)']) {
    await expect(sensorRow(page, name).locator('.sensor-areas .area-chip').first()).toBeVisible();
  }
  await expect(page.locator('#areas .area-group[data-group="native"]')).toBeVisible();
  await expect(sensorRow(page, 'Battery temperature').locator('.sensor-value')).toContainText(
    '31.5',
  );
  await expect(sensorRow(page, 'Wi-Fi signal').locator('.sensor-value')).toContainText('-58');
  // The browser's light sensor gives way to the phone's.
  await expect(page.locator('#src-light')).toHaveCount(0);
});
