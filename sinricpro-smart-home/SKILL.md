---
name: sinricpro-smart-home
description: Control SinricPro smart home devices via natural language. Use when the user asks to turn devices on or off, dim or colour lights, set thermostat temperature or mode, move blinds, change fan speed, control TV or speaker volume, lock a door, close a garage door, check whether a device is online or what state it is in, list devices, rooms or homes, run, create, edit or delete scenes, create, edit, enable, disable or delete schedules, or list automations. Requires SINRICPRO_API_KEY.
homepage: https://github.com/sinricpro/sinricpro-agent-skills
metadata: { "openclaw": { "emoji": "🏠", "homepage": "https://github.com/sinricpro/sinricpro-agent-skills", "requires": { "env": ["SINRICPRO_API_KEY"], "bins": ["node"] }, "primaryEnv": "SINRICPRO_API_KEY" } }
---

# SinricPro Smart Home

Control the user's SinricPro devices through one bundled CLI. It needs Node 18+ and no packages.

```
node {baseDir}/scripts/sinricpro.mjs <command> [args]
```

Every command prints JSON on stdout. Errors go to stderr as `Error:` / `Command:` / `HttpStatus:` / `Hint:` lines, with exit code `2` for a bad command or a refused action and `1` for an API or network failure. Always use this CLI; do not call the SinricPro API directly.

## Commands

| Task | Command |
|---|---|
| List devices with state | `devices [--room <name>] [--type <type>] [--name <text>] [--refresh]` |
| Full detail of one device | `device <deviceId>` |
| Send an action | `control <deviceId> <action> '<json value>' [--instance <id>] [--no-wait]` |
| List homes / rooms | `homes`, `rooms` |
| List scenes / one scene | `scenes`, `scene <sceneId>` |
| Run a scene | `scene-run <sceneId>` |
| Create / replace a scene | `scene-create '<json>'`, `scene-update <sceneId> '<json>'` |
| Delete a scene | `scene-delete <sceneId> --yes` |
| List schedules / one schedule | `schedules`, `schedule <scheduleId>` |
| Create / change a schedule | `schedule-create '<json>'`, `schedule-update <scheduleId> '<json>'` |
| Turn a schedule on or off | `schedule-enable <scheduleId>`, `schedule-disable <scheduleId>` |
| Delete a schedule | `schedule-delete <scheduleId> --yes` |
| List automations (read-only) | `automations` |

Reference files, read only when needed:

| Topic | File |
|---|---|
| Action names and value payloads | [references/actions.md](references/actions.md) |
| Device fields, state, instance ids | [references/devices.md](references/devices.md) |
| Scene JSON | [references/scenes.md](references/scenes.md) |
| Schedule JSON and allowed actions | [references/schedules.md](references/schedules.md) |
| Automations | [references/automations.md](references/automations.md) |
| Errors and rate limits | [references/errors.md](references/errors.md) |

## Workflows

### 1. Find the device

1. Run `devices` (add `--room`, `--type` or `--name` to narrow it).
2. Match the user's words against `name`, `room` and `type`.
3. If several devices match, list the candidates with their rooms and ask which one. Never guess.
4. If none match, say so and show the closest names.

The list is cached for 60 seconds (`fromCache: true`). Use `--refresh` only when the user asks for the current state right now; device reads are rate limited.

### 2. Control a device

1. Find the device (workflow 1).
2. If `isOnline` is false, tell the user the device is offline and stop.
3. Pick an action from the device's `actions` list and build the value from [references/actions.md](references/actions.md).
4. Run `control <deviceId> <action> '<json>'`.
5. Report from the result:
   - `confirmed: true`: the device applied it; `deviceValue` is the state it reported.
   - `confirmed: false`: say the command was sent but the device has not confirmed. Do not claim it worked, and do not resend automatically.

Examples:

```
node {baseDir}/scripts/sinricpro.mjs control 5f0000000000000000000001 setPowerState '{"state":"On"}'
node {baseDir}/scripts/sinricpro.mjs control 5f0000000000000000000001 setBrightness '{"brightness":40}'
node {baseDir}/scripts/sinricpro.mjs control 5f0000000000000000000001 targetTemperature '{"temperature":22}'
```

### 3. Relative changes

For "a bit brighter", "turn it down", "warmer", use the `adjust*` action with a delta instead of reading the state first: `adjustBrightness` (`brightnessDelta`), `adjustPowerLevel` (`powerLevelDelta`), `adjustVolume`, `adjustRangeValue` (`rangeValueDelta`), `adjustTargetTemperature`. "A bit" is about 10-20% of the range, or 1 degree for temperature. If the device does not list the adjust action, read the current value from `devices` and send the absolute action.

### 4. Several devices at once

Run `control` once per device, one after another. If the user has a scene that already does it, prefer `scene-run`. Report which devices confirmed and which did not.

### 5. Scenes

- Run: find the scene with `scenes`, then `scene-run <sceneId>`. The result only says the actions were queued; say that, not that every device changed.
- Create or change: build the JSON from [references/scenes.md](references/scenes.md), read the planned device actions back to the user, and run the command only after they agree. `scene-update` replaces the whole scene, so start from the existing `scene <sceneId>` output.

### 6. Schedules

- Schedules use their own action labels (`Turn On`, `Set Brightness`, ...), not device action names. See [references/schedules.md](references/schedules.md).
- Times are in the account's time zone. Confirm the time, weekdays, device and action with the user before creating or changing a schedule.
- `schedule-update` takes only the fields that change.

## Safety rules

- **Unlocking and opening.** Locking a lock and closing a garage door always work. Unlocking a lock or opening a garage door is refused by the CLI unless the user has set `SINRICPRO_ALLOW_UNLOCK=1`. The same applies to scenes that contain such an action. If a command is refused, tell the user it is disabled by default and that they can enable it themselves. Never set that variable yourself and never look for another route.
- **When unlocking is enabled**, still ask the user to confirm each unlock or open request before running it.
- **Deletes.** Ask the user to confirm before deleting a scene or schedule, then pass `--yes`.
- **The API key** is a full-account credential. Never print it, log it, or include it in a command line.
- **Do not retry** a `control` or `scene-run` that failed or was not confirmed unless the user asks; a second send can toggle or repeat the action.

## Not supported

Tell the user to use the SinricPro app or portal for these:

- Camera live view, streaming and snapshots
- Adding, removing or renaming devices, rooms and homes
- Creating or editing automations
- Device credentials, account settings, subscriptions
- Device history and activity logs

## Data sent

The CLI talks only to `https://api.sinric.pro` and `https://sse.sinric.pro`. It sends the API key, device ids, and the actions, scenes and schedules you ask for. It caches the device list (without PINs or credentials) in the OS temp directory for 60 seconds.
