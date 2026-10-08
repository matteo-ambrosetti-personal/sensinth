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
      vendorId: 0x05ac,
      productId: 0x8104,
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

/** The live sensors are on the Lab page; the sources and the area map on Play. */
async function toLab(page: Page): Promise<void> {
  await page.locator('#mode-lab').click();
}

async function toPlay(page: Page): Promise<void> {
  await page.locator('#mode-play').click();
}

async function turnOn(page: Page, id: string): Promise<void> {
  await page.locator(`label[for="src-${id}"]`).first().click();
  await expect(page.locator(`#src-${id}`)).toBeChecked();
}

/** Turns every other source off, so this one drives the whole music on its own. */
async function only(page: Page, id: string): Promise<void> {
  const on = page.locator('#sources input[type="checkbox"]:checked');
  while ((await on.count()) > 0) {
    const other = await on.first().getAttribute('id');
    await page.locator(`label[for="${other}"]`).first().click();
    await expect(page.locator(`#${other}`)).not.toBeChecked();
  }
  await turnOn(page, id);
}

test.beforeEach(async ({ page }) => {
  await fakeHardware(page);
  await page.goto('/');
});

test('the MacBook lid angle arrives over WebHID', async ({ page }) => {
  // On its own the lid drives everything, the space dial its rules give it included.
  await only(page, 'lid');
  await toLab(page);
  const row = sensorRow(page, 'Lid angle');
  await expect(row).toBeVisible();
  await expect(row.locator('.sensor-value')).toContainText('°');
  await expect(row.locator('.sensor-routes')).toContainText('→ space');
  const first = await row.locator('.sensor-value').textContent();
  await expect.poll(() => row.locator('.sensor-value').textContent()).not.toBe(first);
});

test('a lid sensor that does not answer says so instead of staying silent', async ({ page }) => {
  await page.evaluate(async () => {
    const hid = (navigator as unknown as { hid: { getDevices(): Promise<object[]> } }).hid;
    const [lid] = await hid.getDevices();
    Object.assign(lid as object, {
      receiveFeatureReport: async () => {
        throw new DOMException('Failed to receive the feature report.', 'NotAllowedError');
      },
    });
  });
  await page.locator('label[for="src-lid"]').first().click();
  await expect(page.locator('#sources .source-msg', { hasText: 'did not answer' })).toBeVisible();
  await expect(page.locator('#src-lid')).not.toBeChecked();
  await expect(sensorRow(page, 'Lid angle')).toHaveCount(0);
});

test('a game controller becomes sticks, a trigger and buttons', async ({ page }) => {
  await turnOn(page, 'gamepad');
  await toLab(page);
  await expect(sensorRow(page, 'Test Pad: Left stick x')).toBeVisible();
  await expect(sensorRow(page, 'Test Pad: Left stick x').locator('.sensor-value')).toHaveText(
    /0\.5/,
  );
  await expect(sensorRow(page, 'Test Pad: right trigger')).toBeVisible();
  const buttons = sensorRow(page, 'Test Pad: buttons');
  await expect(buttons).toBeVisible();
  // The controller's sensors share out what the controller controls: each has its own areas.
  for (const name of ['Test Pad: Left stick x', 'Test Pad: right trigger', 'Test Pad: buttons']) {
    await expect(sensorRow(page, name).locator('.sensor-areas .area-chip').first()).toBeVisible();
  }
  await toPlay(page);
  await expect(page.locator('#areas .area-group[data-group="gamepad"]')).toBeVisible();
});

test('turning a MIDI knob adds a channel for it', async ({ page }) => {
  await turnOn(page, 'midi');
  await expect(sensorRow(page, 'Knob Box: CC 74')).toHaveCount(0);
  await page.evaluate(() =>
    (window as unknown as { turnKnob: (c: number, v: number) => void }).turnKnob(74, 100),
  );
  await toLab(page);
  const knob = sensorRow(page, 'Knob Box: CC 74');
  await expect(knob).toBeVisible();
  await expect(knob.locator('.sensor-value')).toHaveText(/100/);
});

test('CPU pressure reads as load', async ({ page }) => {
  await only(page, 'cpu');
  await toLab(page);
  const row = sensorRow(page, 'CPU pressure');
  await expect(row).toBeVisible();
  await expect(row.locator('.sensor-value')).toHaveText(/0\.75/);
  await expect(row.locator('.sensor-routes')).toContainText('→ variation');
});

test('a Force Touch press reads as press force', async ({ page }) => {
  await expect(page.locator('#src-pointer')).toBeChecked();
  await toLab(page);
  const row = sensorRow(page, 'Press force');
  await expect(row).toBeVisible();
  await page.evaluate(() => {
    const e = new MouseEvent('webkitmouseforcechanged');
    Object.defineProperty(e, 'webkitForce', { value: 2.4 });
    window.dispatchEvent(e);
  });
  await expect(row.locator('.sensor-value')).toHaveText(/0\.8/);
});
