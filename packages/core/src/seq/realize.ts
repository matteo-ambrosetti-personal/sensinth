import { lerp, mod } from '../math';
import {
  chordDegrees,
  chordPitchClasses,
  lowestAtOrAbove,
  nearestChordTone,
  type Chord,
} from '../theory/chords';
import { foldIntoRange } from '../theory/notes';
import { pentatonicDegrees, type Scale } from '../theory/scales';
import { voiceChord } from '../theory/voicing';
import type { TrackSpec, TrigNote } from './types';

/** The harmony a note is realized against. */
export interface HarmonyContext {
  /** The scale in effect (for chord-scale styles, the chord's own scale). */
  scale: Scale;
  chord: Chord;
  /** Pitch class of the next chord's root. */
  nextRoot: number;
  /** The next chord differs from this one. */
  chordMoves: boolean;
  /** The key's root pitch class (blue notes are ♭3 and ♭5 above it). */
  key: number;
  /** 16th steps until the next chord starts (≥ 1). */
  stepsUntilChordChange: number;
  /** Step within the bar, 0..15. */
  stepInBar: number;
}

/** Widest arpeggio window, in semitones. */
const ARP_SPAN = 14;
/** Melodic leaps wider than this switch octave. */
const MAX_LEAP = 9;

/**
 * Turns trig notes into MIDI notes for one track. Pitches are chosen from the
 * scale and chord that are playing, so the harmony rules hold whatever the
 * pattern says:
 * - every pitch comes from scale degrees, so it is in the key;
 * - leads land on chord tones on beats and long notes;
 * - bass plays chord tones, plus approach notes that are scale steps off the beat;
 * - arps, chords, pads and drones play chord or key tones only.
 */
export class Realizer {
  private lastMidi: number | undefined;
  /** The blue note just played, which the next lead note resolves. */
  private pendingBlue: number | undefined;
  private voicing: number[] = [];
  private voicedFor = '';
  private heldKey = '';

  /**
   * MIDI notes for a trig lasting `len` steps. `register` (0..1) places the
   * line inside the track's range. Returns no notes for drums.
   */
  notes(
    spec: TrackSpec,
    note: TrigNote | undefined,
    h: HarmonyContext,
    register: number,
    len: number,
  ): number[] {
    const [lo, hi] = spec.range;
    const n = note ?? { tone: 0, chord: true, oct: 0 };
    switch (spec.role) {
      case 'drum':
      case 'fx':
        return [];
      case 'bass':
        return [this.bass(n, h, lo, hi, register)];
      case 'lead':
        return [this.lead(spec, n, h, lo, hi, register, len >= 4)];
      case 'arp':
        return [this.arp(n, h, lo, hi, register)];
      case 'chords':
      case 'pad':
        return this.chord(h, lo, hi);
      case 'drone':
        return this.drone(spec, h, lo, hi);
    }
  }

  /** True when a held drone no longer matches the key, so it must restart. */
  droneStale(scale: Scale): boolean {
    return this.heldKey !== '' && this.heldKey !== keyOf(scale);
  }

  private bass(n: TrigNote, h: HarmonyContext, lo: number, hi: number, register: number): number {
    const { scale, chord } = h;
    const floor = lo + Math.round(register * Math.max(0, hi - lo - 14));
    // Approach notes never land on the bar's downbeat, which always gets a chord tone.
    const approachOk =
      n.approach && h.chordMoves && h.stepInBar !== 0 && h.stepsUntilChordChange <= 4;
    if (approachOk) {
      // One step of the current scale below (or above) the next chord's root.
      const nextRoot = lowestAtOrAbove(h.nextRoot, floor);
      const below = scale.degreeToMidi(scale.degreeOf(nextRoot) - 1);
      const above = scale.degreeToMidi(scale.degreeOf(nextRoot) + 1);
      return foldIntoRange(below >= lo ? below : above, lo, hi);
    }
    const tones = chordDegrees(chord);
    const idx = Math.max(0, Math.round(n.tone));
    const degree = (tones[idx % tones.length] as number) + 7 * Math.floor(idx / tones.length);
    const root = lowestAtOrAbove(mod(scale.degreeToMidi(tones[0] as number), 12), floor);
    const pc = mod(scale.degreeToMidi(degree), 12);
    const midi = lowestAtOrAbove(pc, root) + 12 * n.oct;
    return foldIntoRange(midi, lo, hi);
  }

  private lead(
    spec: TrackSpec,
    n: TrigNote,
    h: HarmonyContext,
    lo: number,
    hi: number,
    register: number,
    long: boolean,
  ): number {
    const { scale, chord } = h;
    const loDeg = scale.degreeOf(lo) + 3;
    const hiDeg = scale.degreeOf(hi) - 5;
    const anchor = Math.round(lerp(loDeg, Math.max(loDeg, hiDeg), register));
    let degree = anchor + Math.round(n.tone) + 7 * n.oct;
    if (spec.pentatonic) degree = snapToDegrees(degree, pentatonicDegrees(scale.mode));
    let midi = foldIntoRange(scale.degreeToMidi(degree), lo, hi);
    const strong = n.chord || long || h.stepInBar % 4 === 0;
    if (strong) {
      midi = nearestChordTone(scale, chord, midi, lo, hi, n.tone % 2 === 0 ? 'down' : 'up');
    }
    // Avoid awkward leaps by switching octave (keeps the pitch class).
    if (this.lastMidi !== undefined && Math.abs(midi - this.lastMidi) > MAX_LEAP) {
      const alt = midi + (midi > this.lastMidi ? -12 : 12);
      if (alt >= lo && alt <= hi) midi = alt;
    }
    const blue = this.pendingBlue;
    this.pendingBlue = undefined;
    if (blue !== undefined) {
      // Resolve the blue note by a semitone into the scale (a chord tone on strong beats).
      midi = strong
        ? nearestChordTone(scale, chord, blue, lo, hi)
        : (resolveBySemitone(scale, blue, lo, hi) ?? midi);
    } else if (spec.blueNotes && n.blue && !strong && h.stepInBar % 2 === 1) {
      const bent = nearestBlueNote(midi, h.key, lo, hi);
      if (bent !== undefined) {
        midi = bent;
        this.pendingBlue = bent;
      }
    }
    this.lastMidi = midi;
    return midi;
  }

  private arp(n: TrigNote, h: HarmonyContext, lo: number, hi: number, register: number): number {
    const span = Math.min(ARP_SPAN, hi - lo);
    const start = Math.round(lo + register * (hi - lo - span));
    const pcs = chordPitchClasses(h.scale, h.chord);
    const window: number[] = [];
    for (let m = start; m <= start + span; m++) if (pcs.includes(mod(m, 12))) window.push(m);
    if (window.length === 0) return nearestChordTone(h.scale, h.chord, start, lo, hi);
    const idx = Math.max(0, Math.round(n.tone));
    const midi =
      (window[idx % window.length] as number) + 12 * (n.oct + Math.floor(idx / window.length));
    return foldIntoRange(midi, lo, hi);
  }

  private chord(h: HarmonyContext, lo: number, hi: number): number[] {
    const key = `${keyOf(h.scale)}:${h.chord.degree}:${h.chord.size}:${lo}-${hi}`;
    if (key !== this.voicedFor || this.voicing.length === 0) {
      this.voicing = voiceChord(chordPitchClasses(h.scale, h.chord), lo, hi, this.voicing);
      this.voicedFor = key;
    }
    return [...this.voicing];
  }

  private drone(spec: TrackSpec, h: HarmonyContext, lo: number, hi: number): number[] {
    this.heldKey = keyOf(h.scale);
    const root = lowestAtOrAbove(h.scale.root, lo);
    const notes = [root];
    if (spec.fifth) notes.push(foldIntoRange(root + 7, lo, hi));
    return notes;
  }
}

/** The ♭3 or ♭5 of the key nearest to `midi`, within two semitones and the range. */
export function nearestBlueNote(
  midi: number,
  key: number,
  lo: number,
  hi: number,
): number | undefined {
  let best: number | undefined;
  for (let m = midi - 2; m <= midi + 2; m++) {
    const rel = mod(m - key, 12);
    if ((rel === 3 || rel === 6) && m >= lo && m <= hi) {
      if (best === undefined || Math.abs(m - midi) < Math.abs(best - midi)) best = m;
    }
  }
  return best;
}

/** A scale note a semitone from `midi` (up first), inside the range. */
function resolveBySemitone(scale: Scale, midi: number, lo: number, hi: number): number | undefined {
  for (const m of [midi + 1, midi - 1]) if (m >= lo && m <= hi && scale.contains(m)) return m;
  return undefined;
}

function keyOf(scale: Scale): string {
  return `${scale.root}${scale.mode}`;
}

/** Moves an absolute degree to the nearest one whose scale position is allowed (ties go down). */
export function snapToDegrees(degree: number, allowed: readonly number[]): number {
  for (let d = 0; d < 7; d++) {
    if (allowed.includes(mod(degree - d, 7))) return degree - d;
    if (allowed.includes(mod(degree + d, 7))) return degree + d;
  }
  return degree;
}
