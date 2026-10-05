# Sensinth

Generative music from sensor signals. You choose the **tempo** and the **style**; everything else
(melody, bass, chords, drums, timbre, effects) comes from sensors. The engine keeps the result in
key, on the beat and structured in phrases, so it stays listenable whatever the sensors do.

It runs on an Android phone (as an app or in Chrome) and on a Mac (as an installable web app). The
music engine is plain TypeScript with no browser dependencies, so the same code can later run on a
Raspberry Pi, with microcontrollers such as the Raspberry Pi Pico streaming extra sensors to it.

**Status:** Phase 3. Three styles (Chiptune, Ambient, Lo-fi) play from your phone's motion,
tilt, compass, microphone, camera, location, clock and battery, and in the Android app also from
its light, pressure, temperature and humidity sensors. On a laptop, the trackpad and keyboard
stand in for motion. The **Sensor lab** shows one sensor at a time, raw and processed, and can
let it drive the music alone. See [docs/roadmap.md](docs/roadmap.md).

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
Sensors → signal processing → features → musical dials → composer → note events → synth → audio
```

1. **Signal processing** cleans each channel (spike removal, smoothing) and scales it to 0..1 by
   learning its range, so any sensor works without calibration.
2. **Features**: level, trend, activity (how much it moves) and onsets (sudden events).
3. **Musical dials** (energy, tension, brightness, space, variation, texture, register, color) are
   driven by sensor features through a mapping. Unknown sensors are assigned automatically by how
   fast they change.
4. **The composer** picks key, mode, chords, rhythms and melody. Sensors never set a pitch
   directly: every note is snapped to the current scale and to the 16th-note grid, strong beats
   land on chord tones, and melodies repeat and vary a remembered motif.

Details: [docs/architecture.md](docs/architecture.md).

## Getting started

Requires Node 22.12+ and pnpm 10 (`corepack enable` installs it).

```sh
pnpm install
pnpm dev          # http://localhost:5173
```

Press play. On a computer the pointer and keyboard drive the dials and the music; on a phone,
motion and tilt are on from the start. Turn on more sources (microphone, camera, location,
simulated sensors) in the Sources panel.

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

A style is data. Copy `packages/core/src/styles/chiptune.ts`, change the modes, chord-progression
table, patterns, instrument patches and effects, and register it in
`packages/core/src/styles/index.ts`. The tests run every registered style through the harmony
checks automatically.
