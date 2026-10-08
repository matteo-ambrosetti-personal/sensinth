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
- **The partition** (`Router.setPartition`, below) decides which channels may drive which dial:
  a rule or trigger route is kept only for a channel that owns the dial's area, and every dial
  whose area has an owner gets a driver, so a single sensor moves all eight.

## Sensors share out the music (`core/src/mapping/partition.ts`)

What sensors control is split into five **domains** of two **areas** each:

| Domain  | Areas                              | Dials and destinations                                |
| ------- | ---------------------------------- | ----------------------------------------------------- |
| Rhythm  | `rhythm.drums`, `rhythm.groove`    | energy, accents; drum prob/retrig/micro; swing, fills |
| Harmony | `harmony.chords`, `harmony.melody` | tension, colour; register, lead/arp tune              |
| Sound   | `sound.drums`, `sound.tonal`       | texture, brightness; cutoff, timbre, drive, decay…    |
| Space   | `space.room`, `space.fx`           | space, sends; pan, the effects depth, sensor-fired FX |
| Motion  | `motion.lfo`, `motion.form`        | LFO rate/depth, chaos; levels, variation              |

`partitionAreas(channels, rules, prev)` deals them out. Channels are grouped by
`SensorDescriptor.group`, the source the user switched on (`SourceManager` stamps it through a
proxy of the hub, so channels announced later, like a MIDI knob, carry it too). One group owns
every area; two to five groups split the domains; six to ten the areas; more share. Then each
group's areas are dealt to its channels. `deal` gives every holder its best free unit first (the
best pairs first), then each remaining unit to whoever wants it most, less a little for what it
already holds; scores come from the kind's dial and trigger rules mapped to areas, a few kind
affinities (sound → space, daylight and place → harmony, light → sound), the timescale and a
bonus for what a holder had before, so a new source moves as little as possible. Ties are broken
by id: the result never depends on the order channels come in.

The engine recomputes it whenever the set of live channels changes (in deterministic mode: the
continuous sensors in the input log that have read, since keys, buttons and shakes act through
their presses wherever they are) and exposes it as `view.partition`. Each new share sticks to the
last one of every live channel, so a Sensor lab solo, which hands one channel everything, leaves
no trace once it ends. `buildRoutes` gives each channel
one strong route per owned area (`areaDest`) from its own random stream, so another sensor
joining does not reshuffle it; `fxTriggers` come from the owners of `space.fx`; `mutateRoute`
moves a sensor route only to a destination in its owner's areas (`destArea`); deterministic
mode's continuous sensors keep their kind's effect when they own its domain, else pick one from
an owned domain (never an instrument change while the instruments are fixed), and follow the
share when it changes.

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

At every section (16 bars), and earlier on a **scene change**, the engine **evolves** the genome
(`genome/evolve.ts`) instead of replacing it: `evolveGenome(prev, fresh, rng, {rate, drift,
palette})` moves the previous genome a step toward a fresh `buildGenome` take. Tracks are matched
by `TrackSpec.option` (the palette slot they fill) and keep their slot, their phrase mutations
and their identity; each 4-step block is taken from the fresh take with a probability set by the
rate and the style's `DriftProfile` (`Style.drift`, per role too); base params walk inside the
machine's ranges, pulled a little toward the fresh take; LFOs drift; now and then a track takes
another length, speed or machine of its slot; at most one or two tracks come or go per step.
Guardrails keep density inside the machine's range (widened to what the generator writes),
conditions and low probabilities under a share, and the anchors (`anchorSteps`: the downbeat,
the template hits) in place. Sensor routes stay while their owner's areas stay. Rates: a section
`0.2·(0.5 + variation)`, a scene 0.65, a resume 0.5; the start and a new style build fresh.

A scene change is due when a channel that describes the surroundings (slow channels, light,
camera colour and brightness, place) moves more than 0.35 from where it was at the last rebuild
for a beat, or a channel appears or vanishes. It is set for the next bar line with room to rise
into it (`sceneAt`), no sooner than 8 bars after the last rebuild; the riser plays in the bar
before, and a section boundary with a scene due counts as the scene. A scene change also picks a
new key: next to the place's key when location is on, otherwise one the sensors choose.

**Drift** (`genome/distance.ts`): `genomeDistance(a, b, keys)` compares two genomes track by track
(matched by slot; a slot holding another kind of track, or a track only one has, counts as 1):
0.3 machine, 0.4 pattern (Jaccard of the onsets on an unrolled grid, and the notes), 0.1 length
and speed, 0.2 base params; the total adds the harmony (modes and forms, bias, chord rate, the
key's distance in fifths, the mode). The engine keeps the first genome and its key as the origin
and reports `view.drift` every bar: the total, each track, a history and the marks (sections,
scenes, edits, evolutions).

**Phrase mutation** (`mutatePhrase`): at every phrase start (4 bars) a few trigs flip, p-locks and
conditions change, a track rotates or changes length, notes move by a step, routes are nudged or
moved to another track. The random stream is `hash(chain, bar, fine hash)`, so a reading that
differs by one digit mutates differently. How many changes depends on the variation dial; an op
that finds nothing to change draws again. Mutations keep the anchors, rotate templated tracks by
whole periods and change their length only to palette lengths that are whole periods (four on
the floor stays on the beat), never touch the FX lane's routes, and now persist: evolution builds
on them.

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

## Deterministic mode (`core/src/seeded`)

`new Engine({ style, deterministic: { seed, origin, loopBars, repeat, sensors, instruments, mapping } })`
swaps the four
paths above for a song that loops while nothing changes, and that every input edits in its own
fixed way.

- **The song** (`song.ts`). `baseSong(style, seed, loopBars)` writes the tracks once from (seed,
  style) through `buildSeededGenome`, and `buildSong(base, edits)` applies the edits to a copy and
  writes the chord loop: `Harmony` with fixed inputs, reseeded before every chord, moving at
  every chord change (`advance(…, move)`), starting from the chord the "chords" edit picks
  (`startAt`).
- **Exact loops.** The engine plays step `pos = step mod (loopBars × 16)`. At every loop start it
  rebuilds the runners (same roll seeds), the realizers, the matrix (LFOs, chaos maps,
  envelopes) and the effect queue, so every pass plays the same notes. The last bar of a loop of
  four bars or more plays the fills. The renderer's humanize comes from a hash of (part, step mod
  768, note) instead of a running generator.
- **Edits** (`effects.ts`, `edits.ts`). An edit is an effect with a count `c`: about twenty
  operations (rotate, rewrite, mute, octave, thin, fill, reverse, rolls, swap instruments, add a
  track, drums out, effect throws, half and double time, key up a fifth or a semitone, mode,
  chords, chord speed, swing, space, brightness), each cycling so every count changes something.
  Edits run in phases (tracks, machines, patterns, sound, mutes, harmony and mix), sorted by
  input within a phase, so the result never depends on the order of the presses.
  `KEY_EFFECTS` maps physical keys (`KeyboardEvent.code`) to effects; MIDI keys, buttons and
  unknown keys pick from the same list; onsets and continuous sensors have their own by kind.
- **Your map** (`mapping.ts`). `INPUT_ROWS` lists every input you can map: single keys, keys
  that act on tracks 1–8 (one row per effect, e.g. `keys:rotate` for A–K), other keys, MIDI keys,
  buttons, onsets by kind and continuous sensors by kind (plus slow and other sensors).
  `InputMapper` resolves an input to its effect: the default, or the row's `InputRule` (another
  effect, `none`, a target; for track rows the key's own track), dropping effects that change
  instruments (`machine`, `addTrack`) when `instruments` is false — inputs without an effect of
  their own then pick from the catalogue without them. A rule can also carry its own `repeat`,
  and for a sensor its own `sensors` mode, which `EditTracker` keeps per input.
- **Counting.** `EditTracker` turns presses into counts by the repeat setting (toggle: presses mod
  2; accumulate: presses; once: at most 1) and readings into zones (five, with hysteresis 0.04):
  in zones mode the zone is the count (−2..2 for sensors that lean either way, 0..4 for
  amounts); in steps mode every zone crossed is a press.
- **Timing.** `InputModel` keeps every channel's readings and presses with their times; every
  step reads them 0.2 s behind the music. Edits apply at bar lines: the song is rebuilt when the
  edits' version changes, and the new song is fast-forwarded silently from the loop start to the
  current position, so the music at any moment is a function of (edits, position).

- **Zones from Play.** A sensor's first reading sets its start zone, and its count is the number
  of zones from there (the short way round for circular sensors, whose hysteresis band wraps
  too), so the seed's own song plays until something moves. `sensors: 'off'` keeps the zone
  meters but counts nothing. A channel that goes away (`InputModel.takeRemoved`) stops counting.
  When another source comes or goes and a sensor's areas change, its zones move what it owns now,
  from the next bar line, still counted from where it was at Play.
- **What lands, and when.** Every edit carries a `description` and the `slots` it lands on
  (`describeEffect`, `effectTargets`); `SongView.pending` lists inputs registered but not yet
  applied, with the bar they land on. A numeric target past the last track does nothing unless
  the effect wraps (catalogue picks for MIDI keys, buttons and other keys, and sensors' hashed
  rewrites do).
- **Evolve** (`evolve: true`): a generation lasts `generationBars(loopBars)` (whole loops, at least
  16 bars). `evolveBase(prev, k)` (`seeded/song.ts`) moves the seed's song a step toward
  `buildSeededGenome(style, seed, k)` with `evolveTracks` and an rng of `(seed, k)`, and now and
  then moves the key a fifth; the engine advances its cached generation one at a time and
  rebuilds with reason `evolve`, so the music is a function of (edits, generation, position).
- **Exact passes.** Notes carry `loopStep`; the renderer's humanize and the drums' noise offset
  hash it, so every pass of a loop sounds the same.
- **Stalls.** `LookaheadScheduler` skips whole steps after a stall and reports how many;
  `Engine.skip(n, dt)` reads the inputs each skipped step would have read and does each skipped
  bar line's work (edits, generation, style), then starts the loop over where the clock is, so the
  song carries on as if it never stalled. A press stamped before the last read counts at once
  instead of never.

The tests check exact loops in every style, a new song from the bar after a press and its loop,
the same version and notes whenever the press came, the three repeat settings, zones and steps,
combinations in either order, every note in the scale under every key, and replays.

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
   genome's chord rate (half a bar to four bars). Styles with **chord scales** (blues, jazz)
   name their chords instead, each the tonic of its own scale (I7 over Mixolydian, ii∅ over
   Locrian, V7♭9 over Phrygian dominant), and play them in forms: a 12-bar blues, a ii–V–I, a
   turnaround. Brightness picks the form, tension may swap in a substitute (a tritone sub for
   V7), and while a chord plays its scale is _the_ scale, so every rule here still holds.
   Blue notes are the one exception: a blues or hip-hop lead may bend to the key's ♭3 or ♭5 on
   a weak step, and then resolves by a semitone.
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

| Style           | Sound world                                                                         |
| --------------- | ----------------------------------------------------------------------------------- |
| Free            | No style: instruments from every style, any mode, any structure, any effects preset |
| Chiptune        | Noise drums, laser zaps, triangle and pulse bass, pulse leads and arpeggios         |
| Ambient         | Saw and hollow drones, saw and glass pads, FM bells and chimes, plucks, soft rims   |
| Lo-fi           | Dusty boom-bap drums, sub and FM bass, electric piano, kalimba, whistle, crackle    |
| Hip-hop         | Punchy kick, clap, rolling hats, sliding 808, electric piano, pluck; blue notes     |
| Jazz            | Swung ride and brushes, walking bass, comping piano or Rhodes, vibraphone, tenor    |
| Blues           | Shuffle kit, walking bass, drawbar organ, barrelhouse piano, harmonica, guitar      |
| Techno / acid   | Four on the floor, offbeat hats, acid bass with accents and slides, dub stabs       |
| Synthwave       | Gated snare, eighth-note saw bass, supersaw pads, gliding lead, arpeggios           |
| Drum & bass     | Breakbeats with ghosts and rolls, reese and sub bass, atmospheric pads              |
| Minimal (Reich) | Marimba, piano and clarinet pulses on tracks at 1, 15/16 and 31/32 speed that phase |

Machines can ask for a **rhythm** (four on the floor, offbeat, backbeat, breakbeat, walking bass,
jazz ride, Charleston comping, pulse) instead of a Euclidean pattern, **blue notes** and
**slides**. **Free** builds its palette from every other style's machines (ids prefixed by the
style, like `techno.acid`) and lets the genome pick the effects preset per section.

## Triggered effects (`core/src/fx`, `audio/src/fx/performance.ts`)

Momentary effects on the whole mix are events too: a `NoteEvent` with role `fx`, an effect id,
a depth and a length. Each style lists the effects that suit it. They come from three places:

1. **Sensor events.** The genome links every fast sensor's onsets to an effect: a shake
   stutters, a clap washes into reverb, a key press throws into the delay, a covered proximity
   sensor dives the filter, a deep trackpad press crushes; other fast sensors get one picked by
   the hash. The lid closing fast stops the tape.
2. **Structure.** A riser in the bar before a new scene; a stutter, brake or tape stop at some
   section ends.
3. **The FX lane**, an Elektron-style track of sparse effect trigs with conditions and
   probabilities, mutated every phrase like the others. It leaves the drastic stops to sensors
   and section ends.

At most one effect starts per step, the ones that take over the mix (stutter, tape stop, brake,
crush, ring) never overlap, and each effect rests for a while after it plays. The matrix's
`fx` destination scales their depth.

The renderer plays them on a bus between the mix and the master filter: a high-pass (riser,
with a noise swell) and a low-pass (dive) in series, a 16th-note gate, and parallel paths that
take over from the dry mix — a looping delay that records one slice and repeats it (stutter), a
delay line whose time grows so pitch and speed fall (tape stop, brake), a staircase wave-shaper
(crush) and a sine ring modulator. The wash and the dub throw send the tracks into the reverb
and the delay, and the throw raises the delay's feedback. Everything is scheduled on the audio
clock with short fades, and muting the FX lane silences them.

## Audio (`packages/audio`)

- `LookaheadScheduler` wakes every 25 ms and schedules every step due in the next 120 ms on the
  audio clock. After a stall it skips ahead instead of bursting late notes.
- `Renderer` builds a chain per track from its machine: instrument → low-pass filter (cutoff,
  resonance) → clean and driven paths → level → mute → pan → mix, reverb send and delay send,
  plus an analyser for the track's scope. Every step it follows the matrix with short glides; each
  note also carries its own params (timbre, decay, attack, tune). When a genome changes machines,
  the old chain fades out.
- Instruments: band-limited pulse waves (timbre picks the width), basic oscillators with detune
  and delayed vibrato, two-operator FM (timbre sets the index, optional tremolo), detuned pads
  with an opening filter, a drawbar organ with a Leslie-like tremolo, and parametric drum voices
  (kick, snare, clap, rim, hats, shaker, tom, perc, zap, noise, ride, crash, cowbell, brush) in
  chip, lo-fi and soft flavours, reshaped by tune, decay and timbre. Pulse and oscillator voices
  can glide between notes, open a per-note filter with accents (acid) and drop in pitch (808s).
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

- **The look** is an amber terminal's (`style.css`, one theme): warm black glass panels with
  faint scan lines, every control in shades of one amber with a soft glow, Chakra Petch for titles
  and buttons, IBM Plex Sans to read and IBM Plex Mono for numbers (`fonts.ts`, self-hosted).
  Colour is kept for meaning: a colour per track and per area, which canvases read once through
  `ui/theme.ts`.
- **Pages:** each panel is on one page. Play holds the console, the tracks, the drift, who drives
  what, the song settings, the dials and the sources; Flow the diagram and every routing; Lab the
  sensor lab and the live sensors. Play and **Start over** sit in the header, on every page.
  Windows side by side share a height, so no gap opens between them.
- **The console:** the screen (below), the scope of the mix, the tempo, the styles, and the
  status bar (Play and **Start over** are in the header; `Player.restart` makes a new engine and
  audio clock without releasing the wake lock or the background service, a second click while one
  is starting waits for it, and Stop meanwhile stops it): section and phrase, the genome's short hash, where the key came
  from, and why the pattern was last rewritten.
- **The screen** (`ui/stage/`): a 192×108 canvas scaled up by whole device pixels, in a bezel
  that hugs it. `Stage` casts each
  part of the style's scene (`scenes/<style>.ts`: a cast of parts by drum voice or role, and a
  draw function) to a track, follows every step's `TrackView.fired` as a hit envelope, the notes
  of the step (`Player.events()`) for pitch, the params for brightness and colour, and draws the
  scene at 30 frames a second; effects act on the whole picture (a stutter jitters it, a tape stop
  greys and slows it, a wash fogs it…), a rebuild wipes it, a muted figure dozes, and an edit
  that lands puts a "!" over the figures it moved. `gfx.ts` draws whole pixels and a 3×5 font,
  `kit.ts` a little figure with poses and props.
- **Drift** (`ui/drift.ts`), **Who drives what** (`ui/areas.ts`) and the **edit banner**
  (`ui/banner.ts`, over the screen) show `view.drift`, `view.partition` and the song's pending
  and landed edits.
- **Tracks** (`ui/tracks.ts`): one row per track with its machine, length and speed, its own
  scope, a step grid (trigs shaded by velocity, p-lock dots, dashed outlines and labels for
  conditions and probabilities, retrig ticks, micro-timing offsets, the playhead), live param
  meters with the genome's base value marked, and Mute. A row a short track does not fill goes
  on in faint outlines past its end. The FX lane shows its effects in the cells, a legend of
  every effect (those in its pattern lit, the one sounding marked), and the effect sounding now.
- **Modulation** (`ui/matrix.ts`): every route grouped by source, with its amount and a centered
  bar showing what it adds right now.
- **Flow** (`ui/flow/`): the signal path as a live diagram. Cards in four columns — sensors (a raw
  trace in the sensor's units beside the processed one: normalized value, level, movement,
  onsets), modulators (genome, dials, song values, LFOs, chaos), tracks (scope, level, pan,
  sends, the params being modulated) and the mix (reverb, delay, the effects bus, master) — with
  links drawn behind them in SVG. `links.ts` bundles the matrix routes, the dials each sensor
  drives, the effects its events fire, the genome it shapes and the audio path into one link per
  pair of nodes: width is strength, brightness and moving dots (a dash offset advanced every
  frame) what passes now, dashes a route that pulls down. Hover or tap lights a node's path; a
  phone stacks the columns and routes the picked sensor's links down the left gutter. The renderer
  exposes analysers on the reverb and delay returns and on the effects bus for its meters.
- Tempo, style (picking one sets its suggested tempo), the dials, the sources and each sensor's
  value, level, activity, onsets and routes.
- **Song mode** (its own window): seed, loop, Evolve, repeat, sensors, instruments, and the
  input map editor (`ui/inputMap.ts`), one row per `INPUT_ROWS` entry with menus for the effect,
  its target and how it repeats; saved in prefs and applied at the next Play or Start over. The
  Song panel (`ui/changes.ts`) lists pending and applied edits with what they do, and a zone
  meter per sensor.

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

Browser-only extras, each feature-detected: `lid.ts` (WebHID: feature report 1 of Apple's
sensor-hub device `05ac:8104` holds the hinge angle), `pressure.ts` (Compute Pressure states as
CPU load), `gamepad.ts` (each axis and analog trigger, plus the buttons held), `midi.ts` (each CC
and the pitch bend, announced when first moved, plus key velocities) and a press-force channel in
`pointer.ts` (Safari's `webkitForce`, pen pressure elsewhere). About 25 sensor kinds cover hinges,
covers, the body and the machine (`lid.angle`, `proximity`, `cover`, `steps.rate`, `thermal`,
`cpu.load`, `wifi.rssi`, `idle`, …) with default dials and triggers; knobs and sticks get no fixed
rule, so the timescale router spreads them over different dials.

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
`SensorsPlugin.java` lists every sensor the phone has: the standard environment sensors,
proximity, the magnetic field, steps (asking for activity recognition), significant motion and a
foldable's hinge, plus up to 12 vendor sensors (types from 65536, non-wake-up; a hall sensor
counts as a cover). Motion and orientation are left to the browser. Once a second it adds battery
temperature, voltage, current, power and charging, thermal headroom, Wi-Fi RSSI, screen
brightness and media volume. `describe()` returns the channels with their kinds, units and
ranges; readings go to the page as one `readings` event every 50 ms with the latest value of each
channel that changed. `sensors/native.ts` announces whatever `describe()` returns, so the default
mapping applies by kind.
`MainActivity` keeps the screen on.

**Background play.** `PlaybackPlugin.java` (`playback.ts` on the web side) starts
`PlaybackService` at Play and ends it at Stop. The service is a `mediaPlayback` foreground service
(plus `microphone` when that permission is granted) with a silent notification and a Stop action,
and holds a partial wake lock (at most six hours). Stop in the notification sends `stopRequested`
to the page, which stops the music. While it runs, `SensorsPlugin` keeps its listeners through
`onPause`, and when the activity stops `MainActivity` tells the WebView it is still visible
(`dispatchWindowVisibilityChanged(VISIBLE)`), so Chromium keeps timers, Web Audio and the motion
sensors at full pace; the renderer keeps `RENDERER_PRIORITY_IMPORTANT`. While the page is hidden,
`Player` stops marking channels stale, so a sensor the system pauses holds its last reading. CI (`.github/workflows/android.yml`) builds the APK, signed
with a committed test key so updates install over each other, and publishes it as the
`android-latest` pre-release.

### Mac app (`apps/mac`)

A small Swift app (AppKit and WKWebView) built with `swiftc` by `build.sh`, no Xcode project.
`WebServer` serves the native web build from the bundle on `127.0.0.1:47123` (falling back to any
free port): loopback http is a secure context, so camera and microphone work, and the fixed port
keeps the page's local storage between launches. `Bridge` is the `sensinth` message handler: the
page asks it to describe, start and stop, and it answers through `window.sensinthNative.receive`,
batching readings every 50 ms like the Android plugin. Readers (`Readers.swift`): the lid angle
(IOHID feature report, 30/s), ambient light and chip temperatures (the private
`IOHIDEventSystemClient`, loaded with `dlsym`), the `AppleSmartBattery` service, thermal state,
host CPU ticks, `kern.memorystatus_level`, idle time from Core Graphics, interface byte counters,
CoreWLAN and CoreBluetooth. Motion: `MotionHelper` listens on a Unix socket and runs the bundled
`sensinth-motion` with `do shell script … with administrator privileges`; the helper powers up
the `AppleSPUHIDDriver` sensors, reads the accelerometer and gyroscope reports of
`AppleSPUHIDDevice` and writes lines to the socket until it closes. On the page,
`sensors/mac.ts` adds the "Mac sensors (app)" and "Mac motion" sources. CI
(`.github/workflows/mac.yml`) builds a universal, ad-hoc signed app on a macOS runner and
publishes it as the `mac-latest` pre-release.
