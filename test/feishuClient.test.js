import assert from 'node:assert/strict';
import test from 'node:test';
import { FeishuClient } from '../src/feishuClient.js';

function mockResponse({ ok = true, status = 200, statusText = 'OK', payload = {}, headers = {} } = {}) {
  return {
    ok,
    status,
    statusText,
    headers: {
      get(name) {
        return headers[name] || headers[name.toLowerCase()] || '';
      },
    },
    json: async () => payload,
  };
}

test('retries Feishu requests when frequency limited', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) {
      return mockResponse({
        payload: {
          code: 99991672,
          msg: 'request trigger frequency limit',
        },
      });
    }

    return mockResponse({
      payload: {
        code: 0,
        data: { ok: true },
      },
    });
  };

  try {
    const client = new FeishuClient({
      appId: 'app_id',
      appSecret: 'app_secret',
      minRequestIntervalMs: 0,
      rateLimitMaxRetries: 2,
      rateLimitRetryDelaysMs: [0],
    });

    const payload = await client.request('/open-apis/test', { tenantToken: false });

    assert.equal(calls.length, 2);
    assert.deepEqual(payload.data, { ok: true });
  } finally {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    } else {
      delete globalThis.fetch;
    }
  }
});
