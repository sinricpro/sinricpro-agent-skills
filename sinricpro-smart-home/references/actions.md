# Actions

`control <deviceId> <action> '<value>'` sends one action. A device accepts only the actions in its `actions` list (from `devices`); the CLI rejects anything else.

## Value payloads

| Action | Value | Notes |
|---|---|---|
| `setPowerState` | `{"state":"On"}` | `On` or `Off`, capitalised |
| `setBrightness` | `{"brightness":50}` | 0-100 |
| `adjustBrightness` | `{"brightnessDelta":-25}` | relative |
| `setPowerLevel` | `{"powerLevel":50}` | 0-100, dimmable switch |
| `adjustPowerLevel` | `{"powerLevelDelta":-25}` | relative |
| `setColor` | `{"color":{"r":255,"g":0,"b":0}}` | each 0-255 |
| `setColorTemperature` | `{"colorTemperature":2700}` | Kelvin; lower is warmer (2700 warm white, 6500 daylight) |
| `increaseColorTemperature` / `decreaseColorTemperature` | `{}` | one step |
| `targetTemperature` | `{"temperature":22}` | in the device's unit |
| `adjustTargetTemperature` | `{"temperature":1}` | relative |
| `setThermostatMode` | `{"thermostatMode":"COOL"}` | `COOL`, `HEAT`, `AUTO`, `OFF`, `ECO` |
| `setRangeValue` | `{"rangeValue":3}` | fan speed (1 to max), blinds 0-100 |
| `adjustRangeValue` | `{"rangeValueDelta":-1}` | relative |
| `setMode` | `{"mode":"MOVIE"}` | garage door: `Open` or `Close` |
| `setLockState` | `{"state":"lock"}` | `lock` or `unlock` |
| `setVolume` | `{"volume":25}` | 0-100 |
| `adjustVolume` | `{"volume":-10}` | relative |
| `setMute` | `{"mute":true}` | |
| `mediaControl` | `{"control":"Pause"}` | `Play`, `Pause`, `Stop`, `StartOver`, `Previous`, `Next`, `Rewind`, `FastForward` |
| `selectInput` | `{"input":"HDMI1"}` | |
| `changeChannel` | `{"channel":{"name":"HBO"}}` | |
| `skipChannels` | `{"channelCount":1}` | negative goes back |
| `setBands` | `{"bands":[{"name":"BASS","value":-2}]}` | `BASS`, `MIDRANGE`, `TREBLE` |
| `setPercentage` | `{"percentage":10}` | |
| `setToggleState` | `{"state":"On"}` | needs `--instance` |

## By device type

| Type | Usual actions |
|---|---|
| `SWITCH` | `setPowerState` |
| `LIGHT` | `setPowerState`, brightness, colour, colour temperature |
| `DIMMABLE_SWITCH` | `setPowerState`, `setPowerLevel`, `adjustPowerLevel` |
| `THERMOSTAT` | `setPowerState`, `targetTemperature`, `setThermostatMode` |
| `AC_UNIT` | thermostat actions, `setRangeValue` (fan speed) |
| `FAN` | `setPowerState`, `setRangeValue` |
| `BLIND` | `setPowerState`, `setRangeValue` (0 closed, 100 open) |
| `TV` | power, volume, mute, `mediaControl`, `selectInput`, channels |
| `SPEAKER` | power, volume, mute, `mediaControl`, `setBands`, `setMode` |
| `SMARTLOCK` | `setLockState` |
| `GARAGE_DOOR` | `setMode` |
| Sensors, `DOORBELL` | `setPowerState` only; their readings are in `state` |

The device's own `actions` list is authoritative; this table is a guide.

## Restricted actions

- `setLockState` with `unlock`, and `setMode` with `Open` on a garage door, are refused unless the user has set `SINRICPRO_ALLOW_UNLOCK=1`.
- `getWebRTCAnswer` and `getCameraStreamUrl` are always refused.

## Custom devices and `--instance`

A custom device can have several range, mode or toggle capabilities. Each has an instance id, which must be passed with `--instance`:

```
control <deviceId> setRangeValue '{"rangeValue":41}' --instance rangeInstance1
control <deviceId> setMode '{"mode":"cool"}' --instance modeInstance1
```

Find the instance ids in `device <deviceId>` under `product.deviceTemplate.capabilities`.

## Timing

`control` waits for the device to confirm: up to 8 seconds, or 20 seconds for locks, garage doors and blinds. `--no-wait` returns as soon as the command is queued.
