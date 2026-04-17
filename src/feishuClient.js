import https from 'node:https';

async function requestJson(url, { method, headers, body }) {
  if (typeof fetch === 'function') {
    const response = await fetch(url, { method, headers, body });
    return {
      ok: response.ok,
      statusText: response.statusText,
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
          statusText: res.statusMessage || String(res.statusCode || ''),
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
  constructor({ appId, appSecret }) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.tenantToken = null;
    this.tenantTokenExpiresAt = 0;
    this.appToken = null;
    this.appTokenExpiresAt = 0;
  }

  get enabled() {
    return Boolean(this.appId && this.appSecret);
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

    const { ok, statusText, payload } = await requestJson(`https://open.feishu.cn${path}`, {
      method,
      headers: finalHeaders,
      body: serializedBody,
    });

    if (!ok || (payload.code !== undefined && payload.code !== 0)) {
      const message = payload.msg || payload.message || statusText;
      throw new Error(`Feishu API failed: ${message}`);
    }
    return payload;
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
