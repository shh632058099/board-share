import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/server.js';
import { LocalStore } from '../src/store/localStore.js';
import { SQLiteStore } from '../src/store/sqliteStore.js';

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

test('keeps overdue unreturned boards visible in timeline and blocks reuse until returned', async (t) => {
  const { baseUrl, server, tmpDir } = await startTestServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const created = await request(baseUrl, '/api/boards', {
    method: 'POST',
    body: { boardNo: 'B-002A', type: 'EVB' },
  });
  const boardId = created.payload.board.id;

  const reserved = await request(baseUrl, '/api/reservations', {
    method: 'POST',
    user: { id: 'ou_user_1', name: 'User 1' },
    now: '2026-04-16T20:30:00+08:00',
    body: { boardId, durationHours: 1, purpose: 'long running debug' },
  });
  const reservationId = reserved.payload.reservation.id;

  const timeline = await request(
    baseUrl,
    '/api/timeline?from=2026-04-17T09%3A31%3A00.000%2B08%3A00&to=2026-04-17T12%3A00%3A00.000%2B08%3A00',
    {
      user: { id: 'ou_user_2', name: 'User 2' },
      now: '2026-04-17T10:30:00+08:00',
    },
  );
  assert.equal(timeline.status, 200);
  assert.equal(timeline.payload.boards[0].board.status, 'overdue');
  assert.equal(timeline.payload.boards[0].board.currentUserName, 'User 1');
  assert.equal(timeline.payload.boards[0].reservations.length, 1);
  assert.equal(timeline.payload.boards[0].reservations[0].status, 'overdue');
  assert.equal(timeline.payload.boards[0].reservations[0].userName, 'User 1');

  const blocked = await request(baseUrl, '/api/reservations', {
    method: 'POST',
    user: { id: 'ou_user_2', name: 'User 2' },
    now: '2026-04-17T10:30:00+08:00',
    body: {
      boardId,
      startAt: '2026-04-17T11:00:00+08:00',
      durationHours: 0.5,
    },
  });
  assert.equal(blocked.status, 409);

  const deleted = await request(baseUrl, `/api/boards/${boardId}`, {
    method: 'DELETE',
    now: '2026-04-17T10:30:00+08:00',
  });
  assert.equal(deleted.status, 409);

  const returned = await request(baseUrl, `/api/reservations/${reservationId}/return`, {
    method: 'POST',
    user: { id: 'ou_user_1', name: 'User 1' },
    now: '2026-04-17T10:40:00+08:00',
    body: {},
  });
  assert.equal(returned.status, 200);

  const replacement = await request(baseUrl, '/api/reservations', {
    method: 'POST',
    user: { id: 'ou_user_2', name: 'User 2' },
    now: '2026-04-17T10:41:00+08:00',
    body: {
      boardId,
      startAt: '2026-04-17T11:00:00+08:00',
      durationHours: 0.5,
    },
  });
  assert.equal(replacement.status, 201);
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


test('accepts timestamp and space separated reservation start formats', async (t) => {
  const { baseUrl, server, tmpDir } = await startTestServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const created = await request(baseUrl, '/api/boards', {
    method: 'POST',
    body: { boardNo: 'B-004', type: 'EVB' },
  });
  const boardId = created.payload.board.id;

  const timestampStart = new Date('2026-04-16T13:00:00+08:00').getTime();
  const first = await request(baseUrl, '/api/reservations', {
    method: 'POST',
    user: { id: 'ou_user_1', name: 'User 1' },
    now: '2026-04-16T10:00:00+08:00',
    body: { boardId, startAt: String(timestampStart), durationHours: 1 },
  });
  assert.equal(first.status, 201);

  const second = await request(baseUrl, '/api/reservations', {
    method: 'POST',
    user: { id: 'ou_user_2', name: 'User 2' },
    now: '2026-04-16T10:00:00+08:00',
    body: { boardId, startAt: '2026-04-16 14:00', durationHours: 1 },
  });
  assert.equal(second.status, 201);
});

test('cancels future reservations and releases the reserved slot', async (t) => {
  const { baseUrl, server, tmpDir } = await startTestServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const created = await request(baseUrl, '/api/boards', {
    method: 'POST',
    body: { boardNo: 'B-005', type: 'EVB' },
  });
  const boardId = created.payload.board.id;

  const reserved = await request(baseUrl, '/api/reservations', {
    method: 'POST',
    user: { id: 'ou_user_1', name: 'User 1' },
    now: '2026-04-16T10:00:00+08:00',
    body: {
      boardId,
      startAt: '2026-04-16T14:00:00+08:00',
      durationHours: 1,
    },
  });
  assert.equal(reserved.status, 201);
  const reservationId = reserved.payload.reservation.id;

  const blocked = await request(baseUrl, '/api/reservations', {
    method: 'POST',
    user: { id: 'ou_user_2', name: 'User 2' },
    now: '2026-04-16T10:05:00+08:00',
    body: {
      boardId,
      startAt: '2026-04-16T14:30:00+08:00',
      durationHours: 0.5,
    },
  });
  assert.equal(blocked.status, 409);

  const denied = await request(baseUrl, `/api/reservations/${reservationId}/cancel`, {
    method: 'POST',
    user: { id: 'ou_user_2', name: 'User 2' },
    now: '2026-04-16T10:10:00+08:00',
    body: {},
  });
  assert.equal(denied.status, 403);

  const canceled = await request(baseUrl, `/api/reservations/${reservationId}/cancel`, {
    method: 'POST',
    user: { id: 'ou_user_1', name: 'User 1' },
    now: '2026-04-16T10:15:00+08:00',
    body: {},
  });
  assert.equal(canceled.status, 200);
  assert.equal(canceled.payload.reservation.status, 'canceled');

  const myReservations = await request(baseUrl, '/api/my/reservations', {
    user: { id: 'ou_user_1', name: 'User 1' },
    now: '2026-04-16T10:16:00+08:00',
  });
  assert.equal(myReservations.payload.upcoming.length, 0);
  assert.equal(myReservations.payload.history.length, 1);
  assert.equal(myReservations.payload.history[0].status, 'canceled');

  const replacement = await request(baseUrl, '/api/reservations', {
    method: 'POST',
    user: { id: 'ou_user_2', name: 'User 2' },
    now: '2026-04-16T10:20:00+08:00',
    body: {
      boardId,
      startAt: '2026-04-16T14:30:00+08:00',
      durationHours: 0.5,
    },
  });
  assert.equal(replacement.status, 201);

  const timeline = await request(
    baseUrl,
    '/api/timeline?from=2026-04-16T13%3A00%3A00.000%2B08%3A00&to=2026-04-16T16%3A00%3A00.000%2B08%3A00',
    {
      user: { id: 'ou_user_2', name: 'User 2' },
      now: '2026-04-16T10:25:00+08:00',
    },
  );
  assert.equal(timeline.status, 200);
  assert.deepEqual(
    timeline.payload.boards[0].reservations.map((reservation) => reservation.id),
    [replacement.payload.reservation.id],
  );
});


test('restores a soft deleted board', async (t) => {
  const { baseUrl, server, tmpDir } = await startTestServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const created = await request(baseUrl, '/api/boards', {
    method: 'POST',
    body: { boardNo: 'B-006', type: 'EVB' },
  });
  const boardId = created.payload.board.id;

  const deleted = await request(baseUrl, `/api/boards/${boardId}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.payload.board.status, 'deleted');
  assert.equal(deleted.payload.board.deleted, true);

  const hidden = await request(baseUrl, '/api/boards', {
    user: { id: 'ou_user_1', name: 'User 1' },
  });
  assert.equal(hidden.payload.boards.length, 0);

  const restored = await request(baseUrl, `/api/boards/${boardId}/restore`, {
    method: 'POST',
    body: {},
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.payload.board.status, 'available');
  assert.equal(restored.payload.board.deleted, false);

  const visible = await request(baseUrl, '/api/boards', {
    user: { id: 'ou_user_1', name: 'User 1' },
  });
  assert.equal(visible.payload.boards.length, 1);
});

test('manages database admins without deleting the last effective admin', async (t) => {
  const { baseUrl, server, tmpDir } = await startTestServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const denied = await request(baseUrl, '/api/admins', {
    user: { id: 'ou_user_1', name: 'User 1' },
  });
  assert.equal(denied.status, 403);

  const initial = await request(baseUrl, '/api/admins');
  assert.equal(initial.status, 200);
  assert.deepEqual(
    initial.payload.admins.map((admin) => admin.userId),
    ['ou_admin'],
  );

  const blockedDelete = await request(baseUrl, '/api/admins/ou_admin', {
    method: 'DELETE',
  });
  assert.equal(blockedDelete.status, 409);

  const added = await request(baseUrl, '/api/admins', {
    method: 'POST',
    body: { userId: 'ou_admin_2', name: 'Admin 2' },
  });
  assert.equal(added.status, 201);
  assert.equal(added.payload.admin.userId, 'ou_admin_2');

  const me = await request(baseUrl, '/api/me', {
    user: { id: 'ou_admin_2', name: 'Admin 2' },
  });
  assert.equal(me.payload.user.isAdmin, true);

  const deletedDefault = await request(baseUrl, '/api/admins/ou_admin', {
    method: 'DELETE',
    user: { id: 'ou_admin_2', name: 'Admin 2' },
  });
  assert.equal(deletedDefault.status, 200);

  const blockedLast = await request(baseUrl, '/api/admins/ou_admin_2', {
    method: 'DELETE',
    user: { id: 'ou_admin_2', name: 'Admin 2' },
  });
  assert.equal(blockedLast.status, 409);
});

test('keeps env admins read-only in admin API', async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'share-board-'));
  const config = loadConfig(
    {
      NODE_ENV: 'test',
      DEV_AUTH: 'true',
      ADMIN_USER_IDS: 'ou_env_admin',
      DATA_FILE: path.join(tmpDir, 'state.json'),
    },
    process.cwd(),
  );
  const store = new LocalStore(config.dataFile);
  const server = createApp({ config, store });
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const admins = await request(baseUrl, '/api/admins', {
    user: { id: 'ou_env_admin', name: 'Env Admin' },
  });
  assert.equal(admins.status, 200);
  assert.equal(admins.payload.admins.find((admin) => admin.userId === 'ou_env_admin').source, 'env');

  const deleted = await request(baseUrl, '/api/admins/ou_env_admin', {
    method: 'DELETE',
    user: { id: 'ou_env_admin', name: 'Env Admin' },
  });
  assert.equal(deleted.status, 409);
});

test('runs core reservation flow with sqlite storage', async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'share-board-sqlite-api-'));
  const config = loadConfig(
    {
      NODE_ENV: 'test',
      DEV_AUTH: 'true',
      ALLOW_TIME_OVERRIDE: 'true',
      STORAGE: 'sqlite',
      SQLITE_FILE: path.join(tmpDir, 'state.sqlite'),
    },
    process.cwd(),
  );
  const store = new SQLiteStore(config.sqliteFile);
  const server = createApp({ config, store });
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const created = await request(baseUrl, '/api/boards', {
    method: 'POST',
    body: { boardNo: 'B-SQL-API', type: 'EVB' },
  });
  assert.equal(created.status, 201);

  const reserved = await request(baseUrl, '/api/reservations', {
    method: 'POST',
    user: { id: 'ou_user_sql', name: 'SQL User' },
    now: '2026-04-16T10:00:00+08:00',
    body: {
      boardId: created.payload.board.id,
      startAt: '2026-04-16T14:00:00+08:00',
      durationHours: 1,
    },
  });
  assert.equal(reserved.status, 201);
  assert.equal(reserved.payload.reservation.status, 'reserved');

  const canceled = await request(baseUrl, `/api/reservations/${reserved.payload.reservation.id}/cancel`, {
    method: 'POST',
    user: { id: 'ou_user_sql', name: 'SQL User' },
    now: '2026-04-16T10:30:00+08:00',
    body: {},
  });
  assert.equal(canceled.status, 200);
  assert.equal(canceled.payload.reservation.status, 'canceled');

  const state = await store.read();
  assert.equal(state.boards[0].boardNo, 'B-SQL-API');
  assert.equal(state.reservations[0].status, 'canceled');
  assert.equal(state.reservations[0].boardNoSnapshot, 'B-SQL-API');
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
