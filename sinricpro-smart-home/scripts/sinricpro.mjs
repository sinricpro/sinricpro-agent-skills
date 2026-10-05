#!/usr/bin/env node
// SinricPro CLI for AI agent skills. Zero dependencies; requires Node 18+.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API_KEY = process.env.SINRICPRO_API_KEY || '';
const BASE_URL = (process.env.SINRICPRO_BASE_URL || 'https://api.sinric.pro').replace(/\/+$/, '');
const SSE_URL = process.env.SINRICPRO_SSE_URL || 'https://sse.sinric.pro/sse/stream';
const ALLOW_UNLOCK = process.env.SINRICPRO_ALLOW_UNLOCK === '1';
const CACHE_DIR = process.env.SINRICPRO_CACHE_DIR || tmpdir();
const WAIT_OVERRIDE_MS = Number(process.env.SINRICPRO_WAIT_SECONDS) * 1000 || 0;

const CLIENT_ID = 'agent-skill';
const TYPE_PREFIX = 'sinric.devices.types.';
const TYPE_GARAGE_DOOR = `${TYPE_PREFIX}GARAGE_DOOR`;
const TYPE_BLIND = `${TYPE_PREFIX}BLIND`;
// Device reads are limited to 20/min per account, so the list is reused briefly.
const DEVICE_CACHE_TTL_MS = 60_000;
const HTTP_TIMEOUT_MS = 15_000;
const SSE_CONNECT_TIMEOUT_MS = 4_000;
const WAIT_MS = 8_000;
const SLOW_WAIT_MS = 20_000;

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const SECRET_KEYS = new Set(['unlockPin', 'accessKey', 'appsecert', 'appSecret', 'appkey', 'appKey']);
const BLOCKED_ACTIONS = new Set(['getWebRTCAnswer', 'getCameraStreamUrl']);
const STATE_FIELDS = [
  'powerState',
  'brightness',
  'color',
  'colorTemperature',
  'powerLevel',
  'temperature',
  'humidity',
  'targetTemperature',
  'thermostatMode',
  'rangeValue',
  'rangeValues',
  'modeValues',
  'toggleValues',
  'volume',
  'muted',
  'lockState',
  'garageDoorState',
  'contactState',
  'lastMotionState',
  'openPercent',
];
// The scheduler only understands these labels; any other action is stored but never runs.
const SCHEDULE_ACTIONS = {
  'Turn On': { fixed: 'On' },
  'Turn Off': { fixed: 'Off' },
  'Set Temperature': {},
  'Set Brightness': { max: 100 },
  'Set Blinds': { max: 100 },
  'Set Fan Speed': {},
  'Set PowerLevel': { max: 100 },
};

const USAGE = `Usage: sinricpro.mjs <command> [args]

Devices
  devices [--room <name>] [--type <type>] [--name <text>] [--refresh]
  device <deviceId>
  control <deviceId> <action> '<json value>' [--instance <id>] [--no-wait] [--force]
  homes
  rooms

Scenes
  scenes
  scene <sceneId>
  scene-run <sceneId>
  scene-create '<json>'
  scene-update <sceneId> '<json>'
  scene-delete <sceneId> --yes

Schedules
  schedules
  schedule <scheduleId>
  schedule-create '<json>'
  schedule-update <scheduleId> '<json>'
  schedule-enable <scheduleId>
  schedule-disable <scheduleId>
  schedule-delete <scheduleId> --yes

Automations
  automations

Environment
  SINRICPRO_API_KEY        required
  SINRICPRO_ALLOW_UNLOCK   set to 1 to permit unlocking locks and opening garage doors
`;

class CliError extends Error {
  constructor(message, { exit = 1, status, hint } = {}) {
    super(message);
    this.exit = exit;
    this.status = status;
    this.hint = hint;
  }
}

const usageError = (message, hint) => new CliError(message, { exit: 2, hint });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const shortType = (code) => (code || 'unknown').replace(TYPE_PREFIX, '');
const redact = (text) => (API_KEY ? String(text).split(API_KEY).join('***') : String(text));

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (!SECRET_KEYS.has(key)) out[key] = sanitize(item);
    }
    return out;
  }
  return value;
}

function parseArgs(argv) {
  const valueFlags = new Set(['room', 'type', 'name', 'instance']);
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
    } else if (valueFlags.has(arg.slice(2))) {
      if (argv[i + 1] === undefined) throw usageError(`${arg} needs a value`);
      flags[arg.slice(2)] = argv[++i];
    } else {
      flags[arg.slice(2)] = true;
    }
  }
  return { positional, flags };
}

function requireId(value, label) {
  if (!value || !OBJECT_ID.test(value)) throw usageError(`${label} must be a 24-character hex id`, `Got: ${value ?? '(missing)'}`);
  return value;
}

function parseJsonObject(text, label) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw usageError(`${label} is not valid JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw usageError(`${label} must be a JSON object`);
  return parsed;
}

async function api(method, path, body) {
  const attempts = method === 'GET' ? 3 : 1;
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(300 * 2 ** (attempt - 1));

    let res;
    try {
      res = await fetch(`${BASE_URL}/api/v1${path}`, {
        method,
        headers: { 'X-SINRIC-API-KEY': API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch (err) {
      const reason = err.name === 'TimeoutError' ? 'request timed out' : err.cause?.code || err.cause?.message || err.message;
      lastError = new CliError(`Network error: ${reason}`, {
        hint: 'Check the internet connection and try again.',
      });
      continue;
    }

    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // handled below
    }

    if (res.status >= 500) {
      lastError = new CliError(json?.message || `Server error (HTTP ${res.status})`, { status: res.status });
      continue;
    }
    if (res.status === 401) {
      throw new CliError('API key was rejected', {
        status: 401,
        hint: 'Check SINRICPRO_API_KEY. Create a key at https://portal.sinric.pro/credential/new/apikey',
      });
    }
    if (res.status === 403) throw new CliError(json?.message || 'Account is locked', { status: 403 });
    if (res.status === 429) {
      throw new CliError(json?.message || 'Rate limit exceeded', {
        status: 429,
        hint: `Wait ${json?.resetTime ?? 60} seconds before the next request. Do not retry sooner.`,
      });
    }
    // Some update routes report validation errors with HTTP 200 and success:false.
    if (!res.ok || !json || json.success === false) {
      throw new CliError(json?.message || `Unexpected response (HTTP ${res.status})`, { status: res.status });
    }
    return json;
  }

  throw lastError;
}

function cacheFile() {
  const hash = createHash('sha256').update(`${BASE_URL}|${API_KEY}`).digest('hex').slice(0, 16);
  return join(CACHE_DIR, `sinricpro-skill-${hash}.json`);
}

function invalidateDeviceCache() {
  rmSync(cacheFile(), { force: true });
}

async function getDevices({ refresh = false } = {}) {
  if (!refresh) {
    try {
      const cached = JSON.parse(readFileSync(cacheFile(), 'utf8'));
      if (Date.now() - cached.at < DEVICE_CACHE_TTL_MS) return { devices: cached.devices, fromCache: true };
    } catch {
      // missing or unreadable cache
    }
  }
  const { devices = [] } = await api('GET', '/devices');
  const clean = sanitize(devices);
  try {
    writeFileSync(cacheFile(), JSON.stringify({ at: Date.now(), devices: clean }), { mode: 0o600 });
  } catch {
    // cache is an optimisation only
  }
  return { devices: clean, fromCache: false };
}

async function findDevice(deviceId) {
  let { devices, fromCache } = await getDevices();
  let device = devices.find((d) => d.id === deviceId);
  if (!device && fromCache) {
    ({ devices } = await getDevices({ refresh: true }));
    device = devices.find((d) => d.id === deviceId);
  }
  if (!device) throw new CliError(`No device with id ${deviceId} in this account`, { hint: 'Run the devices command to list valid ids.' });
  return device;
}

function summarizeDevice(device) {
  const state = {};
  for (const field of STATE_FIELDS) {
    if (device[field] !== undefined && device[field] !== null) state[field] = device[field];
  }
  return {
    id: device.id,
    name: device.name,
    type: shortType(device.product?.code),
    room: device.room?.name ?? null,
    home: device.room?.home?.name ?? null,
    isOnline: Boolean(device.isOnline),
    ...(device.deactivated ? { deactivated: true } : {}),
    actions: device.product?.actions ?? [],
    state,
  };
}

// Fails closed: on a lock anything but "lock", and on a garage door any mode but "Close", needs the opt-in.
function assertSafe(productCode, action, value, where) {
  if (ALLOW_UNLOCK) return;
  const lower = (v) => String(v ?? '').toLowerCase();
  const unlocking = action === 'setLockState' && lower(value?.state) !== 'lock';
  const opening = productCode === TYPE_GARAGE_DOOR && action === 'setMode' && lower(value?.mode) !== 'close';
  if (unlocking || opening) {
    throw usageError(`Refused: ${where} would ${unlocking ? 'unlock a lock' : 'open a garage door'}`, 'This is disabled by default. The user must set SINRICPRO_ALLOW_UNLOCK=1 themselves to permit it. Do not set it for them.');
  }
}

function assertActionSupported(device, action, force) {
  const actions = device.product?.actions ?? [];
  if (force || actions.length === 0 || actions.includes(action)) return;
  throw usageError(`"${device.name}" (${shortType(device.product?.code)}) does not support action "${action}"`, `Supported actions: ${actions.join(', ')}`);
}

async function openSse() {
  const controller = new AbortController();
  const connectTimer = setTimeout(() => controller.abort(), SSE_CONNECT_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(SSE_URL, {
      headers: { 'X-SINRIC-API-KEY': API_KEY, Accept: 'text/event-stream', 'Cache-Control': 'no-cache' },
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(connectTimer);
  }
  if (!res.ok || !res.body) {
    controller.abort();
    return null;
  }

  const replies = new Map();
  const waiters = new Map();
  let ended = false;

  const handleLine = (line) => {
    if (!line.startsWith('data:')) return;
    let data;
    try {
      data = JSON.parse(line.slice(5));
    } catch {
      return;
    }
    const payload = data?.event === 'deviceMessageArrived' ? data.message?.payload : null;
    if (!payload?.replyToken) return;
    replies.set(payload.replyToken, payload);
    waiters.get(payload.replyToken)?.(payload);
  };

  (async () => {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop();
        lines.forEach(handleLine);
      }
    } catch {
      // aborted or dropped
    }
    ended = true;
    for (const resolve of waiters.values()) resolve(null);
  })();

  return {
    wait(messageId, timeoutMs) {
      if (replies.has(messageId)) return Promise.resolve(replies.get(messageId));
      if (ended) return Promise.resolve(null);
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), timeoutMs);
        waiters.set(messageId, (payload) => {
          clearTimeout(timer);
          resolve(payload);
        });
      });
    },
    close() {
      controller.abort();
    },
  };
}

function replyWaitMs(device, action) {
  if (WAIT_OVERRIDE_MS) return WAIT_OVERRIDE_MS;
  const code = device.product?.code;
  const slow = action === 'setLockState' || (code === TYPE_GARAGE_DOOR && action === 'setMode') || (code === TYPE_BLIND && action === 'setRangeValue');
  return slow ? SLOW_WAIT_MS : WAIT_MS;
}

async function cmdDevices({ flags }) {
  const { devices, fromCache } = await getDevices({ refresh: Boolean(flags.refresh) });
  const has = (text, needle) => String(text ?? '').toLowerCase().includes(String(needle).toLowerCase());
  const filtered = devices.filter(
    (d) =>
      (!flags.name || has(d.name, flags.name)) &&
      (!flags.type || has(shortType(d.product?.code), flags.type)) &&
      (!flags.room || d.room?.id === flags.room || has(d.room?.name, flags.room))
  );
  return { success: true, fromCache, count: filtered.length, devices: filtered.map(summarizeDevice) };
}

async function cmdDevice({ positional }) {
  const id = requireId(positional[0], 'deviceId');
  const { device } = await api('GET', `/devices/${id}`);
  return { success: true, device: sanitize(device) };
}

async function cmdControl({ positional, flags }) {
  const id = requireId(positional[0], 'deviceId');
  const action = positional[1];
  if (!action) throw usageError('control needs an action, e.g. setPowerState');
  const value = parseJsonObject(positional[2] ?? '{}', 'value');
  if (BLOCKED_ACTIONS.has(action)) throw usageError(`Action "${action}" is not available through this skill`, 'Use the SinricPro app for camera streaming.');

  const device = await findDevice(id);
  if (device.deactivated) throw new CliError(`"${device.name}" is deactivated (no active license)`, { hint: 'The user must renew the device license in the SinricPro portal.' });
  assertActionSupported(device, action, flags.force);
  assertSafe(device.product?.code, action, value, 'this command');

  const messageId = randomUUID();
  const body = { type: 'request', action, value, clientId: CLIENT_ID, messageId, createdAt: Math.floor(Date.now() / 1000) };
  if (flags.instance) body.instanceId = flags.instance;

  const sse = flags['no-wait'] ? null : await openSse();
  try {
    await api('POST', `/devices/${id}/action`, body);
    invalidateDeviceCache();

    const result = { success: true, deviceId: id, deviceName: device.name, action, value, messageId, confirmed: false };
    const reply = sse ? await sse.wait(messageId, replyWaitMs(device, action)) : null;
    if (!reply) {
      result.note = device.isOnline ? 'Command was queued but the device did not confirm in time.' : 'Command was queued but the device appears to be offline.';
      return result;
    }
    if (reply.success === false) throw new CliError(`"${device.name}" rejected the action: ${reply.message || 'no reason given'}`);
    return { ...result, confirmed: true, deviceValue: reply.value ?? null };
  } finally {
    sse?.close();
  }
}

async function cmdHomes() {
  const { homes = [] } = await api('GET', '/homes?includeRooms=true');
  return { success: true, homes: sanitize(homes) };
}

async function cmdRooms() {
  const { rooms = [] } = await api('GET', '/rooms?includeRoomDevices=false');
  return { success: true, rooms: sanitize(rooms) };
}

// The API returns a scene's actionValue as an object or as its JSON text, depending on the route.
function actionValueOf(item) {
  if (typeof item.actionValue !== 'string') return item.actionValue;
  try {
    return JSON.parse(item.actionValue);
  } catch {
    return item.actionValue;
  }
}

function summarizeScene(scene) {
  return {
    id: scene.id,
    name: scene.name,
    description: scene.description ?? null,
    deviceActions: (scene.deviceActions ?? []).map((item) => ({
      device: item.device?.id ?? item.device ?? null,
      deviceName: item.device?.name ?? null,
      type: item.device?.product ? shortType(item.device.product.code) : null,
      action: item.action,
      actionValue: actionValueOf(item),
    })),
  };
}

// The list endpoint populates each action's device, which the single-scene endpoint does not.
async function loadScene(sceneId) {
  const { scenes = [] } = await api('GET', '/scenes');
  const scene = scenes.find((s) => s.id === sceneId);
  if (!scene) throw new CliError(`No scene with id ${sceneId}`, { hint: 'Run the scenes command to list valid ids.' });
  return scene;
}

async function cmdScenes() {
  const { scenes = [] } = await api('GET', '/scenes');
  return { success: true, count: scenes.length, scenes: scenes.map(summarizeScene) };
}

async function cmdScene({ positional }) {
  return { success: true, scene: summarizeScene(await loadScene(requireId(positional[0], 'sceneId'))) };
}

async function cmdSceneRun({ positional }) {
  const scene = await loadScene(requireId(positional[0], 'sceneId'));
  for (const item of scene.deviceActions ?? []) {
    assertSafe(item.device?.product?.code, item.action, actionValueOf(item), `scene "${scene.name}"`);
  }
  await api('POST', `/scenes/test/${scene.id}`);
  invalidateDeviceCache();
  return {
    success: true,
    scene: scene.name,
    actionsQueued: (scene.deviceActions ?? []).length,
    note: 'Scene actions were queued. Per-device results are not reported; check device state to verify.',
  };
}

async function buildSceneBody(input, force) {
  const { name, description, deviceActions } = input;
  if (typeof name !== 'string' || name.length < 3 || name.length > 50) throw usageError('Scene name must be 3-50 characters');
  if (!Array.isArray(deviceActions) || deviceActions.length === 0) throw usageError('deviceActions must be a non-empty array');

  const { devices } = await getDevices();
  const body = { name, deviceActions: [] };
  if (description) body.description = String(description);

  deviceActions.forEach((item, index) => {
    const label = `deviceActions[${index}]`;
    requireId(item?.device, `${label}.device`);
    if (typeof item.action !== 'string' || !item.action) throw usageError(`${label}.action is required`);
    if (!item.actionValue || typeof item.actionValue !== 'object' || Array.isArray(item.actionValue)) {
      throw usageError(`${label}.actionValue must be a JSON object, e.g. {"state":"On"}`);
    }
    const device = devices.find((d) => d.id === item.device);
    if (!device) throw usageError(`${label}.device ${item.device} is not a device in this account`);
    assertActionSupported(device, item.action, force);
    assertSafe(device.product?.code, item.action, item.actionValue, `scene "${name}"`);
    body.deviceActions.push({ device: item.device, action: item.action, actionValue: item.actionValue });
  });
  return body;
}

async function cmdSceneCreate({ positional, flags }) {
  const body = await buildSceneBody(parseJsonObject(positional[0] ?? '', 'scene'), flags.force);
  const { scene } = await api('POST', '/scenes', body);
  return { success: true, scene: summarizeScene(scene) };
}

async function cmdSceneUpdate({ positional, flags }) {
  const id = requireId(positional[0], 'sceneId');
  const body = await buildSceneBody(parseJsonObject(positional[1] ?? '', 'scene'), flags.force);
  await api('PUT', '/scenes', { id, ...body });
  return { success: true, sceneId: id };
}

function requireYes(flags, what) {
  if (!flags.yes) throw usageError(`Deleting a ${what} needs --yes`, 'Confirm with the user first, then repeat the command with --yes.');
}

async function cmdSceneDelete({ positional, flags }) {
  const id = requireId(positional[0], 'sceneId');
  requireYes(flags, 'scene');
  await api('DELETE', `/scenes/${id}`);
  return { success: true, deleted: id };
}

function summarizeSchedule(schedule) {
  return {
    id: schedule.id,
    name: schedule.name,
    description: schedule.description ?? null,
    enable: schedule.enable,
    device: schedule.device?.id ?? schedule.device ?? null,
    deviceName: schedule.device?.name ?? null,
    action: schedule.action,
    actionValue: schedule.actionValue ?? null,
    weekdays: schedule.weekdays,
    hour: schedule.hour,
    minute: schedule.minute,
  };
}

function buildScheduleBody(input) {
  const { name, description, deviceId, action, weekdays, hour, minute } = input;
  if (typeof name !== 'string' || name.length < 3 || name.length > 50) throw usageError('Schedule name must be 3-50 characters');
  requireId(deviceId, 'deviceId');

  const spec = SCHEDULE_ACTIONS[action];
  if (!spec) throw usageError(`Unknown schedule action "${action}"`, `Use one of: ${Object.keys(SCHEDULE_ACTIONS).join(', ')}`);

  let actionValue = spec.fixed;
  if (!spec.fixed) {
    const number = Number(input.actionValue);
    if (input.actionValue === undefined || input.actionValue === '' || Number.isNaN(number)) throw usageError(`"${action}" needs a numeric actionValue`);
    if (spec.max !== undefined && (number < 0 || number > spec.max)) throw usageError(`"${action}" actionValue must be 0-${spec.max}`);
    actionValue = String(number);
  }

  const days = Array.isArray(weekdays) ? weekdays.map((d) => String(d).toLowerCase()) : [];
  if (days.length === 0 || days.some((d) => !WEEKDAYS.includes(d))) throw usageError('weekdays must be a non-empty array of day names', `Valid: ${WEEKDAYS.join(', ')}`);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw usageError('hour must be an integer 0-23');
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) throw usageError('minute must be an integer 0-59');
  if (input.enable !== undefined && typeof input.enable !== 'boolean') throw usageError('enable must be true or false');

  const body = {
    name,
    enable: input.enable ?? true,
    scheduleType: 'time',
    deviceId,
    action,
    actionValue,
    weekdays: WEEKDAYS.filter((d) => days.includes(d)),
    hour,
    minute,
  };
  if (description) body.description = String(description);
  return body;
}

async function loadSchedule(scheduleId) {
  const { schedule } = await api('GET', `/schedules/${scheduleId}`);
  return schedule;
}

// The update route replaces the whole schedule, so changes are merged over the stored one.
async function updateSchedule(scheduleId, changes) {
  const current = await loadSchedule(scheduleId);
  const merged = {
    name: current.name,
    description: current.description,
    enable: current.enable,
    deviceId: String(current.device?.id ?? current.device),
    action: current.action,
    actionValue: current.actionValue,
    weekdays: current.weekdays,
    hour: current.hour,
    minute: current.minute,
    ...changes,
  };
  const body = buildScheduleBody(merged);
  await api('PUT', '/schedules', { id: scheduleId, ...body });
  return { success: true, schedule: { id: scheduleId, ...body } };
}

async function cmdSchedules() {
  const { schedules = [] } = await api('GET', '/schedules');
  return { success: true, count: schedules.length, note: 'Times are in the account time zone.', schedules: schedules.map(summarizeSchedule) };
}

async function cmdSchedule({ positional }) {
  return { success: true, schedule: summarizeSchedule(await loadSchedule(requireId(positional[0], 'scheduleId'))) };
}

async function cmdScheduleCreate({ positional }) {
  const body = buildScheduleBody(parseJsonObject(positional[0] ?? '', 'schedule'));
  await findDevice(body.deviceId);
  const { schedule, next3Occurences } = await api('POST', '/schedules', body);
  return { success: true, schedule: summarizeSchedule(schedule), nextRuns: next3Occurences ?? [] };
}

async function cmdScheduleUpdate({ positional }) {
  const id = requireId(positional[0], 'scheduleId');
  return updateSchedule(id, parseJsonObject(positional[1] ?? '', 'schedule'));
}

async function cmdScheduleDelete({ positional, flags }) {
  const id = requireId(positional[0], 'scheduleId');
  requireYes(flags, 'schedule');
  await api('DELETE', `/schedules/${id}`);
  return { success: true, deleted: id };
}

async function cmdAutomations() {
  const { automations = [] } = await api('GET', '/automations');
  return { success: true, count: automations.length, automations: sanitize(automations) };
}

const COMMANDS = {
  devices: cmdDevices,
  device: cmdDevice,
  control: cmdControl,
  homes: cmdHomes,
  rooms: cmdRooms,
  scenes: cmdScenes,
  scene: cmdScene,
  'scene-run': cmdSceneRun,
  'scene-create': cmdSceneCreate,
  'scene-update': cmdSceneUpdate,
  'scene-delete': cmdSceneDelete,
  schedules: cmdSchedules,
  schedule: cmdSchedule,
  'schedule-create': cmdScheduleCreate,
  'schedule-update': cmdScheduleUpdate,
  'schedule-enable': ({ positional }) => updateSchedule(requireId(positional[0], 'scheduleId'), { enable: true }),
  'schedule-disable': ({ positional }) => updateSchedule(requireId(positional[0], 'scheduleId'), { enable: false }),
  'schedule-delete': cmdScheduleDelete,
  automations: cmdAutomations,
};

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help') {
    process.stdout.write(USAGE);
    return;
  }

  try {
    const handler = COMMANDS[command];
    if (!handler) throw usageError(`Unknown command "${command}"`, 'Run with --help to list commands.');
    if (!API_KEY) throw usageError('SINRICPRO_API_KEY is not set', 'Create a key at https://portal.sinric.pro/credential/new/apikey and set it in the environment.');
    const result = await handler(parseArgs(rest));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (err) {
    const lines = [`Error: ${err.message}`, `Command: ${command}`];
    if (err.status) lines.push(`HttpStatus: ${err.status}`);
    if (err.hint) lines.push(`Hint: ${err.hint}`);
    process.stderr.write(`${redact(lines.join('\n'))}\n`);
    process.exitCode = err instanceof CliError ? err.exit : 1;
  }
}

main();
