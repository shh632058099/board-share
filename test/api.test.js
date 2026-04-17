import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/server.js';
import { LocalStore } from '../src/store/localStore.js';

async function startTestServer() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'share-board-'));
  const config = loadConfig(
    {
      NODE_ENV: 'test',
      DEV_AUTH: 'true',
      ALLOW_TIME_OVERRIDE: 'true',
      DATA_FILE: path.join(tmpDir, 'state.json'),
    },
    process.cwd(),
  );
  const store = new LocalStore(config.dataFile);
  const notifier = { sendReturnRequest: async () => 'sent' };
  const server = createApp({ config, store, notifier });
  await new Promise((resolve) => server.listen(0, resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return { baseUrl, server, tmpDir };
}

async function request(baseUrl, pathName, { method = 'GET', user, body, now } = {}) {
  const activeUser = user || { id: 'ou_admin', name: 'Admin' };
  const response = await fetch(`${baseUrl}${pathName}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      'x-user-id': activeUser.id,
      'x-user-name': activeUser.name,
      ...(now ? { 'x-now': now } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

test('enforces admin board management and reservation conflict rules', async (t) => {
  const { baseUrl, server, tmpDir } = await startTestServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const normalCreate = await request(baseUrl, '/api/boards', {
    method: 'POST',
    user: { id: 'ou_user_1', name: 'User 1' },
    body: { boardNo: 'B-001', type: 'EVB' },
  });
  assert.equal(normalCreate.status, 403);

  const created = await request(baseUrl, '/api/boards', {
    method: 'POST',
    body: {
      boardNo: 'B-001',
      type: 'EVB',
      version: 'v1',
      systemVersion: '2026.04',
      subcards: [{ name: 'sensor', model: 'S1', remark: 'demo' }],
    },
  });
  assert.equal(created.status, 201);
  const boardId = created.payload.board.id;

  const reserved = await request(baseUrl, '/api/reservations', {
    method: 'POST',
    user: { id: 'ou_user_1', name: 'User 1' },
    now: '2026-04-16T10:00:00+08:00',
    body: { boardId, durationHours: 2, purpose: 'bring-up' },
  });
  assert.equal(reserved.status, 201);
  assert.equal(reserved.payload.reservation.boardId, boardId);

  const duplicated = await request(baseUrl, '/api/reservations', {
    method: 'POST',
    user: { id: 'ou_user_2', name: 'User 2' },
    now: '2026-04-16T10:10:00+08:00',
    body: { boardId, durationHours: 1 },
  });
  assert.equal(duplicated.status, 409);

  const boards = await request(baseUrl, '/api/boards', {
    user: { id: 'ou_user_2', name: 'User 2' },
    now: '2026-04-16T10:30:00+08:00',
  });
  assert.equal(boards.status, 200);
  assert.equal(boards.payload.boards[0].status, 'in_use');
});

test('allows return requests only after overdue and restores board after return', async (t) => {
  const { baseUrl, server, tmpDir } = await startTestServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const created = await request(baseUrl, '/api/boards', {
    method: 'POST',
    body: { boardNo: 'B-002', type: 'EVB' },
  });
  const boardId = created.payload.board.id;

  const reserved = await request(baseUrl, '/api/reservations', {
    method: 'POST',
    user: { id: 'ou_user_1', name: 'User 1' },
    now: '2026-04-16T20:30:00+08:00',
    body: { boardId, durationHours: 1 },
  });
  const reservationId = reserved.payload.reservation.id;
  assert.match(reserved.payload.reservation.plannedEndAt, /^2026-04-17T01:30:00.000Z$/);

  const earlyRequest = await request(baseUrl, `/api/reservations/${reservationId}/request-return`, {
    method: 'POST',
    user: { id: 'ou_user_2', name: 'User 2' },
    now: '2026-04-17T09:20:00+08:00',
    body: {},
  });
  assert.equal(earlyRequest.status, 409);

  const overdueRequest = await request(baseUrl, `/api/reservations/${reservationId}/request-return`, {
    method: 'POST',
    user: { id: 'ou_user_2', name: 'User 2' },
    now: '2026-04-17T09:31:00+08:00',
    body: {},
  });
  assert.equal(overdueRequest.status, 201);
  assert.equal(overdueRequest.payload.returnRequest.notificationStatus, 'sent');

  const returned = await request(baseUrl, `/api/reservations/${reservationId}/return`, {
    method: 'POST',
    user: { id: 'ou_user_1', name: 'User 1' },
    now: '2026-04-17T09:40:00+08:00',
    body: {},
  });
  assert.equal(returned.status, 200);
  assert.equal(returned.payload.reservation.status, 'returned');

  const boards = await request(baseUrl, '/api/boards', {
    user: { id: 'ou_user_2', name: 'User 2' },
    now: '2026-04-17T09:41:00+08:00',
  });
  assert.equal(boards.payload.boards[0].status, 'available');
});



test('supports future reservations, overlap checks, and board timeline', async (t) => {
  const { baseUrl, server, tmpDir } = await startTestServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const created = await request(baseUrl, '/api/boards', {
    method: 'POST',
    body: { boardNo: 'B-003', type: 'EVB' },
  });
  assert.equal(created.status, 201);
  const boardId = created.payload.board.id;

  const future = await request(baseUrl, '/api/reservations', {
    method: 'POST',
    user: { id: 'ou_user_1', name: 'User 1' },
    now: '2026-04-16T10:00:00+08:00',
    body: {
      boardId,
      startAt: '2026-04-16T13:00',
      durationHours: 2,
      purpose: 'reserved slot',
    },
  });
  assert.equal(future.status, 201);
  assert.equal(future.payload.reservation.status, 'reserved');

  const boardsBeforeStart = await request(baseUrl, '/api/boards', {
    user: { id: 'ou_user_2', name: 'User 2' },
    now: '2026-04-16T10:30:00+08:00',
  });
  assert.equal(boardsBeforeStart.payload.boards[0].status, 'available');
  assert.equal(boardsBeforeStart.payload.boards[0].nextReservation.id, future.payload.reservation.id);

  const overlap = await request(baseUrl, '/api/reservations', {
    method: 'POST',
    user: { id: 'ou_user_2', name: 'User 2' },
    now: '2026-04-16T10:40:00+08:00',
    body: {
      boardId,
      startAt: '2026-04-16T14:00:00+08:00',
      durationHours: 1,
    },
  });
  assert.equal(overlap.status, 409);

  const adjacent = await request(baseUrl, '/api/reservations', {
    method: 'POST',
    user: { id: 'ou_user_2', name: 'User 2' },
    now: '2026-04-16T10:45:00+08:00',
    body: {
      boardId,
      startAt: '2026-04-16T15:00:00+08:00',
      durationHours: 1,
    },
  });
  assert.equal(adjacent.status, 201);

  const timeline = await request(
    baseUrl,
    '/api/timeline?from=2026-04-16T12%3A00%3A00.000%2B08%3A00&to=2026-04-16T17%3A00%3A00.000%2B08%3A00',
    {
      user: { id: 'ou_user_2', name: 'User 2' },
      now: '2026-04-16T10:50:00+08:00',
    },
  );
  assert.equal(timeline.status, 200);
  assert.equal(timeline.payload.boards[0].reservations.length, 2);
  assert.deepEqual(
    timeline.payload.boards[0].reservations.map((reservation) => reservation.status),
    ['reserved', 'reserved'],
  );

  const boardsDuring = await request(baseUrl, '/api/boards', {
    user: { id: 'ou_user_2', name: 'User 2' },
    now: '2026-04-16T13:30:00+08:00',
  });
  assert.equal(boardsDuring.payload.boards[0].status, 'in_use');
  assert.equal(boardsDuring.payload.boards[0].currentUserName, 'User 1');
});

test('creates a Feishu login session and authenticates API calls by cookie', async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'share-board-'));
  const config = loadConfig(
    {
      NODE_ENV: 'test',
      DEV_AUTH: 'false',
      SESSION_COOKIE_SECURE: 'false',
      FEISHU_APP_ID: 'cli_test',
      FEISHU_APP_SECRET: 'secret_test',
      DATA_FILE: path.join(tmpDir, 'state.json'),
    },
    process.cwd(),
  );
  const store = new LocalStore(config.dataFile);
  const feishuClient = {
    enabled: true,
    getUserByAuthCode: async (code) => {
      assert.equal(code, 'login-code');
      return {
        id: 'ou_user_session',
        name: 'Session User',
        openId: 'ou_user_session',
        userId: 'user_session',
        unionId: 'on_session',
        avatarUrl: '',
      };
    },
  };
  const server = createApp({ config, store, feishuClient });
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const anonymous = await fetch(`${baseUrl}/api/me`);
  assert.equal(anonymous.status, 401);

  const login = await fetch(`${baseUrl}/api/auth/feishu`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'login-code', state: 'state-1' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /sb_session=/);
  assert.doesNotMatch(cookie, /Secure/);

  const me = await fetch(`${baseUrl}/api/me`, {
    headers: { cookie },
  });
  assert.equal(me.status, 200);
  const payload = await me.json();
  assert.equal(payload.user.id, 'ou_user_session');
  assert.equal(payload.user.name, 'Session User');
});
