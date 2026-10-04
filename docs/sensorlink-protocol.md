# SensorLink protocol (draft v0)

SensorLink is how external sensor nodes (a Raspberry Pi Pico, an ESP32, another phone) stream
readings to a Sensinth engine. It is deliberately small, so a microcontroller can speak it in a
few dozen lines of MicroPython or C. Implementation is planned for Phase 4; this draft fixes the
shape so the engine side can be built against it.

## Model

A node announces itself once with a **hello** listing its channels, then sends **data** frames.
Each channel is one scalar value and maps 1:1 to a `SensorDescriptor` in `@sensinth/core`
(channel ids are prefixed with the node id on arrival, e.g. `pico-01.temperature`).

Use the shared `kind` vocabulary (`packages/core/src/sensors/kinds.ts`) where it fits, so the
default mapping applies. Any other kind still works: the engine routes it by timescale.

## Hello

```json
{
  "t": "hello",
  "v": 0,
  "node": "pico-01",
  "name": "Balcony Pico",
  "ch": [
    { "id": "temperature", "kind": "temperature", "unit": "°C", "rate": 1, "min_span": 1 },
    { "id": "humidity", "kind": "humidity", "unit": "%", "range": [0, 100], "rate": 1 },
    { "id": "pressure", "kind": "pressure", "unit": "hPa", "rate": 1, "min_span": 2 },
    { "id": "light", "kind": "light", "unit": "lx", "rate": 5 },
    { "id": "pot", "kind": "knob", "range": [0, 65535], "rate": 20, "timescale": "medium" }
  ]
}
```

| Field       | Required | Meaning                                               |
| ----------- | -------- | ----------------------------------------------------- |
| `id`        | yes      | Channel id, unique within the node                    |
| `kind`      | yes      | Semantic kind                                         |
| `unit`      | no       | Display unit                                          |
| `range`     | no       | Known physical range; used as-is for normalization    |
| `rate`      | no       | Nominal samples per second                            |
| `min_span`  | no       | Smallest raw span treated as full scale (noise floor) |
| `timescale` | no       | `fast`, `medium` or `slow`, to override the inference |
| `circular`  | no       | `true` if the value wraps around `range` (angles)     |

A node re-sends hello when its channels change, and whenever it receives `{"t":"who"}`.

## Data over USB serial / Wi-Fi: JSON lines

One frame per line. `ts` is the node's clock in milliseconds; the engine stamps arrival time
itself, so `ts` is only used to order frames and detect gaps.

```json
{"t":"d","ts":123456,"temperature":22.4,"humidity":51.0}
{"t":"d","ts":124456,"light":312}
```

A frame may carry any subset of channels.

## Data over Bluetooth LE

Custom GATT service (UUIDs to be fixed in Phase 4):

| Characteristic | Properties   | Content                             |
| -------------- | ------------ | ----------------------------------- |
| `hello`        | read, notify | The hello JSON (UTF-8)              |
| `data`         | notify       | Binary frames, below                |
| `control`      | write        | JSON commands such as `{"t":"who"}` |

Binary data frame, little-endian, packed into one notification (fits the default 20-byte MTU for
three readings; larger MTUs allow more):

```
u16 ts_ms_low   then repeated:   u8 channel_index   f32 value
```

`channel_index` is the position of the channel in the hello's `ch` array.

## Liveness

A channel with no sample for 5 seconds is marked stale and stops influencing the music; its dial
falls back to the default. Nodes should send each channel at least once a second, even when the
value has not changed.
