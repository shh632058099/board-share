import https from 'node:https';

const DEFAULT_MIN_REQUEST_INTERVAL_MS = 120;
const DEFAULT_RATE_LIMIT_MAX_RETRIES = 4;
const DEFAULT_RATE_LIMIT_RETRY_DELAYS_MS = [300, 600, 1200, 2400];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function headerValue(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || '';
  const exact = headers[name] || headers[name.toLowerCase()];
  return Array.isArray(exact) ? exact[0] : exact || '';
}

function retryAfterMs(headers) {
  const value = headerValue(headers, 'retry-after');
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function responseMessage({ payload, statusText }) {
  return payload?.msg || payload?.message || statusText || 'Unknown error';
}

function isRateLimitResponse(response) {
  const message = String(responseMessage(response) || '').toLowerCase();
  return (
    response.statusCode === 429 ||
    message.includes('frequency limit') ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('too frequent')
  );
}

async function requestJson(url, { method, headers, body }) {
  if (typeof fetch === 'function') {
    const response = await fetch(url, { method, headers, body });
    return {
      ok: response.ok,
      statusCode: response.status,
      statusText: response.statusText,
      headers: response.headers,
      payload: await response.json().catch(() => ({})),
    };
  }

  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        let payload = {};
        if (raw) {
          try {
            payload = JSON.parse(raw);
          } catch {
            payload = {};
          }
        }
        resolve({
          ok: Number(res.statusCode) >= 200 && Number(res.statusCode) < 300,
          statusCode: Number(res.statusCode),
          statusText: res.statusMessage || String(res.statusCode || ''),
          headers: res.headers,
          payload,
        });
      });
    });

    req.on('error', reject);
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

export class FeishuClient {
  constructor({
    appId,
    appSecret,
    minRequestIntervalMs = DEFAULT_MIN_REQUEST_INTERVAL_MS,
    rateLimitMaxRetries = DEFAULT_RATE_LIMIT_MAX_RETRIES,
    rateLimitRetryDelaysMs = DEFAULT_RATE_LIMIT_RETRY_DELAYS_MS,
  } = {}) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.minRequestIntervalMs = Math.max(0, Number(minRequestIntervalMs) || 0);
    this.rateLimitMaxRetries = Math.max(0, Number(rateLimitMaxRetries) || 0);
    this.rateLimitRetryDelaysMs =
      Array.isArray(rateLimitRetryDelaysMs) && rateLimitRetryDelaysMs.length
        ? rateLimitRetryDelaysMs.map((delay) => Math.max(0, Number(delay) || 0))
        : DEFAULT_RATE_LIMIT_RETRY_DELAYS_MS;
    this.requestQueue = Promise.resolve();
    this.nextRequestAt = 0;
    this.tenantToken = null;
    this.tenantTokenExpiresAt = 0;
    this.appToken = null;
    this.appTokenExpiresAt = 0;
  }

  get enabled() {
    return Boolean(this.appId && this.appSecret);
  }

  async sendQueuedRequest(url, options) {
    const run = async () => {
      const waitMs = this.nextRequestAt - Date.now();
      if (waitMs > 0) {
        await sleep(waitMs);
      }

      try {
        return await requestJson(url, options);
      } finally {
        this.nextRequestAt = Date.now() + this.minRequestIntervalMs;
      }
    };

    const next = this.requestQueue.then(run, run);
    this.requestQueue = next.catch(() => undefined);
    return next;
  }

  rateLimitDelayMs(attempt, headers) {
    const retryAfter = retryAfterMs(headers);
    if (retryAfter !== null) return retryAfter;
    return this.rateLimitRetryDelaysMs[Math.min(attempt, this.rateLimitRetryDelaysMs.length - 1)];
  }

  async request(path, { method = 'GET', headers = {}, body, tenantToken = true, bearerToken = '' } = {}) {
    const finalHeaders = {
      'content-type': 'application/json; charset=utf-8',
      ...headers,
    };

    if (bearerToken) {
      finalHeaders.authorization = `Bearer ${bearerToken}`;
    } else if (tenantToken) {
      finalHeaders.authorization = `Bearer ${await this.getTenantAccessToken()}`;
    }

    const serializedBody = body === undefined ? undefined : JSON.stringify(body);
    if (serializedBody !== undefined) {
      finalHeaders['content-length'] = Buffer.byteLength(serializedBody);
    }

    const url = `https://open.feishu.cn${path}`;
    for (let attempt = 0; attempt <= this.rateLimitMaxRetries; attempt += 1) {
      const response = await this.sendQueuedRequest(url, {
        method,
        headers: finalHeaders,
        body: serializedBody,
      });
      const { ok, payload } = response;

      if (ok && (payload.code === undefined || payload.code === 0)) {
        return payload;
      }

      if (attempt < this.rateLimitMaxRetries && isRateLimitResponse(response)) {
        await sleep(this.rateLimitDelayMs(attempt, response.headers));
        continue;
      }

      throw new Error(`Feishu API failed: ${responseMessage(response)}`);
    }

    throw new Error('Feishu API failed: request retry exhausted');
  }

  async getTenantAccessToken() {
    if (!this.enabled) {
      throw new Error('FEISHU_APP_ID and FEISHU_APP_SECRET are required');
    }

    const now = Date.now();
    if (this.tenantToken && this.tenantTokenExpiresAt - 60_000 > now) {
      return this.tenantToken;
    }

    const payload = await this.request('/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      tenantToken: false,
      body: {
        app_id: this.appId,
        app_secret: this.appSecret,
      },
    });

    this.tenantToken = payload.tenant_access_token;
    this.tenantTokenExpiresAt = now + Number(payload.expire || 7200) * 1000;
    return this.tenantToken;
  }

  async getAppAccessToken() {
    if (!this.enabled) {
      throw new Error('FEISHU_APP_ID and FEISHU_APP_SECRET are required');
    }

    const now = Date.now();
    if (this.appToken && this.appTokenExpiresAt - 60_000 > now) {
      return this.appToken;
    }

    const payload = await this.request('/open-apis/auth/v3/app_access_token/internal', {
      method: 'POST',
      tenantToken: false,
      body: {
        app_id: this.appId,
        app_secret: this.appSecret,
      },
    });

    this.appToken = payload.app_access_token;
    this.appTokenExpiresAt = now + Number(payload.expire || 7200) * 1000;
    return this.appToken;
  }

  async getUserByAuthCode(code) {
    const appAccessToken = await this.getAppAccessToken();
    const tokenPayload = await this.request('/open-apis/authen/v1/access_token', {
      method: 'POST',
      tenantToken: false,
      bearerToken: appAccessToken,
      body: {
        grant_type: 'authorization_code',
        code,
      },
    });

    const accessToken = tokenPayload.data?.access_token || tokenPayload.data?.user_access_token;
    if (!accessToken) {
      throw new Error('Feishu API failed: user_access_token is missing');
    }

    const userPayload = await this.request('/open-apis/authen/v1/user_info', {
      tenantToken: false,
      bearerToken: accessToken,
    });

    const data = userPayload.data || tokenPayload.data || {};
    return {
      id: data.open_id || data.user_id || data.union_id,
      name: data.name || data.en_name || data.user_id || data.open_id || '飞书用户',
      openId: data.open_id || '',
      userId: data.user_id || '',
      unionId: data.union_id || '',
      avatarUrl: data.avatar_url || data.avatar_thumb || '',
    };
  }

  async sendTextToUser(openId, text) {
    return this.request('/open-apis/im/v1/messages?receive_id_type=open_id', {
      method: 'POST',
      body: {
        receive_id: openId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
    });
  }

  async sendTextToChat(chatId, text) {
    return this.request('/open-apis/im/v1/messages?receive_id_type=chat_id', {
      method: 'POST',
      body: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
    });
  }

  async listBitableRecords(appToken, tableId) {
    const records = [];
    let pageToken = '';

    do {
      const query = new URLSearchParams({ page_size: '500' });
      if (pageToken) {
        query.set('page_token', pageToken);
      }
      const payload = await this.request(
        `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records?${query}`,
      );
      records.push(...(payload.data?.items || []));
      pageToken = payload.data?.page_token || '';
    } while (pageToken);

    return records;
  }

  async createBitableRecord(appToken, tableId, fields) {
    const payload = await this.request(`/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`, {
      method: 'POST',
      body: { fields },
    });
    return payload.data?.record;
  }

  async updateBitableRecord(appToken, tableId, recordId, fields) {
    const payload = await this.request(
      `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
      {
        method: 'PUT',
        body: { fields },
      },
    );
    return payload.data?.record;
  }
}
