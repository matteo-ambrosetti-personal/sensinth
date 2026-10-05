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
needs a notion of temporary scales first (Phase 3.6 added them, as chord scales).

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

## Phase 3.6: more styles, Free mode, triggered effects (done)

- **Play** sits in the scope's corner, so the trace runs unbroken.
- **Seven new styles:** Hip-hop, Jazz, Blues, Techno / acid, Synthwave, Drum & bass and Minimal
  (Reich-like phasing).
- **Chord-scale harmony:** a chord can bring its own scale (V7 over Mixolydian, ii∅ over Locrian,
  V7♭9 over Phrygian dominant, …), so blues and jazz leave the key while every note still fits
  the chord that plays. Forms (12-bar blues, ii–V–I, turnarounds) are picked by brightness, with
  tritone substitutions under tension. Blue notes: blues and hip-hop leads may bend to ♭3 or ♭5
  on weak steps and resolve by a semitone.
- **New sound abilities:** glide (acid slides, 808s), a per-note filter envelope with accents, a
  pitch envelope, a drawbar organ, tremolo, and ride, crash, cowbell and brush drum voices.
  Rhythm templates: four on the floor, offbeat, backbeat, breakbeats, walking bass, the jazz ride
  figure, Charleston comping, pulses and slides.
- **Free mode:** no style; the sensors pick instruments from every style, any mode, any structure
  and the effects preset, while harmony and the grid hold.
- **Triggered effects:** stutter, tape stop, vinyl brake, riser, filter dive, reverb wash, dub
  throw, bit crush, gate chop and ring mod on the whole mix, fired by sensor events (a shake
  stutters, a clap washes, the lid closing stops the tape), by the song's structure (a riser into
  a new scene, a stutter or brake at a section's end) and by an Elektron-style FX lane.

## Phase 3.7: the Flow page (done)

A third mode next to Play and the Sensor lab draws the whole signal path, live: every sensor's raw
reading beside what processing makes of it, the links from each sensor to the dials, the genome,
the tracks and the effects, the modulators (dials, song values, LFOs, chaos), each track with its
scope, level, pan and sends, and the reverb, delay, effects bus and master. Link width shows a
route's strength, brightness and moving dots what passes now, dashes a route that pulls down.
Hovering or tapping a sensor or track lights its whole path; on a phone the cards stack and the
picked sensor's links run down the side.

## Phase 3.8: every sensor (done, pending a test on real hardware)

- **Android app:** every sensor the phone has (on a Galaxy S23: light, pressure, proximity,
  magnetic field, steps, significant motion, Samsung's own sensors including the hall sensor),
  plus battery temperature, voltage, current and power, charging, thermal headroom, Wi-Fi signal,
  screen brightness and media volume, batched to the page every 50 ms.
- **Mac app** (`apps/mac`, released as _Sensinth for Mac (latest)_): the lid angle, ambient
  light, chip and battery temperatures, power, thermal state, CPU, memory, idle time, network,
  Wi-Fi and Bluetooth, and, with the admin password, the accelerometer and gyroscope.
- **Browser:** the MacBook lid over WebHID, CPU pressure, game controllers, MIDI controllers and
  press force.
- About 25 new sensor kinds with default dials, triggers and effects.

The native readers are built and tested in CI with fake bridges; the real sensors need a try on a
Mac and an S23. Fan speed (it needs the SMC) is not read.

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
MIDI out, editing a genome by hand (locking a track you like), playing with the screen off (a foreground service
in the Android app), a mapping editor, several devices playing in sync.

## Known limits of phone browsers

- Chrome on Android hides the ambient light sensor and magnetometer behind a flag and does not
  expose the barometer at all. The Android app reads them natively; in the browser the camera
  stands in for light.
- The microphone hears the phone's own speaker. Echo cancellation and the drum-hit gate reduce
  this; headphones remove it.
- Sensors and audio stop when the screen turns off. The web app holds a screen wake lock while
  playing; the Android app keeps the screen on while open.
