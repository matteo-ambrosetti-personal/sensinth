import { keyCodeIndex, type SensorDescriptor, type SensorHub } from '@sensinth/core';
import { nowSeconds, type WebSensorSource } from './source';

const KEYS: SensorDescriptor = {
  id: 'computer.keys',
  kind: 'keys.rate',
  label: 'Typing',
  unit: 'keys/s',
  range: [0, 15],
  adaptive: true,
  minSpan: 3,
  rateHz: 30,
  source: 'computer',
};

/** Keys that only modify others, or move focus: not presses of their own. */
const IGNORED_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Fn']);

/** Keys the browser would also use (scrolling, quick find, back) while they play the music. */
const CAPTURED_CODES = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Backspace',
  'Quote',
  'Slash',
]);

/**
 * True when the key goes into a text field (the seed, a file name), not into
 * the music. A menu that just changed keeps the focus, but the keys still
 * play the music: only text fields take them.
 */
function typingIntoField(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  if (el.isContentEditable) return true;
  const field = el.closest('input, textarea');
  if (!field) return false;
  const type = (field as HTMLInputElement).type;
  return (
    !(field instanceof HTMLInputElement) || !['checkbox', 'radio', 'range', 'button'].includes(type)
  );
}

/**
 * The keyboard: how fast you type, and every key you press as an event with
 * its physical key (`KeyboardEvent.code`, the same on every layout). In
 * deterministic mode each key has its own effect on the song. Shortcuts
 * (with Cmd, Ctrl or Alt) and typing into fields are left alone.
 */
export class KeyboardSource implements WebSensorSource {
  readonly id = 'keyboard';
  readonly label = 'Keyboard';
  readonly description = 'Typing; in deterministic mode every key changes the song its own way';
  /** While true, keys that also scroll or search the page only play the music. */
  capture: () => boolean = () => false;
  private keyTimes: number[] = [];
  private hub: SensorHub | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

  private readonly onKey = (e: KeyboardEvent) => {
    if (IGNORED_KEYS.has(e.key) || e.metaKey || e.ctrlKey || e.altKey || typingIntoField(e)) return;
    if (this.capture() && CAPTURED_CODES.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    const t = nowSeconds();
    this.keyTimes.push(t);
    this.hub?.emit({ id: KEYS.id, t, kind: 'key', value: keyCodeIndex(e.code), velocity: 0.8 });
  };

  unsupportedReason(): string | undefined {
    return undefined;
  }

  async start(hub: SensorHub): Promise<void> {
    this.hub = hub;
    hub.announce(KEYS);
    window.addEventListener('keydown', this.onKey);
    this.timer = setInterval(() => {
      const t = nowSeconds();
      this.keyTimes = this.keyTimes.filter((k) => t - k < 1);
      hub.push({ id: KEYS.id, t, v: this.keyTimes.length });
    }, 33);
  }

  stop(hub: SensorHub): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    window.removeEventListener('keydown', this.onKey);
    hub.remove(KEYS.id);
    this.hub = undefined;
    this.keyTimes = [];
  }
}
