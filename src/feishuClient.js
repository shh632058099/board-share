export class FeishuClient {
  constructor({ appId, appSecret }) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.tenantToken = null;
    this.tenantTokenExpiresAt = 0;
  }

  get enabled() {
    return Boolean(this.appId && this.appSecret);
  }

  async request(path, { method = 'GET', headers = {}, body, tenantToken = true } = {}) {
    const finalHeaders = {
      'content-type': 'application/json; charset=utf-8',
      ...headers,
    };

    if (tenantToken) {
      finalHeaders.authorization = `Bearer ${await this.getTenantAccessToken()}`;
    }

    const response = await fetch(`https://open.feishu.cn${path}`, {
      method,
      headers: finalHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
      const message = payload.msg || payload.message || response.statusText;
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

  async getUserByAuthCode(code) {
    const payload = await this.request('/open-apis/authen/v1/access_token', {
      method: 'POST',
      body: {
        grant_type: 'authorization_code',
        code,
      },
    });

    const data = payload.data || {};
    return {
      id: data.open_id || data.user_id || data.union_id,
      name: data.name || data.en_name || data.user_id || data.open_id || '飞书用户',
      openId: data.open_id,
      userId: data.user_id,
      avatarUrl: data.avatar_url || '',
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
