# Architecture

Sensinth turns sensor signals into music. The user sets the tempo and the style; sensors decide
everything else, and with no live sensor there is no music. This document describes how a raw
reading becomes a note, how sensors reach the sound through several paths at once, and the rules
that keep the result musical.

## Pipeline

```
                                   ┌─► coarse fingerprint ─► genome ─────────► tracks, machines, patterns,   every section,
 Sensors ──► signal processing ──► │                         (hash chain)        lengths, routings, harmony    or on a new scene
 any unit    median, normalize,    ├─► fine fingerprint ───► phrase mutation ─► trigs, locks, conditions      every phrase
 any rate    One-Euro smoothing    ├─► features ───────────► modulation matrix ► track params, LFOs, globals  every step
             → level, trend,       └─► chaos maps (rate set by sensors) ─┘
               activity, onsets
                                         tracks (step sequencer) ─► realizer (scale, chord) ─► note events ─► per-track synth ─► audio
```

Each stage only talks to the next one, through small types defined in `packages/core`:

| Type               | Meaning                                                                       |
| ------------------ | ----------------------------------------------------------------------------- |
| `SensorDescriptor` | One scalar channel: id, semantic `kind`, unit, optional range and rate        |
| `SensorSample`     | `{ id, t, v }`: one reading, time in seconds                                  |
| `Features`         | `{ level, trend, activity, onset }`, all normalized                           |
| `Fingerprint`      | Every live channel, binned coarse and fine, with a hash for each              |
| `Genome`           | What the sensors chose for a section: tracks, routes, harmony settings, swing |
| `TrackSpec`        | One track: machine, length, speed, trigs, base params, LFO                    |
| `Route`            | `source → destination`, amount and curve, in the modulation matrix            |
| `NoteEvent`        | `{ part, role, step, durSteps, midi?, vel, voice?, micro?, retrig?, params }` |

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

## Dials (`core/src/mapping`)

The `SensorHub` holds every channel from every source. The `Router` summarizes the sensors into
eight dials (macros). They are no longer the only path to the music: they are sources in the
modulation matrix and feed harmony (tension picks chords, brightness picks the mode, color moves
the key).

- **Rules** connect a sensor kind and feature to a macro, with a weight and optional inversion.
  `DEFAULT_MAPPING` covers the shared vocabulary (shake → energy, light → brightness, falling
  pressure → tension, humidity → space, …). A style can add or replace rules.
- **Auto-routing:** a channel whose kind has no rule is assigned by timescale to the least-used
  suitable macro, so a new sensor joins with no code change.
- Each macro is the weighted average of its live sources, slewed with a per-macro time constant.
- **Triggers** (`accent`, `fill`) come from onsets and are honored on the next grid slot.

## Sensors reach the music four ways at once

### 1. The genome (`core/src/genome`)

`Fingerprinter.take` summarizes the live channels (stale ones, and all but the soloed one in the
Sensor lab, are left out):

- **coarse:** kind, level in 6 bins and activity in 3 bins, with hysteresis so a value sitting on
  an edge does not flicker. Fast channels (shakes, sounds) contribute activity only. The coarse
  hash changes when something moved a lot: another place, another light, another colour in
  front of the camera, a sensor switched on or off;
- **fine:** level in 64 bins plus a hash of the raw reading's digits, so almost any difference
  changes the fine hash.

`buildGenome` writes everything for one section from a **hash chain**:
`chain = hash(previous chain, coarse hash, section)`, starting from the first fingerprint. The
previous link is folded in, so even frozen sensors give a new genome every section, while a
replayed recording gives the same chain.

- **Machines and track count** depend only on the coarse hash: they stay while the sensors stay
  roughly where they are, and change with the scene.
- **Patterns, lengths, speeds, base params, LFOs, routings, harmony settings and swing** come from
  the chain.

The engine rebuilds the genome at every section (16 bars), and earlier on a **scene change**: when
a channel that describes the surroundings (slow channels, light, camera colour and brightness,
place) moves more than 0.35 from where it was at the last rebuild for a beat, or a channel
appears or vanishes, at most every 8 bars. A scene change also picks a new key: next to the
place's key when location is on, otherwise one the sensors choose.

**Phrase mutation** (`mutatePhrase`): at every phrase start (4 bars) a few trigs flip, p-locks and
conditions change, a track rotates or changes length, notes move by a step, routes are nudged or
moved to another track. The random stream is `hash(chain, bar, fine hash)`, so a reading that
differs by one digit mutates differently. How many changes depends on the variation dial.

### 2. The step sequencer (`core/src/seq`)

Every track works like a track on an Elektron box:

- its own **length** (1..64 steps) and **speed** (½×, ¾×, 1×, 1½×, 2×), so tracks loop against
  each other (polymeter); palettes mix lengths like 16, 12, 7 and 5;
- **trigs** with velocity, length, probability, **micro timing**, **retrigs** (rolls) and
  **parameter locks** (one step's own cutoff, decay, tune, …);
- **trig conditions**: `A:B` (loop A of every B), `fill`, `pre` (the previous conditional trig on
  this track played), `nei` (the latest conditional trig on the track above played), `first`, and
  their negations.

`generateTrack` writes a pattern per role: Euclidean drums with backbeats, ghosts and fill-only
hits; bass on roots, fifths and approach notes; lead lines that walk mostly by step and answer
themselves; arpeggios in several orders; comping and pads; drones. `TrackRunner` plays a track:
it advances by the track's speed, evaluates conditions and probabilities and scales retrigs by the
`retrig` param.

### 3. The modulation matrix (`core/src/mod`)

Every track has 14 params, each 0..1: level, pan, cutoff, resonance, drive, decay, attack,
timbre, tune (pitch for drums, register for melodic tracks), probability, retrig, micro timing
and two sends. Each step a param is its p-lock if the trig has one, else the genome's base, plus
the sum of the routes into it.

- **Sources:** every live channel's level, activity, trend, hits and fine digits; the 8 dials;
  one LFO per track (sine, triangle, saw, square, sample & hold, smooth random); two chaos maps;
  each track's hits (an envelope).
- **Destinations:** every track param; every LFO's rate and depth; both chaos maps' rate; the
  global tension, brightness, swing and space.

Routes have an amount (−1..1) and a curve (linear, exponential, stepped, folded). The genome
gives **every live sensor at least two strong routes** (|amount| ≥ 0.4), chosen by timescale:
one changes what is played (probability, retrigs, micro timing, chaos rate, swing, tension), one
how it sounds (cutoff, timbre, drive, sends, …). Half the sensors also get a weak route from their
raw digits. Internal routes add an LFO feedback loop (LFO A bends LFO B's rate, LFO B bends LFO
A's depth), one track's hits ducking or plucking another, chaos thinning a pattern, and the dials.

Internal sources (LFOs, chaos maps, envelopes) advance after the routes are summed, so a
destination always reads last step's sources: feedback loops are allowed and stay bounded.

### 4. Chaos

The two chaos sources are logistic maps, `x ← r·x·(1−x)`, with `r` between 3.57 and 4 where the
map is chaotic. Sensors set `r` through routes and the fine fingerprint seeds `x`; map B's rate
follows map A. Two starting points that differ in the tenth decimal are unrelated after a few
dozen steps: the smallest difference in a reading ends up audible.

## Harmony: the rules that keep it musical (`core/src/composer`, `core/src/seq/realize.ts`)

Trigs never hold MIDI notes. They hold a chord-tone index or a scale-degree offset, and
`Realizer` turns them into notes against the scale and chord that are playing. These rules hold
by construction, and the property-based tests check them against random and broken sensor input:

1. **Grid.** Every event starts on a 16th-note step; micro timing, track speed and swing only
   offset when it sounds.
2. **Scale.** Pitches come from scale degrees, so every note is in the current key and mode.
3. **Chord tones on strong beats.** Lead notes on beats and long notes snap to the nearest chord
   tone; arpeggios, chords, pads and drones only play chord or key tones; bass plays chord tones,
   with approach notes only off the beat.
4. **Progressions.** Chords follow the style's Markov table, weighted by the genome's bias per
   degree; tension favors unstable chords, low tension resolves home. Chords change on the
   genome's chord rate (half a bar to four bars).
5. **Slow things change slowly.** The mode follows brightness within the genome's chosen modes, at
   phrase starts, with hysteresis. The key moves around the circle of fifths at section starts
   when color has moved far, or jumps on a scene change.
6. **Voice leading.** Chord voicings move as little as possible inside the track's range.
7. **Bounded output.** Palettes cap density and notes per step; the mix ends in a compressor and
   a soft clipper, so output never exceeds 0 dBFS.

All random choices go through seeded `Rng` streams derived from the hash chain, so the same sensor
data always produces the same notes.

## Styles are palettes (`core/src/styles`)

A style is data (`Style` in `styles/schema.ts`): a name, a suggested tempo, effects, and a
`Palette` — the sound world the sensors compose in:

- **machines**: sound sources per role (pulse leads, FM bells, saw pads, parametric drum voices…),
  each with a pitch range, a density range, track lengths and speeds, and base-param ranges;
- **slots**: which roles are always there and which are optional, and how many tracks;
- the **modes** to choose from, the progression table, chord rates and sizes, swing range, LFO
  range and the most notes per step.

| Style    | Sound world                                                                       |
| -------- | --------------------------------------------------------------------------------- |
| Chiptune | Noise drums, laser zaps, triangle and pulse bass, pulse leads and arpeggios       |
| Ambient  | Saw and hollow drones, saw and glass pads, FM bells and chimes, plucks, soft rims |
| Lo-fi    | Dusty boom-bap drums, sub and FM bass, electric piano, kalimba, whistle, crackle  |

## Audio (`packages/audio`)

- `LookaheadScheduler` wakes every 25 ms and schedules every step due in the next 120 ms on the
  audio clock. After a stall it skips ahead instead of bursting late notes.
- `Renderer` builds a chain per track from its machine: instrument → low-pass filter (cutoff,
  resonance) → clean and driven paths → level → mute → pan → mix, reverb send and delay send,
  plus an analyser for the track's scope. Every step it follows the matrix with short glides; each
  note also carries its own params (timbre, decay, attack, tune). When a genome changes machines,
  the old chain fades out.
- Instruments: band-limited pulse waves (timbre picks the width), basic oscillators with detune
  and delayed vibrato, two-operator FM (timbre sets the index), detuned pads with an opening
  filter, and parametric drum voices (kick, snare, clap, rim, hats, shaker, tom, perc, zap, noise)
  in chip, lo-fi and soft flavours, reshaped by tune, decay and timbre.
- Micro timing, retrigs, swing (a matrix destination) and humanized timing are applied when
  scheduling. Reverb (tail length per style) and the tempo-synced delay return follow `space`; a
  master low-pass follows `brightness`; vinyl crackle and tape wobble follow the dials.
- `setMuted(slot)` silences a track after its chain; the engine keeps running, so muting never
  changes the music's course.
- `renderOffline` renders from any sensor script (simulated by default), with optional mutes,
  for tests and clip export.

The renderer uses only the standard Web Audio API, so on a Raspberry Pi it can run under Node
with a Web Audio implementation, reusing the same code.

## Web app (`apps/web`)

A Vite PWA. `Player` wires the hub, the engine, the renderer and the scheduler. Play needs at
least one source switched on; while no channel is live the music waits and starts on the next bar
after one sends. Because steps are scheduled 120 ms ahead, `Player` queues each step's engine view
with its audio time and the UI shows the one that is sounding.

- **Transport:** the scope of the mix, Play, and the genome card: section and phrase, the genome's
  short hash, where the key came from, and why the pattern was last rewritten (start, new
  section, new scene and the sensor that caused it).
- **Tracks** (`ui/tracks.ts`): one row per track with its machine, length and speed, its own
  scope, a step grid (trigs shaded by velocity, p-lock dots, dashed outlines and labels for
  conditions and probabilities, retrig ticks, micro-timing offsets, the playhead), live param
  meters with the genome's base value marked, and Mute.
- **Modulation** (`ui/matrix.ts`): every route grouped by source, with its amount and a centered
  bar showing what it adds right now.
- Tempo, style, the dials, the sources and each sensor's value, level, activity, onsets and routes.

### Sensor sources (`apps/web/src/sensors`)

Each source implements `WebSensorSource`: it announces its channels on the hub, pushes samples
stamped with `performance.now()`, and throws a `SourceError` with a sentence for the user when it
cannot start. `SourceManager` tracks each source's state (off, starting, on, error, unsupported)
for the Sources panel, and restores sources on reload only when that will not show a prompt.

Feature extraction that is not browser-specific lives in `core`, so a Raspberry Pi can reuse it:
`FrameAnalyzer` (camera brightness, hue and motion that ignores exposure shifts), `rmsDb` and
`spectralCentroid` (microphone), `daylight` and `placeKey`.

The microphone hears the music. While playing, `Player` sets `SensorHub.onsetGate` so sound onsets
within 300 ms after one of our own drum hits do not raise triggers.

Location adds a `geo.place` channel: a hash of the ≈500 m cell, as a value 0..1. Moving to
another place changes the fingerprint (a new scene), and the cell also picks the key of each new
piece. Coordinates never leave the phone.

### Recordings

`SensorRecorder` taps the hub and stores descriptors plus `[t, channel, value]` samples;
`parseRecording` validates a file; `ReplaySource` plays it back in order, looping, with channel ids
prefixed `replay:` so they never clash with live ones. Replaying a recording into the engine is
deterministic, which makes recordings the way to tune styles with real data.

### Sensor lab

`ChannelState.debug` exposes each channel's normalized value before smoothing and the raw-unit
window currently mapped onto 0..1, next to the features. The lab records the selected channel
through a hub tap into a 15-second history and draws two canvas charts (`ui/labChart.ts`): the raw
reading on an auto-scaled axis, and normalized, level, activity and onsets on 0..1. Trend is shown
as a number, since it lives on −1..1. `Router.setSolo(id)` makes one channel the only one driving
the music: dials, triggers, the fingerprint and the matrix.

### Android app (`apps/web/android`)

Capacitor wraps the same web build (`pnpm build:native`: base `/`, no service worker). The WebView
already turns camera, microphone and location requests into Android permission prompts.
`SensorsPlugin.java` reads light, pressure, ambient temperature and humidity from `SensorManager`
and sends `reading` events; `sensors/native.ts` turns them into channels with the shared kinds, so
the default mapping applies (light → brightness, falling pressure → tension, humidity → space).
`MainActivity` keeps the screen on. CI (`.github/workflows/android.yml`) builds the APK, signed
with a committed test key so updates install over each other, and publishes it as the
`android-latest` pre-release.
