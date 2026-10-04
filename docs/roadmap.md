# Roadmap

| Phase                                 | Deliverable                                                                                                                                                    | Done when                                                                                                      | Status                           |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **0. Scaffold**                       | pnpm workspace, strict TypeScript, Vite, Vitest, ESLint, Prettier, CI, GitHub Pages deploy, docs                                                               | CI is green and the Pages URL opens on the phone                                                               | Done (Pages needs enabling once) |
| **1. First sound, simulated sensors** | `core` (signal, mapping, theory, composer, engine), `audio` renderer, Chiptune style, simulated sensors, minimal UI                                            | Pleasant, in-key chiptune plays on desktop and phone from fake signals                                         | Done                             |
| **2. Phone sensors**                  | Browser adapters for motion, orientation, gyroscope, microphone, camera, GPS, battery and time of day; permission flow; sensor session recorder and replayer   | Shaking the phone raises the energy; covering the camera darkens the sound; a recorded walk replays on desktop | Next                             |
| **3. Musicality and styles**          | Ambient and Lo-fi styles, sections with arrangement changes, record and share audio clips                                                                      | Three distinct, listenable styles; a 10-minute session stays coherent                                          | Planned                          |
| **4. Pico sensor node**               | SensorLink protocol, MicroPython firmware (internal temperature, BME280, BH1750, ADC inputs) over Bluetooth LE and USB serial                                  | Pico sensors appear in the app and are routed with no code change                                              | Planned                          |
| **5. Raspberry Pi host**              | Headless Node host reusing `core` and `audio`, Pico over USB serial, I2C sensors, autostart                                                                    | The Pi boots straight into music from attached sensors                                                         | Planned                          |
| Later                                 | MIDI out, more styles, native Android wrapper (Capacitor) for the light, barometer and humidity sensors browsers hide, mapping editor, several devices in sync |                                                                                                                | Ideas                            |

## Phase 2 notes

Chrome on Android exposes, without flags: accelerometer, linear acceleration, gravity, gyroscope
and orientation (Generic Sensor API, with `devicemotion` / `deviceorientation` as fallback),
microphone, camera and geolocation. The ambient light sensor and magnetometer sit behind the
_Generic Sensor Extra Classes_ flag; the barometer is not exposed at all. Camera brightness stands
in for light, and the Pico node supplies pressure, temperature and humidity.

The microphone hears the phone's own speaker. Mitigations: request echo cancellation, ignore mic
onsets that coincide with the engine's own hits, and suggest headphones.
