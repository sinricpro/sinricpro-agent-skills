# Scenes

A scene is a named list of device actions that run together.

## Read and run

- `scenes` lists every scene with its device actions (device id, name, type, action, value).
- `scene <sceneId>` returns one.
- `scene-run <sceneId>` queues all the scene's actions. The result does not report per-device success; check `devices --refresh` if the user wants confirmation.

## Create

```
scene-create '{"name":"Movie night","description":"Dim and quiet","deviceActions":[
  {"device":"5f0000000000000000000001","action":"setBrightness","actionValue":{"brightness":20}},
  {"device":"5f0000000000000000000004","action":"setPowerState","actionValue":{"state":"Off"}}
]}'
```

| Field | Rules |
|---|---|
| `name` | 3-50 characters, unique in the account |
| `description` | optional |
| `deviceActions` | at least one item |
| `deviceActions[].device` | a device id from `devices` |
| `deviceActions[].action` | a device action the device supports |
| `deviceActions[].actionValue` | the same JSON object `control` takes; see [actions.md](actions.md) |

## Update

`scene-update <sceneId> '<json>'` takes the same JSON and replaces the whole scene. To change one action, start from the `scene <sceneId>` output, edit it, and send all of it back.

## Delete

`scene-delete <sceneId> --yes`. Confirm with the user first.

## Restrictions

A scene that unlocks a lock or opens a garage door cannot be created, updated or run unless the user has set `SINRICPRO_ALLOW_UNLOCK=1`.
