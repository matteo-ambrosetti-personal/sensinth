# Sensinth

Generative music from sensor signals. You choose the **tempo** and the **style**; the sensors write
everything else: which instruments play, every track's pattern, how the tracks modulate each
other, the key and the mode. No sensor, no music. The engine keeps the result in key, on the beat
and structured in phrases, so it stays listenable whatever the sensors do.

It runs on an Android phone (as an app or in Chrome) and on a Mac (as an app or in the browser). The
music engine is plain TypeScript with no browser dependencies, so the same code can later run on a
Raspberry Pi, with microcontrollers such as the Raspberry Pi Pico streaming extra sensors to it.

**Status:** Phase 3.12. Ten styles (Chiptune, Ambient, Lo-fi, Hip-hop, Jazz, Blues, Techno / acid,
Synthwave, Drum & bass and Reich-like Minimal) are sound palettes that the sensors compose in, and
**Free** has no style at all: the sensors also pick the instruments, from every style. It plays
like a Digitakt driven by your surroundings: tracks with their own lengths, trig conditions,
parameter locks and LFOs, and a modulation matrix where sensors, LFOs and chaos maps move each
other.

- **You can see the music.** The **screen** at the top is a little pixel scene per style, like a
  Pocket Operator's display: in Chiptune the hero jumps on the kick and coins spin on the hats; in
  Jazz a drummer, a bassist, a pianist and a sax player play their own tracks; in Techno the crowd
  raises its hands on the clap and lasers sweep with the acid bass. Effects shake, fog or freeze
  the picture, a new section wipes it like a level change, and the sky changes as the music ages.
- **Sensors share out the music.** One source on its own drives everything. Turn on more and each
  gets its own part: motion the rhythm, light the sound, the microphone the space, the clock the
  harmony. **Who drives what** shows the share.
- **The music drifts.** Every section takes the tracks a step further from where they started (a
  few beats rewritten, the sound walking, now and then another instrument), each style in its own
  way, and **Drift** draws how far each track has come.
- **The look is a 16-bit console's**: blue menu windows, pixel fonts, cartridges for the styles,
  an A button for Play and a B button for Start over.

A different place, light or colour rewrites the track; even a tiny change in a reading changes the
next phrase, and nothing repeats. The **Tracks** panel shows each track's waveform, steps and
parameters (with Mute and how far it has drifted), **Every routing** each live route. Blues and
jazz leave the key the way they should (12-bar forms, ii–V–I, tritone subs, blue notes), and
**triggered effects** answer what happens around you: a shake stutters the mix, a clap washes it
into reverb, closing a Mac's lid stops the tape, and an FX lane throws in risers, dives, dub
throws and gate chops. Sources: your phone's motion, tilt, compass, microphone, camera, location,
clock and battery; in the Android app every sensor the phone has plus its battery, heat, Wi-Fi,
brightness and volume; in the Mac app the lid angle, light, chip and battery temperatures, power,
CPU, memory, Wi-Fi, Bluetooth and idle time, and (with your password) the accelerometer and
gyroscope; on any computer the trackpad (including Force Touch pressure), keyboard, game
controllers and MIDI controllers, and in Chrome the MacBook lid and CPU pressure. The **Flow**
page draws the whole path live: each sensor's raw and processed signal, the routes it takes to
the tracks, and how the tracks are mixed and sent through the effects to the speakers; tap a
sensor to light up everything it moves. The **Lab** shows one sensor at a time, raw and
processed. Switch on **Deterministic** and set a **seed** for the opposite promise: the seed
writes a song that loops until you change something, every key and sensor changes it its own way,
the same way every time, and the screen tells you what an input will do and when it lands.
Picking a style sets its tempo, **Start over** begins again from the top, and the Android app
keeps playing with the screen off. See [docs/roadmap.md](docs/roadmap.md).

## Get it

### Android app

Download **sensinth.apk** from the
[Sensinth for Android (latest)](https://github.com/matteo-ambrosetti-personal/sensinth/releases/tag/android-latest)
release on your phone, open it, and allow your browser to install unknown apps when Android asks.
Every push to `main` builds a new APK there; it installs over the previous one and keeps your
settings. The app is signed with a test key, for testing only.

The app reads everything the web version does plus everything browsers hide. **Phone sensors
(app)** lists what your phone has and turns each into a channel. On a Galaxy S23 that is:

- light, air pressure, proximity (cover the top of the screen: accents and a filter dive), the
  magnetic field, steps per minute (Android asks for _Physical activity_ the first time) and
  "started moving";
- Samsung's own sensors, by the names the phone gives them (the hall sensor of a flip cover counts
  as a cover: closing it fills and brakes the tape);
- battery temperature, voltage, current and power draw, charging, thermal headroom, Wi-Fi signal,
  screen brightness and media volume.

There is no temperature or humidity sensor in the S23 (phones that have them get those too).
Motion, rotation and orientation come from the **Motion** source. The app keeps the screen on
while open.

**It keeps playing in the background.** While the music plays, turn the screen off or switch to
another app: a _Sensinth is playing_ notification stays up, with **Stop**. The phone's sensors keep
reading (and the microphone, if you allowed it); the camera pauses, and a sensor the system pauses
holds its last reading. The first Play asks to show notifications (Android 13 and later); the
music plays on either way. If a Samsung phone still stops it after a while, set the app's battery
use to _Unrestricted_ (Settings → Apps → Sensinth → Battery).

### Mac app

Download **Sensinth-mac.zip** from the
[Sensinth for Mac (latest)](https://github.com/matteo-ambrosetti-personal/sensinth/releases/tag/mac-latest)
release, unzip it and move **Sensinth.app** to Applications. It is not notarized, so the first
time macOS refuses to open it: open _System Settings → Privacy & Security_, scroll down and click
_Open Anyway_ (or run `xattr -dr com.apple.quarantine /Applications/Sensinth.app`). Allow the
camera, microphone and Bluetooth when asked, if you want those sources.

**Mac sensors (app)** is on from the start and reads, where your Mac has them:

- the **lid angle** (16-inch MacBook Pro from 2019, M2 and later MacBook Air, 14/16-inch Pro):
  opening sets the space, moving it adds variation, closing it fast stops the tape;
- ambient light, chip temperature, battery level, temperature and power draw, charging;
- thermal state, CPU load, memory in use, idle time (sitting still calms the music), network
  traffic;
- Wi-Fi signal and noise, and how many Bluetooth devices are nearby.

**Mac motion** reads the accelerometer and gyroscope of Apple Silicon MacBooks (shake, rotation,
tilt). Only an administrator can read them, so macOS asks for your password and runs a small
helper inside the app until you turn it off or quit. It is experimental: if it says the Mac has no
motion sensor it can read, the rest still works.

### Mac (and any computer) in the browser

Open the hosted app (GitHub Pages, below) in Chrome or Safari and install it:

- **Chrome:** the install icon at the right of the address bar, or ⋮ → _Cast, save and share_ →
  _Install page as app_.
- **Safari (macOS Sonoma or later):** _File_ → _Add to Dock_.

It then opens in its own window from the Dock and works offline. On a laptop the **Pointer** and
**Keyboard** sources are on by default: moving the pointer (or scrolling) raises the energy, its
height sets the melody's register, left–right the timbre, and typing adds accents; a Force Touch
press (Safari) or a pen's pressure accents too. A browser can't read a Mac's tilt (the motion
sensor needs administrator rights): the Mac app can, with **Mac motion**. The microphone, camera and location work too, and:

- **MacBook lid** (Chrome or Edge): pick the lid sensor once when asked; it reconnects after that.
- **CPU pressure** (Chrome or Edge): a busy computer makes busier music.
- **Game controllers**: every stick and trigger is a channel; buttons add accents and stutters.
  Press a button so the browser sees the controller.
- **MIDI controllers**: each knob, fader or pitch bend becomes a channel the first time you move it
  and drives its own dial; keys add accents and dub throws.

### Hosted web app

Every push to `main` deploys to GitHub Pages:
<https://matteo-ambrosetti-personal.github.io/sensinth/>. Enable it once under
_Settings → Pages → Source: GitHub Actions_. In Chrome on Android, _Add to Home screen_ installs
it.

## How it works

```
                                     ┌─► genome: machines, patterns, lengths, routings, key   (every section, or a new scene)
Sensors → signal processing → ───────┼─► phrase mutations                                     (every phrase)
          features                   ├─► modulation matrix ⇄ LFOs, chaos maps, track hits    (every step)
                                     └─► dials: energy, tension, brightness, …
                        tracks (step sequencer) → harmony keeper → per-track synths → audio
```

1. **Signal processing** cleans each channel (spike removal, smoothing) and scales it to 0..1 by
   learning its range, so any sensor works without calibration. Features: level, trend, activity
   (how much it moves) and onsets.
2. **Sensors share out the music.** What sensors control is split into five domains of two areas
   each: rhythm (the drums' hits, the groove), harmony (chords and key, the melody), sound (the
   drums' sound, the tone), space (the room, the effects) and motion (LFOs and chaos, the form).
   One source on its own owns all of them; two to five sources split the domains, six to ten the
   areas, by what suits each (motion the rhythm, light the sound, the microphone the space, the
   clock the harmony); within a source, its channels split its share. A sensor only moves the
   routes, dials, accents, fills and effects of its own areas.
3. **The genome.** A fingerprint of every live sensor, through a hash chain, writes the music:
   which machines play, each track's length, speed, pattern and sound, the routings, the modes and
   chord rate. **Every section evolves it** instead of starting over: each track keeps its identity
   and takes a few beats from a fresh take of the sensors, its sound walks inside its machine's
   ranges, and now and then it changes length, speed or instrument, so the music drifts further
   and further from where it started, each style at its own pace (Ambient in its sound and
   harmony, Techno in the drums and the acid, Minimal in the phase). When the surroundings change
   (place, light, the colour in front of the camera, a sensor switched on) it evolves a big step
   at the next bar, with a riser into it.
4. **Every phrase mutates**, seeded by the fine detail of the readings: trigs, locks, conditions,
   notes and routes change a little, and the changes stay. Frozen sensors still never repeat, and
   the downbeat, four on the floor and the backbeat stay where they are.
5. **Tracks** work like an Elektron sequencer: their own length and speed, trig conditions (1:2,
   fill, pre, nei, first), probabilities, micro timing, retrigs and parameter locks.
6. **The modulation matrix**: sensor features, dials, an LFO per track, two chaos maps and track
   hits modulate every track parameter, the LFOs and each other. Every sensor has a strong route
   into each of its areas, and at least two.
7. **The harmony keeper**: sensors never set a pitch directly. Every note is realized against the
   current scale and chord, on the 16th-note grid, with chord tones on strong beats. In blues and
   jazz each chord brings its own scale.
8. **Triggered effects** (stutter, tape stop, vinyl brake, riser, filter dive, reverb wash, dub
   throw, bit crush, gate chop, ring mod) fire on sensor events, at structural moments and from
   the FX lane, one at a time.

### Deterministic mode: a song your inputs edit

Switch on **Deterministic** in the Song mode window and pick a **seed** (42 by default). It works
with every style and takes effect at the next Play, or when you press **Start over**, which also
undoes every change.

- **The seed writes a song that loops.** With no input changing, the same loop plays forever
  (choose 2, 4, 8, 12 or 16 bars). It plays with no sensor at all.
- **Every input has one fixed effect.** Each key does its own thing, always the same: `1`–`8`
  mute tracks, `Q`–`I` rewrite them, `A`–`K` rotate them, `Z`–`,` move them up an octave; `O`
  moves the key up a fifth, `P` changes the mode, `L` the chords, `[` `]` half and double time,
  `\` takes the drums out, Space fills them, Enter adds a track (the full list is under **What
  each input does**, below the settings). MIDI keys and controller buttons pick from the same
  effects, and onsets of fast sensors have their own (a shake rewrites the drums, a clap fills
  them). Continuous sensors have one each too: tilt moves the key, roll the mode, light the
  brightness, the lid the number of tracks, the pointer the drums and the melody.
- **A change makes a new song from the next bar**, which then loops in turn. Several changes
  combine, and the result never depends on the order they came in. The loop keeps its place, and
  the music at any moment depends only on the changes and the position in the loop.
- **You see what an input does, and when.** The moment an input counts, a box on the screen says
  what it will do to this song and at which bar (`Q ▸ Rewrite T1 · Triangle bass · bar 3`); when
  it lands, the figure it moved shows a "!", its track flashes and the box says which song is now
  playing. Pressing a toggling key again before the bar line shows that it undoes. The Song panel
  lists what is coming and what is in effect, and a five-cell meter per sensor shows its zone
  now and where it was at Play.
- **You choose how inputs count.** _Same key again_: **toggles** (pressing again undoes it), **adds
  up** (every press applies it once more) or **counts once**. _Sensors_: **zones** (each sensor's
  range is split into five zones, counted from where it was at Play, so the seed's own song plays
  first; coming back to a zone brings back its song), **steps** (every zone crossed counts as a
  press) or **off** (only keys and presses edit the song). _Instruments_: **can change**
  (Backspace swaps them, Enter adds one) or **stay the seed's** (inputs that would change them do
  nothing). Number keys past the last track do nothing: `6` on a four-track song is "no such
  track".
- **Evolve** (off by default): every generation (whole loops, at least 16 bars) the seed's song
  grows a little, a few beats and a little of its sound at a time, now and then the key a fifth
  up. The same seed always evolves the same way, and your edits apply on top of the generation
  playing. Off, the loop stays exact until an input changes it.
- **You choose what each input does.** **What each input does** lists every key (keys that act on
  tracks 1–8 share a row), MIDI keys and controller buttons, sudden changes (a shake, a clap, a
  closed cover…) and sensors (tilt, light, the lid…). Give any of them another effect, on the
  tracks you pick, or none; and its own repeat (toggles, adds up, counts once) or, for a sensor,
  zones or steps. Rows left on _(default)_ follow the settings above; **Back to the defaults**
  clears your changes. Your map is saved on this device.
- **The Song panel** lists every change in effect (which input, what it does to which tracks, how
  many times), and the status bar under the console shows the loop position and the song's
  version. Every pass of the loop sounds the same, down to the humanized timing and the drums'
  noise, and after the page stalls the song picks up where the clock is.

Inputs are read 0.2 s behind the music from a log of what they did, so when a timer fires never
matters. Recordings keep key presses, and a replay starts over at Play, so a recording plays the
identical song. In zones mode, sensors that drift (CPU load, Wi-Fi, the time of day) change the
song when they cross a zone: choose _Sensors: off_ for a still loop. With several sources on, a
sensor's own effect comes from its share of the music (see **Who drives what**).

Details: [docs/architecture.md](docs/architecture.md).

## Getting started

Requires Node 22.12+ and pnpm 10 (`corepack enable` installs it).

```sh
pnpm install
pnpm dev          # http://localhost:5173
```

Press the green A button. On a computer the pointer, keyboard and clock drive the music; on a
phone, motion, tilt and the clock are on from the start. Picking a cartridge (a style) sets its
suggested tempo (change it after with the slider, − + or Tap); the yellow B button, **Start
over**, begins a new piece from the top. Turn on more sources (microphone, camera, location,
simulated sensors) in the Sources panel; sources this device can't use wait under _Not on this
device_. With every source off, Play waits for one.

- **The screen** plays the music with a little pixel band, one scene per style.
- **Drift** draws how far the piece has come from where it started, bar by bar: a thin line per
  track in its colour, a thick white line for the whole piece, ticks for sections and ★ for a new
  scene.
- **Who drives what** shows every source that is on, the areas it controls and which of its
  sensors does which; the dials and the live sensors carry the same colours.
- **Tracks** shows each track as it plays: its machine, length and speed, how far it has
  drifted, its own waveform, its steps (brighter = louder, a magenta dot = its own sound on this
  step, a dashed outline and label = it plays only sometimes, ticks = a roll, a white box = now)
  and its live parameters, where the bar is the value now and the tick is the track's own value.
  The legend above the tracks says the same. **Mute** silences a track without changing where
  the music goes. **Every routing** lists every route, grouped by source, with a bar showing what
  it adds right now. The status bar under the console shows the section, the genome's id, where
  the key came from and why the tracks were last rewritten.

**Lab** (top right) tests one sensor at a time: pick it, and two live charts show its raw
reading in its own units and what the engine makes of it (normalized value, smoothed level,
activity, onsets), with its mapped range, reading rate and the dials it drives. _Solo in the music_
lets only that sensor drive the music.

Use _Record sensors_ to save a session as JSON, and _Load recording_ to replay it, on any device.
Recordings are the quickest way to tune the music on a computer with real sensor data.

### Phone development

Browsers expose sensors, microphone and camera only to secure pages (HTTPS or localhost). Connect
the phone over USB, open `chrome://inspect/#devices` on the computer, and add a port-forwarding
rule for `5173`. Then open `http://localhost:5173` on the phone.

### Building the Android app yourself

Needs JDK 21 and the Android SDK (Android Studio installs both).

```sh
pnpm --filter @sensinth/web android:sync     # web build + copy into apps/web/android
cd apps/web/android && ./gradlew assembleRelease
# → app/build/outputs/apk/release/app-release.apk
```

Or open `apps/web/android` in Android Studio and press Run.

## Scripts

| Command          | What it does                                                    |
| ---------------- | --------------------------------------------------------------- |
| `pnpm dev`       | Run the web app with hot reload                                 |
| `pnpm build`     | Production build of the PWA into `apps/web/dist`                |
| `pnpm test`      | Unit and property-based tests (Vitest)                          |
| `pnpm e2e`       | Browser tests: renders every style offline and checks the audio |
| `pnpm typecheck` | TypeScript in every package                                     |
| `pnpm lint`      | ESLint                                                          |
| `pnpm format`    | Prettier                                                        |
| `pnpm check`     | Everything CI runs, except the browser tests                    |

In `apps/web`: `pnpm build:native` builds for the Android app, `pnpm android:sync` also copies it
into the Android project.

## Repository layout

```
packages/core    Music brain: signal processing, sensor hub, mapping, music theory,
                 composer, styles. Pure TypeScript, no DOM, fully unit-tested.
packages/audio   Web Audio renderer: lookahead scheduler, instruments, effects, offline render.
apps/web         The app (Vite + PWA): UI, sensor adapters, Sensor lab.
apps/web/android The Android app (Capacitor), with a native plugin for hidden sensors.
apps/mac         The Mac app (Swift): the web app in a window, native sensor readers and the
                 motion helper. build.sh builds it on macOS.
docs/            Architecture, roadmap, sensor protocol.
```

## Adding a style

A style is data: a palette of machines (sounds with ranges for their patterns and parameters),
which roles are always there, the modes, chord-progression table, track lengths and limits, plus
effects (and which triggered effects suit it). Copy `packages/core/src/styles/chiptune.ts` (or
`blues.ts` for chord scales and forms), change it, and register it in
`packages/core/src/styles/index.ts`; Free picks up its machines automatically. The tests run every
registered style through the harmony checks, the effect rules and the browser render test.
