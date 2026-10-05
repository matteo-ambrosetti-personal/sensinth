# Roadmap

## Phase 0: scaffold (done)

pnpm workspace, strict TypeScript, Vite, Vitest, ESLint, Prettier, CI and a GitHub Pages deploy.
The Pages deploy needs enabling once: _Settings → Pages → Source: GitHub Actions_.

## Phase 1: first sound from simulated sensors (done)

The `core` engine (signal processing, mapping, theory, composer), the `audio` renderer, the
Chiptune style, simulated sensors and the first UI.

## Phase 2: phone sensors (done, pending a field test)

Browser adapters in `apps/web/src/sensors`, each a switch in the Sources panel:

| Source          | Channels (kind)                                               | Notes                                                             |
| --------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| Motion & tilt   | shake (`motion.accel`), spin, tilt, roll, compass (`heading`) | `devicemotion` / `deviceorientation`; no prompt on Android        |
| Microphone      | loudness (`sound.level`), brightness (`sound.brightness`)     | Echo cancellation on; onsets during our own drum hits are ignored |
| Camera          | brightness (`camera.luma`), color (`camera.hue`), movement    | Rear camera, 32×24 thumbnail at 12 fps; stands in for light       |
| Location        | speed (`geo.speed`), altitude                                 | The place (≈500 m cell) picks the key of each new piece           |
| Clock & battery | daylight (`time.daylight`), battery                           | Always available                                                  |
| Light sensor    | lux (`light`)                                                 | Only when Chrome's Generic Sensor Extra Classes flag is on        |
| Simulated       | ten fake channels                                             | Default on computers                                              |
| Replay          | whatever was recorded                                         | Load a recording made with _Record sensors_                       |

Defaults: phones start with Motion & tilt plus Clock & battery; computers start with Simulated.
Sources that show a permission prompt (microphone, camera, location) are only restored on reload
when the permission is already granted; otherwise they wait for a tap.

**Done when:** shaking the phone raises the energy, covering the camera darkens the sound, and a
recorded walk replays on desktop. The browser tests cover the first and third with synthetic
motion events and recordings; the camera mapping is unit-tested. A walk with a real phone is the
remaining check.

## Phase 3: styles, apps and the Sensor lab (done)

- **Ambient:** a drone under slow pads, a sparse pentatonic bell melody, deep reverb, and a soft
  rim pulse only at high energy.
- **Lo-fi:** swung boom-bap drums, electric-piano 7th and 9th chords, sub bass, vinyl crackle,
  tape wobble and humanized timing.
- New instruments: two-operator FM (keys, bells), detuned pads, a lo-fi drum kit.
- **Sensor lab:** one sensor at a time, raw and processed, with solo.
- **Android app** (Capacitor) with a native plugin for light, pressure, temperature and humidity,
  built by CI and published as the _Sensinth for Android (latest)_ release.
- **Mac:** installable web app; Pointer & keys source; WebKit (Safari engine) browser tests in CI.

Lo-fi chords stay diatonic: a borrowed iv chord would break the "every note in key" guarantee and
needs a notion of temporary scales first.

## Phase 3.5: sensor-driven tracks (done)

Sensors used to nudge a fixed base: every style had fixed patterns and sounds, and with every
sensor off the music sounded almost the same. Now the sensors write the music:

- **No sensor, no music.** Play needs a source; the music starts once a channel sends.
- **Genome:** a fingerprint of the sensors, through a hash chain, writes each 16-bar section:
  machines, tracks, patterns, lengths, routings, modes, chord rate, swing. A new scene (another
  place, another light or colour, a sensor switched on or off) rewrites it early.
- **Every phrase mutates**, seeded by the fine fingerprint: one digit of difference in a reading
  gives a different phrase, and frozen sensors still never repeat.
- **Elektron-style tracks:** per-track length and speed (polymeter), trig conditions,
  probabilities, micro timing, retrigs, parameter locks and an LFO per track.
- **Modulation matrix:** sensors, dials, LFOs, chaos maps and track hits modulate every track
  param, LFO rates and depths, chaos rates and global tension, brightness, swing and space, with
  feedback loops. Every sensor has at least two strong routes.
- **Styles are palettes** of machines, modes, lengths and limits.
- **Per-track audio:** filter, drive, level, pan, sends, analyser and mute per track; parametric
  drum voices.
- **UI:** a Tracks panel (scope, step grid, live params, mute per track), a Modulation panel with
  live routes, and a genome card.

Tests check that a 2% difference in one sensor changes most bars, that frozen sensors never repeat
a phrase over 128 bars, that there is silence without sensors, determinism, and the harmony rules
for every palette.

## Phase 4: Pico sensor node

The SensorLink protocol (`docs/sensorlink-protocol.md`) and MicroPython firmware for the Pico W /
Pico 2 W: internal temperature, BME280 (temperature, humidity, pressure), BH1750 (light) and ADC
inputs, over Bluetooth LE (Web Bluetooth into the app) and USB serial. Done when Pico sensors
appear in the app and are routed with no code change.

## Phase 5: Raspberry Pi host

A headless Node host that reuses `core` and `audio`, reads the Pico over USB serial and I2C
sensors directly, and starts on boot.

## Later

Recording the music to an audio file and sharing it, arrangement changes (breaks, builds),
borrowed chords, MIDI out, more styles, editing a genome by hand (locking a track you like), playing with the screen off (a foreground service
in the Android app), a mapping editor, several devices playing in sync.

## Known limits of phone browsers

- Chrome on Android hides the ambient light sensor and magnetometer behind a flag and does not
  expose the barometer at all. The Android app reads them natively; in the browser the camera
  stands in for light.
- The microphone hears the phone's own speaker. Echo cancellation and the drum-hit gate reduce
  this; headphones remove it.
- Sensors and audio stop when the screen turns off. The web app holds a screen wake lock while
  playing; the Android app keeps the screen on while open.
