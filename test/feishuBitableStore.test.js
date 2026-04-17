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
