# Schedules

A schedule runs one action on one device at a set time on chosen weekdays. Times are in the account's time zone.

## Actions

Schedules use these labels, not device action names. Anything else is rejected.

| `action` | `actionValue` | Does |
|---|---|---|
| `Turn On` | none | power on |
| `Turn Off` | none | power off |
| `Set Brightness` | 0-100 | light brightness |
| `Set PowerLevel` | 0-100 | dimmable switch level |
| `Set Blinds` | 0-100 | blind position |
| `Set Fan Speed` | number | fan speed |
| `Set Temperature` | number | thermostat target |

Schedules cannot lock, unlock, or open anything. For other actions, schedule a `Turn On` / `Turn Off` or suggest an automation in the SinricPro app.

## Create

```
schedule-create '{"name":"Porch light on","deviceId":"5f0000000000000000000001","action":"Turn On","weekdays":["monday","tuesday","wednesday","thursday","friday"],"hour":18,"minute":30}'
```

| Field | Rules |
|---|---|
| `name` | 3-50 characters, unique in the account |
| `description` | optional |
| `deviceId` | a device id from `devices` |
| `action`, `actionValue` | from the table above |
| `weekdays` | one or more of `monday` ... `sunday` |
| `hour` | 0-23 |
| `minute` | 0-59 |
| `enable` | optional, default `true` |

The result includes `nextRuns`, the next three run times. Read the first one back to the user as a check.

An account can hold a limited number of schedules (14 on the standard plan); the API returns an error when the limit is reached.

## Change

`schedule-update <scheduleId> '<json>'` takes only the fields to change:

```
schedule-update 5f00000000000000000000b1 '{"hour":19,"minute":0}'
```

`schedule-enable <scheduleId>` and `schedule-disable <scheduleId>` switch a schedule on or off without changing it.

## Delete

`schedule-delete <scheduleId> --yes`. Confirm with the user first.
