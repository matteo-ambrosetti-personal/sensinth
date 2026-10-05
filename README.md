# Sensinth

Generative music from sensor signals. You choose the **tempo** and the **style**; everything else
(melody, bass, chords, drums, timbre, effects) comes from sensors. The engine keeps the result in
key, on the beat and structured in phrases, so it stays listenable whatever the sensors do.

It runs as a web app (PWA) on an Android phone first. The music engine is plain TypeScript with no
browser dependencies, so the same code can later run on a Raspberry Pi, with microcontrollers such
as the Raspberry Pi Pico streaming extra sensors to it.

**Status:** Phase 2. The Chiptune style plays from your phone's motion, tilt, compass,
microphone, camera, location, clock and battery. Sensor sessions can be recorded and replayed. The
Ambient and Lo-fi styles are next; see [docs/roadmap.md](docs/roadmap.md).

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

Press play. On a computer, simulated sensors drive the dials and the music; on a phone, motion and
tilt are on from the start. Turn on more sources (microphone, camera, location) in the Sources
panel.

Use _Record sensors_ to save a session as JSON, and _Load recording_ to replay it, on any device.
Recordings are the quickest way to tune the music on a computer with real sensor data.

### On your phone

Browsers expose sensors, microphone and camera only to secure pages (HTTPS or localhost).

- **Hosted:** every push to `main` deploys to GitHub Pages (enable it once under
  _Settings → Pages → Source: GitHub Actions_). Open the URL in Chrome on Android and choose
  _Add to Home screen_ to install it.
- **Local development:** connect the phone over USB, open `chrome://inspect/#devices` on the
  computer, and add a port-forwarding rule for `5173`. Then open `http://localhost:5173` on the
  phone.

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

## Repository layout

```
packages/core    Music brain: signal processing, sensor hub, mapping, music theory,
                 composer, styles. Pure TypeScript, no DOM, fully unit-tested.
packages/audio   Web Audio renderer: lookahead scheduler, instruments, effects, offline render.
apps/web         The phone app (Vite + PWA): UI, browser sensor adapters.
docs/            Architecture, roadmap, sensor protocol.
```

## Adding a style

A style is data. Copy `packages/core/src/styles/chiptune.ts`, change the modes, chord-progression
table, patterns, instrument patches and effects, and register it in
`packages/core/src/styles/index.ts`. The tests run every registered style through the harmony
checks automatically.
