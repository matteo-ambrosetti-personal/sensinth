import { mod } from '../math';
import { neutralParams, type TrackParams } from '../mod/params';
import { hashInts, hashString } from '../random';
import type { TrackRole } from '../seq/types';
import type { SensorEvent } from '../sensors/types';
import type { Machine, Palette } from '../styles/schema';
import { lowestAtOrAbove, type Chord } from '../theory/chords';
import type { Scale } from '../theory/scales';

/** Slots of the two voices that play events: presses on `ev`, onsets on `hit`. */
export const EVENT_SLOTS = { ev: 'ev', hit: 'hit' } as const;

export interface EventVoice {
  slot: string;
  machineId: string;
  machine: Machine;
}

/** Roles a press may play on, in order of preference. */
const MELODIC: readonly TrackRole[] = ['lead', 'arp', 'chords', 'bass', 'pad'];

/**
 * The machines that play events, picked by the seed from the style's palette:
 * a melodic one for presses (a lead or arp when there is one) and a drum for
 * onsets. Without a drum, onsets play on the melodic voice.
 */
export function eventVoices(palette: Palette, seed: number): { ev?: EventVoice; hit?: EventVoice } {
  const ids = Object.keys(palette.machines).sort();
  const machine = (id: string) => palette.machines[id] as Machine;
  const out: { ev?: EventVoice; hit?: EventVoice } = {};
  for (const role of MELODIC) {
    const pool = ids.filter((id) => machine(id).role === role);
    if (pool.length === 0) continue;
    const id = pool[hashInts(seed, hashString(role), 0xe1) % pool.length] as string;
    out.ev = { slot: EVENT_SLOTS.ev, machineId: id, machine: machine(id) };
    break;
  }
  const drums = ids.filter((id) => machine(id).role === 'drum');
  if (drums.length > 0) {
    // Snappy voices first: a kick on every shake would drown the groove.
    const snappy = drums.filter((id) => {
      const p = machine(id).patch;
      return p.type === 'drum' && p.voice !== 'kick' && p.voice !== 'crash';
    });
    const pool = snappy.length > 0 ? snappy : drums;
    const id = pool[hashInts(seed, 0x417) % pool.length] as string;
    out.hit = { slot: EVENT_SLOTS.hit, machineId: id, machine: machine(id) };
  }
  return out;
}

/** Params of the event voices: neutral, with a little echo so single notes ring. */
export function eventParams(slot: string): TrackParams {
  const p = neutralParams();
  p.level = 0.6;
  p.sendReverb = 0.3;
  p.sendDelay = slot === EVENT_SLOTS.ev ? 0.3 : 0.15;
  p.decay = 0.45;
  return p;
}

/**
 * A key's place on the keyboard as a number: a–z are 0–25, 0–9 are 26–35,
 * any other key 36–63. The same key always gives the same number, and so
 * the same note within a harmony.
 */
export function keyIndex(key: string): number {
  const k = key.length === 1 ? key.toLowerCase() : key;
  if (k.length === 1 && k >= 'a' && k <= 'z') return k.charCodeAt(0) - 97;
  if (k.length === 1 && k >= '0' && k <= '9') return 26 + k.charCodeAt(0) - 48;
  return 36 + (hashString(k) % 28);
}

/**
 * The note an event plays in the given scale and chord, inside `range`:
 * - a key or button picks a scale degree (index mod 7) and an octave
 *   ((index div 7) mod 2) above the scale's root at the bottom of the range;
 * - a MIDI key keeps its pitch, moved to the nearest note in the scale;
 * - an onset plays the chord's root.
 */
export function eventPitch(
  event: SensorEvent,
  scale: Scale,
  chord: Chord,
  range: [number, number],
): number {
  const [lo, hi] = range;
  if (event.kind === 'note') {
    let m = scale.quantize(Math.round(event.value));
    while (m < 24) m += 12;
    while (m > 108) m -= 12;
    return m;
  }
  const base = scale.degreeOf(lowestAtOrAbove(scale.root, lo));
  let degree: number;
  if (event.kind === 'onset') {
    degree = chord.degree;
  } else {
    const index = Math.max(0, Math.round(event.value));
    degree = mod(index, 7) + 7 * (Math.floor(index / 7) % 2);
  }
  let midi = scale.degreeToMidi(base + degree);
  while (midi > hi && midi - 12 >= lo) midi -= 12;
  return midi;
}
