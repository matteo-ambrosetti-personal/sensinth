/**
 * Performance effects on the whole mix, fired by sensor events, by the
 * song's structure, or by trigs on the FX lane.
 */
export type FxId =
  | 'stutter'
  | 'tapeStop'
  | 'brake'
  | 'sweep'
  | 'dive'
  | 'wash'
  | 'dubThrow'
  | 'crush'
  | 'gate'
  | 'ring';

export interface FxInfo {
  label: string;
  /** Three-letter label for the step grid. */
  short: string;
  /** What it does, for the UI. */
  description: string;
  /** Typical length in steps. */
  steps: number;
  /** Replaces the dry mix while it plays (only one of these at a time). */
  exclusive: boolean;
  /** Steps after it ends before it may fire again; the drastic ones rest longer. */
  rest: number;
}

export const FX_INFO: Record<FxId, FxInfo> = {
  stutter: {
    label: 'Stutter',
    short: 'STU',
    description: 'Repeats the last sixteenth or eighth',
    steps: 4,
    exclusive: true,
    rest: 16,
  },
  tapeStop: {
    label: 'Tape stop',
    short: 'TAP',
    description: 'The mix slows down to a halt',
    steps: 8,
    exclusive: true,
    rest: 64,
  },
  brake: {
    label: 'Vinyl brake',
    short: 'BRK',
    description: 'A quick turntable stop',
    steps: 3,
    exclusive: true,
    rest: 48,
  },
  sweep: {
    label: 'Riser',
    short: 'SWP',
    description: 'A high-pass filter sweeps up',
    steps: 8,
    exclusive: false,
    rest: 16,
  },
  dive: {
    label: 'Filter dive',
    short: 'DIV',
    description: 'A low-pass filter closes down',
    steps: 6,
    exclusive: false,
    rest: 16,
  },
  wash: {
    label: 'Reverb wash',
    short: 'WSH',
    description: 'Everything blooms into reverb',
    steps: 8,
    exclusive: false,
    rest: 16,
  },
  dubThrow: {
    label: 'Dub throw',
    short: 'DUB',
    description: 'The delay feeds back and echoes away',
    steps: 6,
    exclusive: false,
    rest: 16,
  },
  crush: {
    label: 'Bit crush',
    short: 'CRU',
    description: 'Fewer bits, more grit',
    steps: 4,
    exclusive: true,
    rest: 24,
  },
  gate: {
    label: 'Gate chop',
    short: 'GAT',
    description: 'Chops the mix into sixteenths',
    steps: 8,
    exclusive: false,
    rest: 16,
  },
  ring: {
    label: 'Ring mod',
    short: 'RNG',
    description: 'Metallic sidebands',
    steps: 4,
    exclusive: true,
    rest: 24,
  },
};

export const FX_IDS = Object.keys(FX_INFO) as FxId[];

/**
 * The effect a fast sensor's events fire by default, by kind. Any other fast
 * sensor gets one picked by the genome.
 */
export const KIND_FX: Record<string, FxId> = {
  'motion.accel': 'stutter',
  'rotation.rate': 'sweep',
  'sound.level': 'wash',
  'keys.rate': 'dubThrow',
  'camera.motion': 'gate',
  proximity: 'dive',
  'pointer.force': 'crush',
  'lid.angle': 'tapeStop',
  cover: 'brake',
  'motion.event': 'sweep',
  'controller.buttons': 'stutter',
  'midi.note': 'dubThrow',
};
