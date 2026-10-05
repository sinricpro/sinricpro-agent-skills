# SinricPro Agent Skills

Control your [SinricPro](https://sinric.pro) smart home from an AI agent. This repository holds one skill, `sinricpro-smart-home`, for [OpenClaw](https://openclaw.ai), Claude Code and other agents that load `SKILL.md` skills.

## What it can do

| Area | Examples |
|---|---|
| Devices | "Turn on the living room light", "Set the bedroom AC to 24 degrees", "Dim the desk lamp a bit", "Is the garage door closed?" |
| Rooms and homes | "What devices are in the kitchen?", "Which devices are offline?" |
| Scenes | "Run the movie night scene", "Create a scene that turns off all the lights" |
| Schedules | "Turn the porch light on at 6:30 pm on weekdays", "Disable the morning schedule" |
| Automations | "What automations do I have?" (read-only) |

Not supported: camera live view and snapshots, adding or removing devices, editing automations, and account settings. Use the SinricPro app or portal for those.

## Requirements

- Node.js 18 or newer. No packages to install.
- A SinricPro account and an API key.

## Setup

### 1. Create an API key

Open [portal.sinric.pro/credential/new/apikey](https://portal.sinric.pro/credential/new/apikey), create a key, and copy it.

The key gives full access to your account. Treat it like a password, and delete it in the portal if it leaks.

### 2. Install the skill

Clone the repository and copy the `sinricpro-smart-home` folder into your agent's skills directory.

```
git clone https://github.com/sinricpro/sinricpro-agent-skills.git
```

| Agent | Skills directory |
|---|---|
| OpenClaw | `~/.openclaw/skills/` or `<workspace>/skills/` |
| Claude Code | `~/.claude/skills/` or `<project>/.claude/skills/` |

### 3. Provide the API key

Set `SINRICPRO_API_KEY` in the environment your agent runs in. In OpenClaw, enter it in the skill's configuration.

## Locks and garage doors

Locking a door and closing a garage door work out of the box. Unlocking and opening are refused by default, including inside scenes, because an AI agent can misread a request.

To allow them, set `SINRICPRO_ALLOW_UNLOCK=1` in the agent's environment. The agent is instructed to ask you before each unlock or open, but the setting itself is the only hard control, so enable it only if you accept that risk.

## Using the CLI directly

The skill is a thin layer over one script, which you can run yourself:

```
export SINRICPRO_API_KEY=your-key
node sinricpro-smart-home/scripts/sinricpro.mjs devices
node sinricpro-smart-home/scripts/sinricpro.mjs control <deviceId> setPowerState '{"state":"On"}'
node sinricpro-smart-home/scripts/sinricpro.mjs scenes
node sinricpro-smart-home/scripts/sinricpro.mjs --help
```

Output is JSON on stdout. `control` waits for the device to confirm and reports `confirmed: true` or `false`.

| Variable | Purpose |
|---|---|
| `SINRICPRO_API_KEY` | Required. Your API key. |
| `SINRICPRO_ALLOW_UNLOCK` | Set to `1` to permit unlocking locks and opening garage doors. |
| `SINRICPRO_BASE_URL`, `SINRICPRO_SSE_URL` | Override the API and event-stream endpoints. |
| `SINRICPRO_WAIT_SECONDS` | Override how long `control` waits for confirmation. |

## What is sent where

The script talks only to `api.sinric.pro` and `sse.sinric.pro`. It sends your API key, device ids, and the actions, scenes and schedules you ask for. It keeps a copy of your device list, without PINs or credentials, in the system temp directory for 60 seconds to stay within the API rate limit.

## Development

```
node --test tests/sinricpro.test.mjs
```

The tests run the CLI against a local mock of the API and event stream; they need no account.

```
sinricpro-smart-home/
  SKILL.md               instructions the agent reads
  scripts/sinricpro.mjs  the CLI
  references/            per-topic detail the agent loads on demand
tests/
```

## License

MIT
