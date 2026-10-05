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

## Phase 3: musicality and styles (next)

Ambient and Lo-fi styles, sections with arrangement changes (breaks, builds), and recording audio
clips to share.

## Phase 4: Pico sensor node

The SensorLink protocol (`docs/sensorlink-protocol.md`) and MicroPython firmware for the Pico W /
Pico 2 W: internal temperature, BME280 (temperature, humidity, pressure), BH1750 (light) and ADC
inputs, over Bluetooth LE (Web Bluetooth into the app) and USB serial. Done when Pico sensors
appear in the app and are routed with no code change.

## Phase 5: Raspberry Pi host

A headless Node host that reuses `core` and `audio`, reads the Pico over USB serial and I2C
sensors directly, and starts on boot.

## Later

MIDI out, more styles, a native Android wrapper (Capacitor) for the light, barometer and humidity
sensors browsers hide and for playing with the screen off, a mapping editor, several devices
playing in sync.

## Known limits of phone browsers

- Chrome on Android hides the ambient light sensor and magnetometer behind a flag and does not
  expose the barometer at all. The camera stands in for light; the Pico node will supply pressure,
  temperature and humidity.
- The microphone hears the phone's own speaker. Echo cancellation and the drum-hit gate reduce
  this; headphones remove it.
- Sensors and audio stop when the screen turns off. The app holds a screen wake lock while
  playing.
