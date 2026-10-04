import type { Style } from './schema';

/**
 * NES-flavored: two pulse channels (lead + arpeggio), a triangle bass and a
 * noise drum kit. The simplest synthesis, and every kind of part is in use.
 */
export const chiptune: Style = {
  id: 'chiptune',
  name: 'Chiptune',
  description: 'Pulse-wave lead, fast arpeggios, triangle bass and noise drums.',
  defaultTempo: 140,
  swing: 0.5,
  modes: ['aeolian', 'dorian', 'mixolydian', 'ionian'],
  progression: {
    0: { 3: 3, 4: 3, 5: 3, 1: 1, 2: 0.5 },
    1: { 4: 4, 3: 1, 6: 0.5 },
    2: { 5: 3, 3: 2 },
    3: { 4: 4, 0: 2, 1: 1, 5: 1 },
    4: { 0: 5, 5: 3, 3: 1 },
    5: { 3: 4, 1: 2, 4: 2, 2: 1 },
    6: { 0: 4, 2: 1 },
  },
  chordRateBars: 1,
  chordSize: [3, 4],
  phraseBars: 4,
  sectionBars: 16,
  parts: [
    {
      id: 'drums',
      role: 'drums',
      instrument: 'kit',
      voices: {
        kick: ['x...............', 'x.......x.......', 'x.......x.x.....', 'x...x...x...x...'],
        snare: ['................', '........x.......', '....x.......x...', '....x.......x..o'],
        hat: ['x.......x.......', 'x...x...x...x...', 'x.x.x.x.x.x.x.x.', 'X.xxX.xxX.xxX.xx'],
      },
      fills: [
        { snare: 'xxxx' },
        { snare: 'x.xx', kick: 'x...' },
        { snare: '.xxx', hat: '....' },
        { kick: 'x.x.', snare: '.x.x' },
      ],
      accentVoice: 'ohat',
      ghostVoice: 'hat',
    },
    {
      id: 'bass',
      role: 'bass',
      instrument: 'tri',
      range: [33, 52],
      patterns: ['R---------------', 'R-------5-------', 'R-.R5-.5R-.R5-a.', 'R.8.R.8.5.8.R.8a'],
    },
    {
      id: 'arp',
      role: 'arp',
      instrument: 'pulse2',
      range: [60, 84],
      span: 14,
      rates: [4, 2, 1],
    },
    {
      id: 'lead',
      role: 'melody',
      instrument: 'pulse1',
      range: [64, 88],
      density: [0.12, 0.45],
      syncopation: 0.5,
      maxDur: 6,
    },
  ],
  instruments: {
    pulse1: {
      type: 'pulse',
      gain: 0.2,
      pan: 0.1,
      duty: [0.125, 0.25, 0.5],
      env: { a: 0.003, d: 0.12, s: 0.6, r: 0.06 },
      gate: 0.85,
      vibrato: { rate: 5.5, depth: 18, delay: 0.18 },
    },
    pulse2: {
      type: 'pulse',
      gain: 0.1,
      pan: -0.25,
      duty: [0.5, 0.25, 0.125],
      env: { a: 0.002, d: 0.06, s: 0.4, r: 0.03 },
      gate: 0.7,
    },
    tri: {
      type: 'osc',
      wave: 'triangle',
      gain: 0.34,
      env: { a: 0.002, d: 0.08, s: 0.9, r: 0.03 },
      gate: 0.9,
    },
    kit: { type: 'chipDrums', gain: 0.32 },
  },
  macroRanges: { energy: [0.3, 1], variation: [0.15, 0.85] },
  fx: {
    reverb: [0.02, 0.18],
    delay: [0, 0.18],
    delaySteps: 3,
    filter: [2200, 16000],
  },
};
