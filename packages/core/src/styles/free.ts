import type { TrackRole } from '../seq/types';
import { DIATONIC_MODES } from '../theory/scales';
import type { FxConfig, Machine, MarkovTable, Palette, SlotOption, Style } from './schema';

/** How many tracks of each role Free mode may add, and how likely each is. */
const FREE_SLOTS: readonly { role: TrackRole; required?: boolean; weight: number }[] = [
  { role: 'drum', weight: 3 },
  { role: 'drum', weight: 2 },
  { role: 'drum', weight: 1.5 },
  { role: 'bass', weight: 3 },
  { role: 'chords', weight: 2 },
  { role: 'pad', weight: 1.5 },
  { role: 'drone', weight: 0.8 },
  { role: 'arp', weight: 1.5 },
  { role: 'lead', required: true, weight: 1 },
  { role: 'lead', weight: 1 },
];

/** A progression that works in any mode: mostly the strong moves every style shares. */
const FREE_PROGRESSION: MarkovTable = {
  0: { 3: 3, 4: 3, 5: 3, 1: 1, 2: 1 },
  1: { 4: 4, 3: 1, 6: 0.5 },
  2: { 5: 3, 3: 2 },
  3: { 4: 3, 0: 3, 1: 1, 5: 1 },
  4: { 0: 5, 5: 2, 3: 1 },
  5: { 3: 3, 1: 2, 4: 2, 2: 1 },
  6: { 0: 4, 2: 1 },
};

/**
 * Builds the Free palette from other styles: every machine of every style
 * (ids prefixed with the style, e.g. `techno.acid`), any diatonic mode, any
 * length and speed. Styles whose harmony needs chord scales still lend their
 * instruments; Free itself stays diatonic, so every note is in key.
 */
export function buildFreePalette(styles: readonly Style[]): Palette {
  const machines: Record<string, Machine> = {};
  const byRole = new Map<TrackRole, string[]>();
  const lengths = new Set<number>();
  const scales = new Set<number>();
  for (const style of styles) {
    for (const [id, machine] of Object.entries(style.palette.machines)) {
      const key = `${style.id}.${id}`;
      // A drone keeps its own lengths; other machines take any length.
      machines[key] = { ...machine, label: `${machine.label} (${style.name})` };
      byRole.set(machine.role, [...(byRole.get(machine.role) ?? []), key]);
    }
    style.palette.lengths.forEach((l) => lengths.add(l));
    style.palette.scales.forEach((s) => scales.add(s));
  }
  const slots: SlotOption[] = FREE_SLOTS.filter((s) => byRole.has(s.role)).map((s) => ({
    role: s.role,
    machines: byRole.get(s.role) as string[],
    weight: s.weight,
    ...(s.required ? { required: true } : {}),
  }));
  return {
    modes: DIATONIC_MODES,
    progression: FREE_PROGRESSION,
    chordRates: [0.5, 1, 2, 4],
    chordSize: [3, 5],
    phraseBars: 4,
    sectionBars: 16,
    swing: [0.5, 0.66],
    trackCount: [3, 8],
    slots,
    machines,
    lengths: [...lengths].sort((a, b) => a - b),
    scales: [...scales].sort((a, b) => a - b),
    lfoPeriod: [4, 512],
    maxEventsPerStep: 12,
  };
}

/**
 * Free: no style. The sensors choose the instruments too, from every style,
 * along with the mode, the structure and the effects; notes stay in key and
 * on the grid.
 */
export function freeStyle(styles: readonly Style[]): Style {
  const fxPresets: FxConfig[] = styles.map((s) => s.fx);
  return {
    id: 'free',
    name: 'Free',
    description: 'No style: the sensors choose the instruments too, from every style.',
    defaultTempo: 120,
    palette: buildFreePalette(styles),
    fx: fxPresets[0] as FxConfig,
    fxPresets,
  };
}
