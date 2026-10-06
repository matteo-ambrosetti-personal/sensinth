# Sensinth

Generative music from sensor signals. You choose the **tempo** and the **style**; the sensors write
everything else: which instruments play, every track's pattern, how the tracks modulate each
other, the key and the mode. No sensor, no music. The engine keeps the result in key, on the beat
and structured in phrases, so it stays listenable whatever the sensors do.

It runs on an Android phone (as an app or in Chrome) and on a Mac (as an app or in the browser). The
music engine is plain TypeScript with no browser dependencies, so the same code can later run on a
Raspberry Pi, with microcontrollers such as the Raspberry Pi Pico streaming extra sensors to it.

**Status:** Phase 3.10. Ten styles (Chiptune, Ambient, Lo-fi, Hip-hop, Jazz, Blues, Techno / acid,
Synthwave, Drum & bass and Reich-like Minimal) are sound palettes that the sensors compose in, and
**Free** has no style at all: the sensors also pick the instruments, from every style. It plays
like a Digitakt driven by your surroundings: tracks with their own lengths, trig
conditions, parameter locks and LFOs, and a modulation matrix where sensors, LFOs and chaos maps
move each other. A different place, light or colour rewrites the track; even a tiny change in a
reading changes the next phrase, and nothing repeats. The **Tracks** panel shows each track's
waveform, steps and parameters (with Mute), the **Modulation** panel every live routing. Blues and
jazz leave the key the way they should (12-bar forms, ii–V–I, tritone subs, blue notes), and
**triggered effects** answer what happens around you: a shake stutters the mix, a clap washes it
into reverb, closing a Mac's lid stops the tape, and an FX lane throws in risers, dives, dub
throws and gate chops. Sources: your phone's motion, tilt, compass, microphone, camera, location,
clock and battery; in the Android app every sensor the phone has plus its battery, heat, Wi-Fi,
brightness and volume; in the Mac app the lid angle, light, chip and battery temperatures, power,
CPU, memory, Wi-Fi, Bluetooth and idle time, and (with your password) the accelerometer and
gyroscope; on any computer the trackpad (including Force Touch pressure), keyboard, game
controllers and MIDI controllers, and in Chrome the MacBook lid and CPU pressure. The **Flow** page draws the whole path live: each sensor's raw and processed signal,
the routes it takes to the tracks, and how the tracks are mixed and sent through the effects to
the speakers; tap a sensor to light up everything it moves. The **Sensor lab** shows one sensor at
a time, raw and processed. Switch on **Deterministic** and set a **seed** for the opposite
promise: the seed writes a song that loops until you change something, and every key and sensor
changes it its own way, the same way every time. See
[docs/roadmap.md](docs/roadmap.md).

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
2. **The genome.** A fingerprint of every live sensor, through a hash chain, writes each 16-bar
   section: which machines play, each track's length, speed, pattern and sound, the routings, the
   modes and chord rate. When the surroundings change (place, light, the colour in front of the
   camera, a sensor switched on), it is rewritten at the next bar.
3. **Every phrase mutates**, seeded by the fine detail of the readings: trigs, locks, conditions,
   notes and routes change a little. Frozen sensors still never repeat.
4. **Tracks** work like an Elektron sequencer: their own length and speed, trig conditions (1:2,
   fill, pre, nei, first), probabilities, micro timing, retrigs and parameter locks.
5. **The modulation matrix**: sensor features, dials, an LFO per track, two chaos maps and track
   hits modulate every track parameter, the LFOs and each other. Every sensor has at least two
   strong routes.
6. **The harmony keeper**: sensors never set a pitch directly. Every note is realized against the
   current scale and chord, on the 16th-note grid, with chord tones on strong beats. In blues and
   jazz each chord brings its own scale.
7. **Triggered effects** (stutter, tape stop, vinyl brake, riser, filter dive, reverb wash, dub
   throw, bit crush, gate chop, ring mod) fire on sensor events, at structural moments and from
   the FX lane, one at a time.

### Deterministic mode: a song your inputs edit

Switch on **Deterministic** in the Style panel and pick a **seed** (42 by default). It works with
every style and takes effect at the next Play.

- **The seed writes a song that loops.** With no input changing, the same loop plays forever
  (choose 2, 4, 8, 12 or 16 bars). It plays with no sensor at all.
- **Every input has one fixed effect.** Each key does its own thing, always the same: `1`–`8`
  mute tracks, `Q`–`I` rewrite them, `A`–`K` rotate them, `Z`–`,` move them up an octave; `O`
  moves the key up a fifth, `P` changes the mode, `L` the chords, `[` `]` half and double time,
  `\` takes the drums out, Space fills them, Enter adds a track (the full list is under **What
  each key does** in the Song panel). MIDI keys and controller buttons pick from the same
  effects, and onsets of fast sensors have their own (a shake rewrites the drums, a clap fills
  them). Continuous sensors have one each too: tilt moves the key, roll the mode, light the
  brightness, the lid the number of tracks, the pointer the drums and the melody.
- **A change makes a new song from the next bar**, which then loops in turn. Several changes
  combine, and the result never depends on the order they came in. The loop keeps its place, and
  the music at any moment depends only on the changes and the position in the loop.
- **You choose how inputs count.** _Same key again_: **toggles** (pressing again undoes it), **adds
  up** (every press applies it once more) or **counts once**. _Sensors_: **zones** (each sensor's
  range is split into five zones; coming back to a zone brings back its song) or **steps** (every
  zone crossed counts as a press).
- **The Song panel** lists every change in effect (which input, what it does, how many times),
  and the card under the scope shows the loop position and the song's version.

Inputs are read 0.2 s behind the music from a log of what they did, so when a timer fires never
matters. Recordings keep key presses, and a replay starts over at Play, so a recording plays the
identical song. In zones mode, sensors that drift (CPU load, Wi-Fi, the time of day) change the
song when they cross a zone: turn those sources off for a still loop.

Details: [docs/architecture.md](docs/architecture.md).

## Getting started

Requires Node 22.12+ and pnpm 10 (`corepack enable` installs it).

```sh
pnpm install
pnpm dev          # http://localhost:5173
```

Press play. On a computer the pointer, keyboard and clock drive the music; on a phone, motion,
tilt and the clock are on from the start. Turn on more sources (microphone, camera, location,
simulated sensors) in the Sources panel; with every source off, Play waits for one.

**Tracks** shows each track as it plays: its machine, length and speed, its own waveform, its
steps (shade = velocity, purple dot = parameter lock, dashed outline and label = trig condition or
probability, ticks = retrig, square outline = playhead) and its live parameters, where the bar is
the value now and the tick is where the genome set it. **Mute** silences a track without changing
where the music goes. **Modulation** lists every route, grouped by source, with a bar showing
what it adds right now. The card under Play shows the section, the genome's id, where the key came
from and why the tracks were last rewritten.

**Sensor lab** (top right) tests one sensor at a time: pick it, and two live charts show its raw
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
