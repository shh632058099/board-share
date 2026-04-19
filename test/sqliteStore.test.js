import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SQLiteStore } from '../src/store/sqliteStore.js';

test('sqlite store creates schema, seeds local admin, and preserves extended fields', async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'share-board-sqlite-'));
  const sqliteFile = path.join(tmpDir, 'state.sqlite');
  const store = new SQLiteStore(sqliteFile);
  t.after(async () => {
    store.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const initial = await store.read();
  assert.equal(initial.admins.some((admin) => admin.userId === 'ou_admin'), true);

  await store.write({
    boards: [
      {
        id: 'board_1',
        boardNo: 'B-SQL-1',
        displayName: 'SQL Board',
        type: 'EVB',
        model: 'M1',
        version: 'v1',
        systemVersion: '2026.04',
        assetNo: 'A-001',
        serialNo: 'S-001',
        location: 'Lab A',
        ownerUserId: 'ou_owner',
        ownerUserName: 'Owner',
        subcards: [{ name: 'sensor', model: 'S1', remark: 'demo' }],
        tags: ['lab', 'evb'],
        attrs: { lane: 3 },
        status: 'available',
        currentUserId: '',
        currentUserName: '',
        currentReservationId: '',
        sortOrder: 7,
        remark: 'ready',
        deleted: false,
        createdAt: '2026-04-16T01:00:00.000Z',
        updatedAt: '2026-04-16T01:00:00.000Z',
      },
    ],
    reservations: [
      {
        id: 'resv_1',
        boardId: 'board_1',
        boardNoSnapshot: 'B-SQL-1',
        boardTypeSnapshot: 'EVB',
        boardVersionSnapshot: 'v1',
        userId: 'ou_user',
        userName: 'User',
        userOpenId: 'ou_user',
        userUnionId: 'on_user',
        durationHours: 1,
        purpose: 'test',
        startedAt: '2026-04-16T06:00:00.000Z',
        plannedEndAt: '2026-04-16T07:00:00.000Z',
        returnedAt: null,
        status: 'canceled',
        returnRequestCount: 0,
        canceledAt: '2026-04-16T02:00:00.000Z',
        canceledById: 'ou_user',
        canceledByName: 'User',
        tags: ['canceled'],
        attrs: { reasonCode: 'plan_changed' },
        createdAt: '2026-04-16T01:30:00.000Z',
        updatedAt: '2026-04-16T02:00:00.000Z',
      },
    ],
    returnRequests: [
      {
        id: 'retreq_1',
        reservationId: 'resv_1',
        boardId: 'board_1',
        boardNoSnapshot: 'B-SQL-1',
        targetUserId: 'ou_user',
        targetUserName: 'User',
        requesterUserId: 'ou_other',
        requesterName: 'Other',
        requestedAt: '2026-04-16T08:00:00.000Z',
        notificationStatus: 'sent',
        channel: 'feishu_private',
        messageId: 'msg_1',
        response: { ok: true },
        attrs: { retry: 0 },
      },
    ],
    admins: [
      {
        userId: 'ou_admin',
        name: '本地管理员',
        enabled: true,
      },
      {
        userId: 'ou_extra_admin',
        name: 'Extra Admin',
        role: 'admin',
        permissions: { boards: 'write' },
        source: 'database',
        enabled: true,
        attrs: { team: 'qa' },
        createdAt: '2026-04-16T01:00:00.000Z',
        updatedAt: '2026-04-16T01:00:00.000Z',
      },
    ],
  });

  const state = await store.read();
  assert.equal(state.boards[0].displayName, 'SQL Board');
  assert.deepEqual(state.boards[0].tags, ['lab', 'evb']);
  assert.deepEqual(state.boards[0].attrs, { lane: 3 });
  assert.equal(state.reservations[0].status, 'canceled');
  assert.equal(state.reservations[0].boardNoSnapshot, 'B-SQL-1');
  assert.deepEqual(state.reservations[0].attrs, { reasonCode: 'plan_changed' });
  assert.equal(state.returnRequests[0].boardNoSnapshot, 'B-SQL-1');
  assert.deepEqual(state.returnRequests[0].response, { ok: true });
  assert.deepEqual(
    state.admins.find((admin) => admin.userId === 'ou_extra_admin').permissions,
    { boards: 'write' },
  );
});
