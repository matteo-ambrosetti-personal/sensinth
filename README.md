# Sensinth

Generative music from sensor signals. You choose the **tempo** and the **style**; the sensors write
everything else: which instruments play, every track's pattern, how the tracks modulate each
other, the key and the mode. No sensor, no music. The engine keeps the result in key, on the beat
and structured in phrases, so it stays listenable whatever the sensors do.

It runs on an Android phone (as an app or in Chrome) and on a Mac (as an installable web app). The
music engine is plain TypeScript with no browser dependencies, so the same code can later run on a
Raspberry Pi, with microcontrollers such as the Raspberry Pi Pico streaming extra sensors to it.

**Status:** Phase 3.5. Three styles (Chiptune, Ambient, Lo-fi) are sound palettes that the sensors
compose in, like a Digitakt played by your surroundings: tracks with their own lengths, trig
conditions, parameter locks and LFOs, and a modulation matrix where sensors, LFOs and chaos maps
move each other. A different place, light or colour rewrites the track; even a tiny change in a
reading changes the next phrase, and nothing repeats. The **Tracks** panel shows each track's
waveform, steps and parameters (with Mute), the **Modulation** panel every live routing. Sources:
your phone's motion, tilt, compass, microphone, camera, location, clock and battery, and in the
Android app its light, pressure, temperature and humidity sensors; on a laptop, the trackpad and
keyboard. The **Sensor lab** shows one sensor at a time, raw and processed. See
[docs/roadmap.md](docs/roadmap.md).

## Get it

### Android app

Download **sensinth.apk** from the
[Sensinth for Android (latest)](https://github.com/matteo-ambrosetti-personal/sensinth/releases/tag/android-latest)
release on your phone, open it, and allow your browser to install unknown apps when Android asks.
Every push to `main` builds a new APK there; it installs over the previous one and keeps your
settings. The app is signed with a test key, for testing only.

The app reads everything the web version does plus the sensors browsers hide (light, air pressure,
and temperature and humidity on phones that have them). It keeps the screen on while open.

### Mac (and any computer)

Open the hosted app (GitHub Pages, below) in Chrome or Safari and install it:

- **Chrome:** the install icon at the right of the address bar, or ⋮ → _Cast, save and share_ →
  _Install page as app_.
- **Safari (macOS Sonoma or later):** _File_ → _Add to Dock_.

It then opens in its own window from the Dock and works offline. On a laptop the **Pointer & keys**
source is on by default: moving the pointer (or scrolling) raises the energy, its height sets the
melody's register, left–right the timbre, and typing adds accents. The microphone, camera and
location work too.

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
   current scale and chord, on the 16th-note grid, with chord tones on strong beats.

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
docs/            Architecture, roadmap, sensor protocol.
```

## Adding a style

A style is data: a palette of machines (sounds with ranges for their patterns and parameters),
which roles are always there, the modes, chord-progression table, track lengths and limits, plus
effects. Copy `packages/core/src/styles/chiptune.ts`, change it, and register it in
`packages/core/src/styles/index.ts`. The tests run every registered style through the harmony
checks and the browser render test automatically.
