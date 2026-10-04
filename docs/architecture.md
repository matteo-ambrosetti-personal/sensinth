# Architecture

Sensinth turns sensor signals into music. The user sets the tempo and the style; sensors drive
everything else. This document describes how a raw reading becomes a note, and the rules that keep
the result musical.

## Pipeline

```
 Sensors ──► Signal processing ──► Features ──► Dials (macros) ──► Composer ──► Note events ──► Renderer ──► Audio
 any unit     median, normalize,    level,       energy, tension,   key, mode,    on the 16th    Web Audio
 any rate     One-Euro smoothing    trend,       brightness, …      chords,       grid, in key
                                    activity,                        rhythm,
                                    onsets                           melody
```

Each stage only talks to the next one, through small types defined in `packages/core`:

| Type               | Meaning                                                                |
| ------------------ | ---------------------------------------------------------------------- |
| `SensorDescriptor` | One scalar channel: id, semantic `kind`, unit, optional range and rate |
| `SensorSample`     | `{ id, t, v }`: one reading, time in seconds                           |
| `Features`         | `{ level, trend, activity, onset }`, all normalized                    |
| `Macros`           | Eight musical dials, each 0..1                                         |
| `NoteEvent`        | `{ part, step, durSteps, midi?, vel, voice? }` on the 16th-note grid   |

Multi-axis sensors are split into scalar channels (tilt pitch and tilt roll are separate
channels), which keeps every later stage simple.

## Signal processing (`core/src/signal`)

Every channel gets a `FeatureExtractor`, tuned by the channel's **timescale** (`fast`, `medium`
or `slow`). The timescale comes from the descriptor, else from the shared kind vocabulary in
`sensors/kinds.ts`, else from the sample rate.

1. **Median filter** removes single-sample spikes.
2. **Adaptive normalizer** maps the raw value to 0..1. Bounds expand at once to new extremes and
   relax slowly back, so the output keeps using the full range. A minimum span (from the
   descriptor, or 10% of the widest span seen) stops sensor noise at rest from being amplified to
   full scale. Channels with a known physical range (tilt angles, humidity) use it directly.
   Circular channels (compass) are unwrapped, so 359° → 1° is a small step.
3. **One-Euro filter** smooths jitter strongly when the signal is still and follows quickly when it
   moves.
4. **Features:** `level` (smoothed value), `trend` (smoothed derivative, −1..1), `activity`
   (average deviation from a slow baseline) and `onset` (a sudden rise, with hysteresis and a
   refractory period).

## Mapping (`core/src/mapping`)

The `SensorHub` holds every channel from every source. The `Router` turns features into macros:

- **Rules** connect a sensor kind and feature to a macro, with a weight and optional inversion.
  `DEFAULT_MAPPING` covers the shared vocabulary (shake → energy, light → brightness, falling
  pressure → tension, humidity → space, …). A style can add or replace rules.
- **Auto-routing:** a channel whose kind has no rule is assigned by timescale to the least-used
  suitable macro. Fast channels drive energy or variation through their activity and raise accent
  triggers; slow ones drive space, tension or color. A new sensor therefore joins the music with
  no code change.
- Each macro is the weighted average of its live sources, scaled into the style's range for that
  macro (e.g. Chiptune never drops below 30% energy), then **slewed** with a per-macro time
  constant so the sound changes smoothly. A macro with no live source rests at its default.
- **Triggers** (`accent`, `fill`) come from onsets and are honored on the next grid slot.

| Macro      | Musical effect                                       |
| ---------- | ---------------------------------------------------- |
| energy     | Note density, drum pattern level, velocity, arp rate |
| tension    | Chord choice (tense vs. resolved), chord size        |
| brightness | Mode, from Phrygian (dark) to Lydian; master filter  |
| space      | Reverb and delay amount                              |
| variation  | How much repeats mutate; fills; ghost notes          |
| texture    | Timbre (pulse width), chord extensions               |
| register   | Melody and arpeggio height                           |
| color      | Key modulation around the circle of fifths           |

## The composer: how harmony is kept (`core/src/composer`)

The `Engine` is called once per 16th-note step. It updates the macros, moves harmony on structural
boundaries, then asks each part for the notes that start on this step. These rules hold by
construction, and the property-based tests check them against random and broken sensor input:

1. **Grid.** Every event lands on a 16th-note step; swing is applied by the renderer.
2. **Scale.** Parts address pitches by scale degree, so every pitch is in the current key and mode.
3. **Chord tones on strong beats.** Melody notes on beats, long notes and phrase endings snap to
   the nearest chord tone. Weak-beat notes may pass through other scale tones.
4. **Progressions.** Chords follow the style's Markov table over scale degrees. Tension biases the
   choice toward unstable chords (V, vii) or toward home (I), diminished chords are rare spice, and
   phrases tend to start on the tonic when tension is low. Chords change only on bar or half-bar
   lines.
5. **Slow things change slowly.** The mode follows brightness only at phrase starts, with
   hysteresis. The key modulates only at section starts, one step around the circle of fifths,
   and only when color has moved far.
6. **Repetition.** The melody remembers a two-bar motif and lays out each four-bar phrase as call,
   answer and cadence. Variation controls how much repeats mutate; a large change in energy
   writes a new motif.
7. **Voice leading.** Chord voicings move as little as possible; the bass plays roots on downbeats
   and may approach the next root by step.
8. **Bounded output.** Styles set pattern levels, ranges and macro ranges. The renderer ends in a
   compressor and a soft clipper, so output never exceeds 0 dBFS.

All random choices go through a seeded `Rng`, so the same seed and the same sensor data always
produce the same notes.

## Styles (`core/src/styles`)

A style is a data object (`Style` in `styles/schema.ts`): allowed modes, chord-progression table,
chord rate and size, phrase and section length, parts, instrument patches, effects, macro ranges
and optional mapping rules. Parts come in five roles:

| Role     | Behavior                                                                |
| -------- | ----------------------------------------------------------------------- |
| `drums`  | 16-step patterns per voice, sparse to busy; fills; accents from onsets  |
| `bass`   | Patterns of root / fifth / third / octave / approach tones              |
| `melody` | Motif-based phrases realized against the current chord                  |
| `arp`    | Chord tones up, down or up-down; rate from energy, window from register |
| `chords` | Voice-led comping or pads                                               |

## Audio (`packages/audio`)

- `LookaheadScheduler` wakes every 25 ms and schedules every step due in the next 120 ms on the
  audio clock. After a stall it skips ahead instead of bursting late notes.
- `Renderer` builds an instrument per part from its patch: band-limited pulse waves with
  selectable duty, basic oscillators with optional detune and delayed vibrato, and an 8-bit drum
  kit. The mix has per-part gain and pan, reverb and tempo-synced delay sends, a master low-pass
  following brightness, a compressor and a soft clipper.
- `renderOffline` renders with an `OfflineAudioContext` for tests and clip export.

The renderer uses only the standard Web Audio API, so on a Raspberry Pi it can run under Node
with a Web Audio implementation, reusing the same code.

## Web app (`apps/web`)

A Vite PWA. `Player` wires the sensor sources, the engine, the renderer and the scheduler; every
Play starts a new piece with a new seed. The UI shows the tempo and style controls, the dials
with the sensors feeding them, and each sensor's value, level, activity, onsets and routes.
