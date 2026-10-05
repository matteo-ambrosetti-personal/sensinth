import type { SensorDescriptor, SensorHub } from '@sensinth/core';
import { nowSeconds, SourceError, type WebSensorSource } from './source';

/** Standard-mapping indices of the analog triggers (L2, R2). */
const TRIGGERS = [6, 7];
const STICK_NAMES = ['Left stick x', 'Left stick y', 'Right stick x', 'Right stick y'];

/**
 * Game controllers: every stick axis and analog trigger is a channel, and
 * the buttons held at once are one more. Sticks are spread over the dials by
 * timescale, so each moves something different; buttons raise accents.
 */
export class GamepadSource implements WebSensorSource {
  readonly id = 'gamepad';
  readonly label = 'Game controllers';
  readonly description = 'Sticks, triggers and buttons; press a button to connect';
  private timer: ReturnType<typeof setInterval> | undefined;
  private announced = new Map<string, SensorDescriptor[]>();
  private hub: SensorHub | undefined;

  private readonly onConnect = () => this.sync();
  private readonly onDisconnect = () => this.sync();

  unsupportedReason(): string | undefined {
    return typeof navigator.getGamepads === 'function'
      ? undefined
      : 'This browser has no Gamepad API.';
  }

  async start(hub: SensorHub): Promise<void> {
    if (typeof navigator.getGamepads !== 'function') {
      throw new SourceError('This browser has no Gamepad API.');
    }
    this.hub = hub;
    window.addEventListener('gamepadconnected', this.onConnect);
    window.addEventListener('gamepaddisconnected', this.onDisconnect);
    this.sync();
    this.timer = setInterval(() => this.poll(), 33);
  }

  stop(hub: SensorHub): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    window.removeEventListener('gamepadconnected', this.onConnect);
    window.removeEventListener('gamepaddisconnected', this.onDisconnect);
    for (const list of this.announced.values()) for (const d of list) hub.remove(d.id);
    this.announced.clear();
    this.hub = undefined;
  }

  /** Announces the channels of newly connected pads and removes those of unplugged ones. */
  private sync(): void {
    const hub = this.hub;
    if (!hub) return;
    const pads = connected();
    const keys = new Set(pads.map(padKey));
    for (const [key, list] of this.announced) {
      if (keys.has(key)) continue;
      for (const d of list) hub.remove(d.id);
      this.announced.delete(key);
    }
    for (const pad of pads) {
      const key = padKey(pad);
      if (this.announced.has(key)) continue;
      const list = descriptors(pad);
      for (const d of list) hub.announce(d);
      this.announced.set(key, list);
    }
  }

  private poll(): void {
    const hub = this.hub;
    if (!hub) return;
    const t = nowSeconds();
    for (const pad of connected()) {
      const key = padKey(pad);
      if (!this.announced.has(key)) {
        this.sync();
        continue;
      }
      pad.axes.forEach((v, i) => hub.push({ id: `${key}.axis${i}`, t, v }));
      for (const i of TRIGGERS) {
        const b = pad.buttons[i];
        if (b) hub.push({ id: `${key}.trigger${i}`, t, v: b.value });
      }
      const held = pad.buttons.filter((b, i) => b.pressed && !TRIGGERS.includes(i)).length;
      hub.push({ id: `${key}.buttons`, t, v: held });
    }
  }
}

function connected(): Gamepad[] {
  return [...navigator.getGamepads()].filter((p): p is Gamepad => !!p && p.connected);
}

function padKey(pad: Gamepad): string {
  return `pad${pad.index}`;
}

function padName(pad: Gamepad): string {
  // Ids look like "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)".
  const name = pad.id.replace(/\s*\(.*\)\s*$/, '').trim();
  return name.length > 0 && name.length < 40 ? name : `Controller ${pad.index + 1}`;
}

function descriptors(pad: Gamepad): SensorDescriptor[] {
  const key = padKey(pad);
  const name = padName(pad);
  const standard = pad.mapping === 'standard';
  const list: SensorDescriptor[] = pad.axes.map((_, i) => ({
    id: `${key}.axis${i}`,
    kind: 'controller.axis',
    label: `${name}: ${standard ? (STICK_NAMES[i] ?? `axis ${i + 1}`) : `axis ${i + 1}`}`,
    range: [-1, 1],
    minSpan: 0.3,
    rateHz: 30,
    source: 'controller',
  }));
  if (standard) {
    for (const i of TRIGGERS) {
      list.push({
        id: `${key}.trigger${i}`,
        kind: 'controller.trigger',
        label: `${name}: ${i === 6 ? 'left' : 'right'} trigger`,
        range: [0, 1],
        rateHz: 30,
        source: 'controller',
      });
    }
  }
  list.push({
    id: `${key}.buttons`,
    kind: 'controller.buttons',
    label: `${name}: buttons`,
    range: [0, 4],
    rateHz: 30,
    source: 'controller',
  });
  return list;
}
