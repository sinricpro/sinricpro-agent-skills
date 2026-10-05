# Devices

## `devices`

Returns a compact summary per device:

```json
{
  "success": true,
  "fromCache": false,
  "count": 1,
  "devices": [
    {
      "id": "5f0000000000000000000001",
      "name": "Desk Lamp",
      "type": "LIGHT",
      "room": "Office",
      "home": "Home",
      "isOnline": true,
      "actions": ["setPowerState", "setBrightness", "setColor"],
      "state": { "powerState": "On", "brightness": 80 }
    }
  ]
}
```

- `type` is the device type without the `sinric.devices.types.` prefix.
- `actions` is what `control` will accept for this device.
- `deactivated: true` appears when the device has no active license; it cannot be controlled.
- `fromCache: true` means the list is up to 60 seconds old. `--refresh` fetches it again.

Filters match case-insensitively on part of the text: `--name lamp`, `--type light`, `--room office`.

## State fields

Only the fields a device has are present.

| Field | Meaning |
|---|---|
| `powerState` | `On` / `Off` |
| `brightness`, `powerLevel` | 0-100 |
| `color` | `{r,g,b}` |
| `colorTemperature` | Kelvin |
| `temperature`, `humidity` | latest sensor reading |
| `targetTemperature`, `thermostatMode` | thermostat setpoint and mode |
| `rangeValue` | fan speed or blind position |
| `rangeValues`, `modeValues`, `toggleValues` | per-instance values on custom devices |
| `volume`, `muted` | speaker / TV |
| `lockState` | `LOCKED` / `UNLOCKED` |
| `garageDoorState` | `Open` / `Close` |
| `contactState` | `open` / `closed` |
| `lastMotionState` | `detected` / `notDetected` |

State is what the device last reported. An offline device shows its last known state.

## `device <deviceId>`

Returns the full device object, always live. Use it for details the summary leaves out, such as custom-device capabilities and instance ids. It counts against the rate limit, so prefer `devices` for normal lookups.

PINs and credentials are removed from all output.

## Homes and rooms

`homes` lists homes with their rooms. `rooms` lists rooms. Use them when the user asks what rooms exist; for "what is in the kitchen", `devices --room kitchen` is enough.
