import type { Style } from './schema';

/**
 * Slow and spacious: a drone under long pads, a sparse pentatonic bell
 * melody and deep reverb. Slow sensors shape it most; a soft rim pulse
 * appears only when there is a lot of movement.
 */
export const ambient: Style = {
  id: 'ambient',
  name: 'Ambient',
  description: 'A drone under slow pads, sparse bells and deep reverb.',
  defaultTempo: 72,
  swing: 0.5,
  modes: ['aeolian', 'dorian', 'ionian', 'lydian'],
  progression: {
    0: { 3: 3, 5: 3, 1: 1, 2: 1, 4: 1 },
    1: { 4: 2, 3: 2, 0: 1 },
    2: { 5: 3, 3: 2 },
    3: { 0: 4, 5: 2, 1: 1 },
    4: { 0: 3, 5: 2, 3: 2 },
    5: { 3: 3, 0: 2, 1: 1, 2: 1 },
    6: { 0: 3, 5: 1 },
  },
  chordRateBars: 2,
  chordSize: [3, 5],
  phraseBars: 4,
  sectionBars: 16,
  parts: [
    { id: 'drone', role: 'drone', instrument: 'drone', range: [36, 50], fifth: true, bars: 8 },
    {
      id: 'pad',
      role: 'chords',
      instrument: 'pad',
      range: [52, 74],
      patterns: [`x${'-'.repeat(31)}`],
    },
    {
      id: 'bells',
      role: 'melody',
      instrument: 'bell',
      range: [69, 93],
      density: [0.05, 0.22],
      syncopation: 0.1,
      maxDur: 12,
      pentatonic: true,
    },
    {
      id: 'pulse',
      role: 'drums',
      instrument: 'soft',
      voices: {
        rim: ['................', '................', 'x.......x.......', 'x...x...x...x...'],
      },
      fills: [],
      accentVoice: 'rim',
      ghostVoice: 'rim',
    },
  ],
  instruments: {
    drone: {
      type: 'pad',
      wave: 'sawtooth',
      gain: 0.2,
      voices: 3,
      detune: 14,
      cutoff: [260, 1200],
      env: { a: 3, d: 2, s: 0.85, r: 4 },
      gate: 1,
    },
    pad: {
      type: 'pad',
      wave: 'sawtooth',
      gain: 0.11,
      voices: 3,
      detune: 10,
      cutoff: [500, 3000],
      env: { a: 1.8, d: 1.5, s: 0.7, r: 2.5 },
      gate: 1,
    },
    bell: {
      type: 'fm',
      gain: 0.17,
      pan: 0.2,
      ratio: 3.5,
      index: [4, 0.3],
      indexDecay: 1.2,
      env: { a: 0.005, d: 2.5, s: 0, r: 1.5 },
    },
    soft: { type: 'lofiDrums', gain: 0.22, pan: -0.15 },
  },
  macroRanges: { energy: [0, 0.6], space: [0.35, 1] },
  fx: {
    reverb: [0.25, 0.55],
    reverbSeconds: 5.5,
    delay: [0.08, 0.3],
    delaySteps: 6,
    filter: [1200, 9000],
  },
};
