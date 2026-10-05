# Errors and rate limits

## Output contract

Success prints JSON on stdout with exit code `0`. Failure prints to stderr:

```
Error: <what went wrong>
Command: <command>
HttpStatus: <status, when the API answered>
Hint: <what to do>
```

| Exit code | Meaning | What to do |
|---|---|---|
| `2` | Bad arguments, unsupported action, or a refused action | Fix the command. Do not retry it unchanged. |
| `1` | API or network failure, or the device rejected the action | See the table below. |

## Common errors

| Error | Cause | Tell the user |
|---|---|---|
| `SINRICPRO_API_KEY is not set` | No key configured | Create a key at https://portal.sinric.pro/credential/new/apikey and add it to the skill's configuration. |
| `API key was rejected` (401) | Key is wrong or was deleted | The API key is not valid; create a new one. |
| `Account is locked` (403) | Account problem | Sign in at portal.sinric.pro to check the account. |
| Rate limit (429) | Too many device reads | Wait the number of seconds in the hint. Do not retry sooner. |
| `No device with id ...` | Wrong id, or the device was removed | Run `devices` again and pick a valid id. |
| `... is deactivated` | The device has no active license | Renew the device license in the portal. |
| `does not support action` | Action is not in the device's `actions` | Use an action from the list in the hint. |
| `Refused: ... would unlock / open` | Unlock and open are disabled | It is disabled by default; the user can enable it with `SINRICPRO_ALLOW_UNLOCK=1`. |
| `rejected the action` | The device answered with a failure | The device refused the command; give its message. |
| `Network error` | No connection or timeout | Check the connection and try again later. |
| Scene or schedule name already exists | Names are unique | Pick another name. |

## `confirmed: false`

`control` exits `0` with `confirmed: false` when the command was queued but the device did not answer in time. The device may be offline, slow, or on weak Wi-Fi. Say the command was sent and not confirmed. Do not send it again unless the user asks.

## Rate limits

- Device reads (`devices --refresh`, `device`) are limited to 20 per minute per account. Staying at the limit for 5 minutes puts the account in a slow mode of 2 per minute for 30 minutes.
- The CLI caches the device list for 60 seconds to stay well under this. Avoid `--refresh` and `device` in loops.
- `control`, scenes and schedules are not covered by this limit, but send actions one at a time.

## Retries

The CLI retries read requests on server errors by itself. It never retries a command that changes something, and neither should you.
