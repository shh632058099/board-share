import assert from 'node:assert/strict';
import test from 'node:test';
import { FeishuBitableStore } from '../src/store/feishuBitableStore.js';

test('retries writes with millisecond timestamps when Feishu expects datetime fields', async () => {
  const calls = [];
  const client = {
    updateBitableRecord: async (_appToken, tableId, recordId, fields) => {
      calls.push({ tableId, recordId, fields });
      if (calls.length === 1) {
        throw new Error('Feishu API failed: DatetimeFieldConvFail');
      }
      return { record_id: recordId };
    },
    createBitableRecord: async () => {
      throw new Error('unexpected create');
    },
  };
  const store = new FeishuBitableStore(client, {
    feishu: {
      bitableAppToken: 'app_token',
      tables: {
        boards: 'tbl_boards',
        reservations: 'tbl_reservations',
        returnRequests: 'tbl_return_requests',
        admins: 'tbl_admins',
      },
    },
  });

  await store.write({
    boards: [
      {
        __recordId: 'rec_board',
        id: 'board_1',
        boardNo: 'B-001',
        type: 'EVB',
        version: 'v1',
        systemVersion: 'sys',
        subcards: [],
        status: 'available',
        remark: '',
        deleted: false,
        createdAt: '2026-04-16T02:00:00.000Z',
        updatedAt: '2026-04-16T03:00:00.000Z',
      },
    ],
    reservations: [],
    returnRequests: [],
    admins: [],
  });

  assert.equal(calls.length, 2);
  assert.equal(typeof calls[1].fields.创建时间, 'number');
  assert.equal(typeof calls[1].fields.更新时间, 'number');
});


test('retries writes with text values when Feishu expects text fields', async () => {
  const calls = [];
  const client = {
    updateBitableRecord: async (_appToken, tableId, recordId, fields) => {
      calls.push({ tableId, recordId, fields });
      if (calls.length === 1) {
        throw new Error('Feishu API failed: TextFieldConvFail');
      }
      return { record_id: recordId };
    },
    createBitableRecord: async () => {
      throw new Error('unexpected create');
    },
  };
  const store = new FeishuBitableStore(client, {
    feishu: {
      bitableAppToken: 'app_token',
      tables: {
        boards: 'tbl_boards',
        reservations: 'tbl_reservations',
        returnRequests: 'tbl_return_requests',
        admins: 'tbl_admins',
      },
    },
  });

  await store.write({
    boards: [],
    reservations: [
      {
        __recordId: 'rec_resv',
        id: 'resv_1',
        boardId: 'board_1',
        userId: 'ou_user',
        userName: 'User',
        durationHours: 1.5,
        purpose: '',
        startedAt: '2026-04-16T02:00:00.000Z',
        plannedEndAt: '2026-04-16T03:30:00.000Z',
        returnedAt: null,
        status: 'reserved',
        returnRequestCount: 0,
        createdAt: '2026-04-16T01:00:00.000Z',
        updatedAt: '2026-04-16T01:00:00.000Z',
      },
    ],
    returnRequests: [],
    admins: [],
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[1].fields.申请时长, '1.5');
  assert.equal(calls[1].fields.归还请求次数, '0');
});

test('creates Reservations records with time-related values as text', async () => {
  const calls = [];
  const client = {
    updateBitableRecord: async () => {
      throw new Error('unexpected update');
    },
    createBitableRecord: async (_appToken, tableId, fields) => {
      calls.push({ tableId, fields });
      return { record_id: 'rec_resv_created' };
    },
  };
  const store = new FeishuBitableStore(client, {
    feishu: {
      bitableAppToken: 'app_token',
      tables: {
        boards: 'tbl_boards',
        reservations: 'tbl_reservations',
        returnRequests: 'tbl_return_requests',
        admins: 'tbl_admins',
      },
    },
  });

  await store.write({
    boards: [],
    reservations: [
      {
        id: 'resv_2',
        boardId: 'board_1',
        userId: 'ou_user',
        userName: 'User',
        durationHours: 1.5,
        purpose: '',
        startedAt: '2026-04-16T02:00:00.000Z',
        plannedEndAt: '2026-04-16T03:30:00.000Z',
        returnedAt: null,
        status: 'reserved',
        returnRequestCount: 0,
        createdAt: '2026-04-16T01:00:00.000Z',
        updatedAt: '2026-04-16T01:00:00.000Z',
      },
    ],
    returnRequests: [],
    admins: [],
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].tableId, 'tbl_reservations');
  assert.equal(calls[0].fields.申请时长, '1.5');
  assert.equal(calls[0].fields.开始时间, '2026-04-16T02:00:00.000Z');
  assert.equal(calls[0].fields.计划结束时间, '2026-04-16T03:30:00.000Z');
  assert.equal(calls[0].fields.实际归还时间, '');
  assert.equal(calls[0].fields.创建时间, '2026-04-16T01:00:00.000Z');
  assert.equal(calls[0].fields.更新时间, '2026-04-16T01:00:00.000Z');
});
