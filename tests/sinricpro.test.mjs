import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'sinricpro-smart-home', 'scripts', 'sinricpro.mjs');
const API_KEY = 'test-key-1234';

const SWITCH = '5f0000000000000000000001';
const LOCK = '5f0000000000000000000002';
const GARAGE = '5f0000000000000000000003';
const SCENE = '5f00000000000000000000a1';
const SCHEDULE = '5f00000000000000000000b1';

const DEVICES = [
  {
    id: SWITCH,
    name: 'Desk Lamp',
    isOnline: true,
    powerState: 'Off',
    unlockPin: 4321,
    accessKey: { appkey: 'app-key' },
    room: { id: '5f00000000000000000000c1', name: 'Office', home: { name: 'Home' } },
    product: { code: 'sinric.devices.types.SWITCH', actions: ['setPowerState'] },
  },
  {
    id: LOCK,
    name: 'Front Door',
    isOnline: true,
    lockState: 'LOCKED',
    unlockPin: 9999,
    room: { id: '5f00000000000000000000c2', name: 'Hall', home: { name: 'Home' } },
    product: { code: 'sinric.devices.types.SMARTLOCK', actions: ['setLockState'] },
  },
  {
    id: GARAGE,
    name: 'Garage',
    isOnline: true,
    garageDoorState: 'Close',
    product: { code: 'sinric.devices.types.GARAGE_DOOR', actions: ['setMode'] },
  },
];

const sceneWith = (device, action, actionValue) => ({
  id: SCENE,
  name: 'Leaving',
  deviceActions: [{ device: DEVICES.find((d) => d.id === device), action, actionValue }],
});

const STORED_SCHEDULE = {
  id: SCHEDULE,
  name: 'Morning lamp',
  enable: true,
  scheduleType: 'time',
  device: SWITCH,
  action: 'Turn On',
  actionValue: 'On',
  weekdays: ['monday', 'friday'],
  hour: 7,
  minute: 30,
  cronExp: '30 7 * * 1,5',
  bullId: 'x',
};

async function startMock(options = {}) {
  const requests = [];
  const sseClients = new Set();
  let devicesFailures = options.devicesFailures ?? 0;

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      const path = req.url.split('?')[0];
      const send = (status, json) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(json));
      };

      if (path === '/sse/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: {"event":"heartbeat"}\n\n');
        sseClients.add(res);
        res.on('close', () => sseClients.delete(res));
        return;
      }

      requests.push({ method: req.method, path, body, apiKey: req.headers['x-sinric-api-key'] });
      if (req.headers['x-sinric-api-key'] !== API_KEY) return send(401, { success: false });

      const route = `${req.method} ${path}`;
      if (options.override?.[route]) return send(...options.override[route]);

      if (route === 'GET /api/v1/devices') {
        if (devicesFailures > 0) {
          devicesFailures -= 1;
          return send(500, { success: false, message: 'boom' });
        }
        return send(200, { success: true, devices: DEVICES });
      }
      if (req.method === 'POST' && /^\/api\/v1\/devices\/[0-9a-f]{24}\/action$/.test(path)) {
        send(200, { success: true, message: 'OK. Your message has been queued for processing.' });
        if (options.reply !== false) {
          const payload = { replyToken: body.messageId, success: options.replySuccess ?? true, message: 'OK', type: 'response', value: body.value };
          const event = { event: 'deviceMessageArrived', message: { deviceId: path.split('/')[4], payload } };
          for (const client of sseClients) client.write(`data: ${JSON.stringify(event)}\n\n`);
        }
        return undefined;
      }
      if (route === 'GET /api/v1/scenes') return send(200, { success: true, scenes: options.scenes ?? [] });
      if (route === 'POST /api/v1/scenes') return send(200, { success: true, scene: { id: SCENE, ...body } });
      if (route === 'POST /api/v1/schedules') {
        const { deviceId, ...rest } = body;
        return send(200, { success: true, schedule: { id: SCHEDULE, device: deviceId, ...rest }, next3Occurences: ['next'] });
      }
      if (route === `GET /api/v1/schedules/${SCHEDULE}`) return send(200, { success: true, schedule: STORED_SCHEDULE });
      return send(200, { success: true });
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    requests,
    of: (method, pathPart) => requests.filter((r) => r.method === method && r.path.includes(pathPart)),
    close: () => {
      for (const client of sseClients) client.destroy();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

function run(mock, args, env = {}) {
  const cacheDir = env.SINRICPRO_CACHE_DIR ?? mkdtempSync(join(tmpdir(), 'sinricpro-test-'));
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--no-warnings', CLI, ...args],
      {
        env: {
          ...process.env,
          SINRICPRO_API_KEY: API_KEY,
          SINRICPRO_BASE_URL: mock.url,
          SINRICPRO_SSE_URL: `${mock.url}/sse/stream`,
          SINRICPRO_ALLOW_UNLOCK: '',
          ...env,
          SINRICPRO_CACHE_DIR: cacheDir,
        },
      },
      (error, stdout, stderr) => {
        let json = null;
        try {
          json = JSON.parse(stdout);
        } catch {
          // not every run prints JSON
        }
        resolve({ code: error ? error.code : 0, stdout, stderr, json });
      }
    );
  });
}

async function withMock(options, fn) {
  const mock = await startMock(options);
  try {
    await fn(mock);
  } finally {
    await mock.close();
  }
}

test('devices sends the API key header and strips secrets', () =>
  withMock({}, async (mock) => {
    const result = await run(mock, ['devices']);
    assert.equal(result.code, 0);
    assert.equal(mock.requests[0].apiKey, API_KEY);
    assert.equal(result.json.count, 3);
    assert.deepEqual(result.json.devices[0], {
      id: SWITCH,
      name: 'Desk Lamp',
      type: 'SWITCH',
      room: 'Office',
      home: 'Home',
      isOnline: true,
      actions: ['setPowerState'],
      state: { powerState: 'Off' },
    });
    assert.ok(!result.stdout.includes('unlockPin') && !result.stdout.includes('app-key'));
  }));

test('devices filters by room and type', () =>
  withMock({}, async (mock) => {
    const byRoom = await run(mock, ['devices', '--room', 'hall']);
    assert.deepEqual(byRoom.json.devices.map((d) => d.id), [LOCK]);
    const byType = await run(mock, ['devices', '--type', 'garage']);
    assert.deepEqual(byType.json.devices.map((d) => d.id), [GARAGE]);
  }));

test('device list is cached and --refresh bypasses the cache', () =>
  withMock({}, async (mock) => {
    const env = { SINRICPRO_CACHE_DIR: mkdtempSync(join(tmpdir(), 'sinricpro-test-')) };
    await run(mock, ['devices'], env);
    const second = await run(mock, ['devices'], env);
    assert.equal(second.json.fromCache, true);
    assert.equal(mock.of('GET', '/devices').length, 1);
    await run(mock, ['devices', '--refresh'], env);
    assert.equal(mock.of('GET', '/devices').length, 2);
  }));

test('device <id> strips secrets from the full object', () =>
  withMock({ override: { [`GET /api/v1/devices/${LOCK}`]: [200, { success: true, device: DEVICES[1] }] } }, async (mock) => {
    const result = await run(mock, ['device', LOCK]);
    assert.equal(result.json.device.lockState, 'LOCKED');
    assert.ok(!result.stdout.includes('unlockPin'));
  }));

test('control posts the action body and confirms over SSE', () =>
  withMock({}, async (mock) => {
    const result = await run(mock, ['control', SWITCH, 'setPowerState', '{"state":"On"}']);
    assert.equal(result.code, 0, result.stderr);
    const [post] = mock.of('POST', '/action');
    assert.equal(post.path, `/api/v1/devices/${SWITCH}/action`);
    assert.equal(post.body.type, 'request');
    assert.equal(post.body.action, 'setPowerState');
    assert.deepEqual(post.body.value, { state: 'On' });
    assert.equal(post.body.clientId, 'agent-skill');
    assert.match(post.body.messageId, /^[0-9a-f-]{36}$/);
    assert.ok(Math.abs(post.body.createdAt - Date.now() / 1000) < 60);
    assert.equal(result.json.confirmed, true);
    assert.deepEqual(result.json.deviceValue, { state: 'On' });
  }));

test('control passes --instance as instanceId', () =>
  withMock({}, async (mock) => {
    await run(mock, ['control', SWITCH, 'setPowerState', '{"state":"On"}', '--instance', 'toggle1', '--no-wait']);
    assert.equal(mock.of('POST', '/action')[0].body.instanceId, 'toggle1');
  }));

test('control reports confirmed:false when the device does not reply', () =>
  withMock({ reply: false }, async (mock) => {
    const result = await run(mock, ['control', SWITCH, 'setPowerState', '{"state":"On"}'], { SINRICPRO_WAIT_SECONDS: '0.3' });
    assert.equal(result.code, 0);
    assert.equal(result.json.confirmed, false);
    assert.match(result.json.note, /did not confirm/);
  }));

test('control fails when the device rejects the action', () =>
  withMock({ replySuccess: false }, async (mock) => {
    const result = await run(mock, ['control', SWITCH, 'setPowerState', '{"state":"On"}']);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /rejected the action/);
  }));

test('control rejects an action the device does not support', () =>
  withMock({}, async (mock) => {
    const result = await run(mock, ['control', SWITCH, 'setBrightness', '{"brightness":50}']);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /Supported actions: setPowerState/);
    assert.equal(mock.of('POST', '/action').length, 0);
  }));

test('unlock is refused by default, lock is allowed', () =>
  withMock({}, async (mock) => {
    const unlock = await run(mock, ['control', LOCK, 'setLockState', '{"state":"unlock"}']);
    assert.equal(unlock.code, 2);
    assert.match(unlock.stderr, /Refused/);
    assert.equal(mock.of('POST', '/action').length, 0);

    const lock = await run(mock, ['control', LOCK, 'setLockState', '{"state":"lock"}', '--no-wait']);
    assert.equal(lock.code, 0, lock.stderr);
    assert.equal(mock.of('POST', '/action').length, 1);
  }));

test('unlock is allowed with SINRICPRO_ALLOW_UNLOCK=1', () =>
  withMock({}, async (mock) => {
    const result = await run(mock, ['control', LOCK, 'setLockState', '{"state":"unlock"}', '--no-wait'], { SINRICPRO_ALLOW_UNLOCK: '1' });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(mock.of('POST', '/action').length, 1);
  }));

test('garage door open is refused, close is allowed', () =>
  withMock({}, async (mock) => {
    const open = await run(mock, ['control', GARAGE, 'setMode', '{"mode":"Open"}']);
    assert.equal(open.code, 2);
    const close = await run(mock, ['control', GARAGE, 'setMode', '{"mode":"Close"}', '--no-wait']);
    assert.equal(close.code, 0, close.stderr);
    assert.equal(mock.of('POST', '/action').length, 1);
  }));

test('camera streaming actions are blocked', () =>
  withMock({}, async (mock) => {
    const result = await run(mock, ['control', SWITCH, 'getWebRTCAnswer', '{}']);
    assert.equal(result.code, 2);
    assert.equal(mock.requests.length, 0);
  }));

test('scene-run refuses a scene that unlocks', () =>
  withMock({ scenes: [sceneWith(LOCK, 'setLockState', { state: 'unlock' })] }, async (mock) => {
    const result = await run(mock, ['scene-run', SCENE]);
    assert.equal(result.code, 2);
    assert.equal(mock.of('POST', '/scenes/test').length, 0);
  }));

test('scene-run executes a safe scene', () =>
  withMock({ scenes: [sceneWith(SWITCH, 'setPowerState', { state: 'Off' })] }, async (mock) => {
    const result = await run(mock, ['scene-run', SCENE]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(mock.of('POST', `/scenes/test/${SCENE}`).length, 1);
    assert.equal(result.json.actionsQueued, 1);
  }));

test('scene-run handles an actionValue returned as JSON text', () =>
  withMock({ scenes: [sceneWith(LOCK, 'setLockState', '{"state":"lock"}')] }, async (mock) => {
    const result = await run(mock, ['scene-run', SCENE]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(mock.of('POST', `/scenes/test/${SCENE}`).length, 1);
  }));

test('scene-create validates and posts the scene', () =>
  withMock({}, async (mock) => {
    const scene = { name: 'Movie', deviceActions: [{ device: SWITCH, action: 'setPowerState', actionValue: { state: 'Off' } }] };
    const result = await run(mock, ['scene-create', JSON.stringify(scene)]);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(mock.of('POST', '/scenes')[0].body, scene);
  }));

test('scene-create refuses a garage-open action', () =>
  withMock({}, async (mock) => {
    const scene = { name: 'Arrive', deviceActions: [{ device: GARAGE, action: 'setMode', actionValue: { mode: 'Open' } }] };
    const result = await run(mock, ['scene-create', JSON.stringify(scene)]);
    assert.equal(result.code, 2);
    assert.equal(mock.of('POST', '/scenes').length, 0);
  }));

test('scene-update sends the id in the body', () =>
  withMock({}, async (mock) => {
    const scene = { name: 'Movie', deviceActions: [{ device: SWITCH, action: 'setPowerState', actionValue: { state: 'On' } }] };
    const result = await run(mock, ['scene-update', SCENE, JSON.stringify(scene)]);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(mock.of('PUT', '/scenes')[0].body, { id: SCENE, ...scene });
  }));

test('an update answered with HTTP 200 and success:false is an error', () =>
  withMock({ override: { 'PUT /api/v1/scenes': [200, { success: false, message: 'Scene name exists' }] } }, async (mock) => {
    const scene = { name: 'Movie', deviceActions: [{ device: SWITCH, action: 'setPowerState', actionValue: { state: 'On' } }] };
    const result = await run(mock, ['scene-update', SCENE, JSON.stringify(scene)]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Scene name exists/);
  }));

test('deletes need --yes', () =>
  withMock({}, async (mock) => {
    const refused = await run(mock, ['scene-delete', SCENE]);
    assert.equal(refused.code, 2);
    assert.equal(mock.of('DELETE', '/scenes').length, 0);

    await run(mock, ['scene-delete', SCENE, '--yes']);
    await run(mock, ['schedule-delete', SCHEDULE, '--yes']);
    assert.equal(mock.of('DELETE', `/scenes/${SCENE}`).length, 1);
    assert.equal(mock.of('DELETE', `/schedules/${SCHEDULE}`).length, 1);
  }));

test('schedule-create builds the body the scheduler expects', () =>
  withMock({}, async (mock) => {
    const input = { name: 'Dim at night', deviceId: SWITCH, action: 'Set Brightness', actionValue: 20, weekdays: ['Sunday', 'monday'], hour: 22, minute: 0 };
    const result = await run(mock, ['schedule-create', JSON.stringify(input)]);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(mock.of('POST', '/schedules')[0].body, {
      name: 'Dim at night',
      enable: true,
      scheduleType: 'time',
      deviceId: SWITCH,
      action: 'Set Brightness',
      actionValue: '20',
      weekdays: ['monday', 'sunday'],
      hour: 22,
      minute: 0,
    });
  }));

test('schedule-create rejects device action names', () =>
  withMock({}, async (mock) => {
    const input = { name: 'Bad', deviceId: SWITCH, action: 'setPowerState', weekdays: ['monday'], hour: 7, minute: 0 };
    const result = await run(mock, ['schedule-create', JSON.stringify(input)]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /Turn On/);
    assert.equal(mock.of('POST', '/schedules').length, 0);
  }));

test('schedule-disable resends the whole schedule with enable:false', () =>
  withMock({}, async (mock) => {
    const result = await run(mock, ['schedule-disable', SCHEDULE]);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(mock.of('PUT', '/schedules')[0].body, {
      id: SCHEDULE,
      name: 'Morning lamp',
      enable: false,
      scheduleType: 'time',
      deviceId: SWITCH,
      action: 'Turn On',
      actionValue: 'On',
      weekdays: ['monday', 'friday'],
      hour: 7,
      minute: 30,
    });
  }));

test('schedule-update merges changes over the stored schedule', () =>
  withMock({}, async (mock) => {
    await run(mock, ['schedule-update', SCHEDULE, '{"hour":8,"action":"Turn Off"}']);
    const { body } = mock.of('PUT', '/schedules')[0];
    assert.equal(body.hour, 8);
    assert.equal(body.minute, 30);
    assert.equal(body.action, 'Turn Off');
    assert.equal(body.actionValue, 'Off');
  }));

test('GET is retried on server errors', () =>
  withMock({ devicesFailures: 2 }, async (mock) => {
    const result = await run(mock, ['devices']);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(mock.of('GET', '/devices').length, 3);
  }));

test('POST is never retried', () =>
  withMock({ override: { [`POST /api/v1/devices/${SWITCH}/action`]: [500, { success: false, message: 'boom' }] } }, async (mock) => {
    const result = await run(mock, ['control', SWITCH, 'setPowerState', '{"state":"On"}', '--no-wait']);
    assert.equal(result.code, 1);
    assert.equal(mock.of('POST', '/action').length, 1);
  }));

test('429 is reported with the wait time and not retried', () =>
  withMock({ override: { 'GET /api/v1/devices': [429, { success: false, message: 'Too many requests', resetTime: 42 }] } }, async (mock) => {
    const result = await run(mock, ['devices']);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /HttpStatus: 429/);
    assert.match(result.stderr, /Wait 42 seconds/);
    assert.equal(mock.of('GET', '/devices').length, 1);
  }));

test('a wrong API key gives a clear error', () =>
  withMock({}, async (mock) => {
    const result = await run(mock, ['devices'], { SINRICPRO_API_KEY: 'wrong' });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /API key was rejected/);
  }));

test('the API key is redacted from error output', () =>
  withMock({ override: { 'GET /api/v1/automations': [422, { success: false, message: `bad key ${API_KEY}` }] } }, async (mock) => {
    const result = await run(mock, ['automations']);
    assert.equal(result.code, 1);
    assert.ok(!result.stderr.includes(API_KEY));
    assert.match(result.stderr, /bad key \*\*\*/);
  }));

test('a missing API key is a usage error', () =>
  withMock({}, async (mock) => {
    const result = await run(mock, ['devices'], { SINRICPRO_API_KEY: '' });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /SINRICPRO_API_KEY is not set/);
  }));
