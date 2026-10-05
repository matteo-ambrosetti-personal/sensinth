import type { SensorDescriptor, SensorHub } from '@sensinth/core';
import { nowSeconds, SourceError, type WebSensorSource } from './source';

/** Seconds a played key keeps its velocity before falling back to 0. */
const NOTE_HOLD = 0.15;

/**
 * MIDI controllers: every knob or fader you touch (control change) and the
 * pitch bend become channels, announced the first time they move; the keys
 * are one channel of velocities that raises accents, and each key played is
 * an event with its note.
 */
export class MidiSource implements WebSensorSource {
  readonly id = 'midi';
  readonly label = 'MIDI controllers';
  readonly description = 'Knobs, faders, pitch bend and keys of any MIDI device';
  readonly permission = 'midi' as PermissionName;
  private access: MIDIAccess | undefined;
  private hub: SensorHub | undefined;
  private readonly announced = new Set<string>();
  private readonly last = new Map<string, number>();
  private readonly noteUntil = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | undefined;

  unsupportedReason(): string | undefined {
    return typeof navigator.requestMIDIAccess === 'function'
      ? undefined
      : 'This browser has no Web MIDI (try Chrome, Edge or Firefox).';
  }

  async start(hub: SensorHub): Promise<void> {
    try {
      this.access = await navigator.requestMIDIAccess();
    } catch {
      throw new SourceError('MIDI access is blocked. Allow it in the browser’s site settings.');
    }
    this.hub = hub;
    this.listen();
    this.access.onstatechange = () => this.listen();
    // Knobs send only when moved: repeat the latest values so they stay live,
    // and let played keys fall back to silence.
    this.timer = setInterval(() => {
      const t = nowSeconds();
      for (const [id, until] of this.noteUntil) {
        if (t >= until) {
          this.noteUntil.delete(id);
          this.last.set(id, 0);
        }
      }
      for (const [id, v] of this.last) hub.push({ id, t, v });
    }, 250);
  }

  stop(hub: SensorHub): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    if (this.access) {
      this.access.onstatechange = null;
      for (const input of this.access.inputs.values()) input.onmidimessage = null;
    }
    for (const id of this.announced) hub.remove(id);
    this.announced.clear();
    this.last.clear();
    this.noteUntil.clear();
    this.access = undefined;
    this.hub = undefined;
  }

  private listen(): void {
    for (const input of this.access?.inputs.values() ?? []) {
      input.onmidimessage = (e) => this.message(input, e.data);
    }
  }

  private message(input: MIDIInput, data: Uint8Array | null): void {
    const hub = this.hub;
    if (!hub || !data || data.length < 2) return;
    const status = (data[0] as number) & 0xf0;
    const device = (input.name ?? 'MIDI').trim() || 'MIDI';
    const key = input.id.replace(/[^\w-]/g, '');
    let desc: SensorDescriptor | undefined;
    let value = 0;
    if (status === 0xb0) {
      const cc = data[1] as number;
      value = data[2] ?? 0;
      desc = {
        id: `midi.${key}.cc${cc}`,
        kind: 'midi.cc',
        label: `${device}: CC ${cc}`,
        range: [0, 127],
        rateHz: 10,
        source: 'midi',
      };
    } else if (status === 0xe0) {
      value = (((data[2] ?? 64) << 7) | (data[1] as number)) / 16383;
      desc = {
        id: `midi.${key}.bend`,
        kind: 'midi.cc',
        label: `${device}: pitch bend`,
        range: [0, 1],
        rateHz: 10,
        source: 'midi',
      };
    } else if (status === 0x90 && (data[2] ?? 0) > 0) {
      value = data[2] as number;
      desc = {
        id: `midi.${key}.keys`,
        kind: 'midi.note',
        label: `${device}: keys`,
        range: [0, 127],
        rateHz: 20,
        source: 'midi',
      };
      this.noteUntil.set(desc.id, nowSeconds() + NOTE_HOLD);
    }
    if (!desc) return;
    if (!this.announced.has(desc.id)) {
      this.announced.add(desc.id);
      hub.announce(desc);
      if (desc.kind === 'midi.note') hub.push({ id: desc.id, t: nowSeconds() - 0.05, v: 0 });
    }
    this.last.set(desc.id, value);
    const t = nowSeconds();
    hub.push({ id: desc.id, t, v: value });
    // Every key is also a note of its own, played as such in deterministic mode.
    if (desc.kind === 'midi.note') {
      hub.emit({ id: desc.id, t, kind: 'note', value: data[1] as number, velocity: value / 127 });
    }
  }
}
