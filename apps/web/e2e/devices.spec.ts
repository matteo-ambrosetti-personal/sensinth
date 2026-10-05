import { expect, test, type Page } from '@playwright/test';

/**
 * Fake hardware for the browser-only sources: a MacBook lid sensor over
 * WebHID, a game controller, a MIDI knob box, CPU pressure, and Force Touch.
 */
async function fakeHardware(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });

    // Lid: feature report 1 = [id, angle low byte, angle high byte], opening 90° → 120°.
    let angle = 90;
    setInterval(() => (angle = angle >= 120 ? 90 : angle + 1), 50);
    const lid = {
      opened: false,
      productName: 'Lid Angle Sensor',
      async open() {
        this.opened = true;
      },
      async close() {
        this.opened = false;
      },
      async receiveFeatureReport() {
        return new DataView(new Uint8Array([1, angle & 0xff, angle >> 8]).buffer);
      },
    };
    Object.defineProperty(navigator, 'hid', {
      value: { getDevices: async () => [lid], requestDevice: async () => [lid] },
    });

    // A standard-mapping controller with the left stick pushed and one button held.
    const buttons = Array.from({ length: 17 }, (_, i) => ({
      pressed: i === 0,
      touched: i === 0,
      value: i === 0 ? 1 : i === 7 ? 0.6 : 0,
    }));
    const pad = {
      id: 'Test Pad (STANDARD GAMEPAD Vendor: 0001 Product: 0002)',
      index: 0,
      connected: true,
      mapping: 'standard',
      timestamp: 0,
      axes: [0.5, -0.25, 0, 0],
      buttons,
    };
    navigator.getGamepads = () => [pad as unknown as Gamepad, null, null, null];

    // A MIDI box whose knobs the test turns with window.turnKnob(cc, value).
    const input = {
      id: 'box-1',
      name: 'Knob Box',
      onmidimessage: null as null | ((e: { data: Uint8Array }) => void),
    };
    const access = {
      inputs: new Map([[input.id, input]]),
      outputs: new Map(),
      onstatechange: null,
    };
    navigator.requestMIDIAccess = async () => access as unknown as MIDIAccess;
    w.turnKnob = (cc: number, value: number) =>
      input.onmidimessage?.({ data: new Uint8Array([0xb0, cc, value]) });

    // Compute Pressure: the CPU is under serious load.
    w.PressureObserver = class {
      constructor(private readonly cb: (r: { source: string; state: string }[]) => void) {}
      async observe() {
        setTimeout(() => this.cb([{ source: 'cpu', state: 'serious' }]), 50);
      }
      disconnect() {}
    };
  });
}

function sensorRow(page: Page, label: string) {
  return page.locator('.sensor').filter({ has: page.getByText(label, { exact: true }) });
}

async function turnOn(page: Page, id: string): Promise<void> {
  await page.locator(`label[for="src-${id}"]`).first().click();
  await expect(page.locator(`#src-${id}`)).toBeChecked();
}

test.beforeEach(async ({ page }) => {
  await fakeHardware(page);
  await page.goto('/');
});

test('the MacBook lid angle arrives over WebHID', async ({ page }) => {
  await turnOn(page, 'lid');
  const row = sensorRow(page, 'Lid angle');
  await expect(row).toBeVisible();
  await expect(row.locator('.sensor-value')).toContainText('°');
  await expect(row.locator('.sensor-routes')).toContainText('→ space');
  const first = await row.locator('.sensor-value').textContent();
  await expect.poll(() => row.locator('.sensor-value').textContent()).not.toBe(first);
});

test('a game controller becomes sticks, a trigger and buttons', async ({ page }) => {
  await turnOn(page, 'gamepad');
  await expect(sensorRow(page, 'Test Pad: Left stick x')).toBeVisible();
  await expect(sensorRow(page, 'Test Pad: Left stick x').locator('.sensor-value')).toHaveText(
    /0\.5/,
  );
  await expect(sensorRow(page, 'Test Pad: right trigger')).toBeVisible();
  const buttons = sensorRow(page, 'Test Pad: buttons');
  await expect(buttons).toBeVisible();
  await expect(buttons.locator('.sensor-routes')).toContainText('onset → accent');
});

test('turning a MIDI knob adds a channel for it', async ({ page }) => {
  await turnOn(page, 'midi');
  await expect(sensorRow(page, 'Knob Box: CC 74')).toHaveCount(0);
  await page.evaluate(() =>
    (window as unknown as { turnKnob: (c: number, v: number) => void }).turnKnob(74, 100),
  );
  const knob = sensorRow(page, 'Knob Box: CC 74');
  await expect(knob).toBeVisible();
  await expect(knob.locator('.sensor-value')).toHaveText(/100/);
});

test('CPU pressure reads as load', async ({ page }) => {
  await turnOn(page, 'cpu');
  const row = sensorRow(page, 'CPU pressure');
  await expect(row).toBeVisible();
  await expect(row.locator('.sensor-value')).toHaveText(/0\.75/);
  await expect(row.locator('.sensor-routes')).toContainText('→ variation');
});

test('a Force Touch press reads as press force', async ({ page }) => {
  await expect(page.locator('#src-pointer')).toBeChecked();
  const row = sensorRow(page, 'Press force');
  await expect(row).toBeVisible();
  await page.evaluate(() => {
    const e = new MouseEvent('webkitmouseforcechanged');
    Object.defineProperty(e, 'webkitForce', { value: 2.4 });
    window.dispatchEvent(e);
  });
  await expect(row.locator('.sensor-value')).toHaveText(/0\.8/);
});
