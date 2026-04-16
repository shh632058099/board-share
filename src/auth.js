import { isAdminUser } from './domain.js';
import { unauthorized } from './errors.js';

function header(req, name) {
  const value = req.headers[name.toLowerCase()];
  if (typeof value !== 'string') return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function authenticate(req, { config, store, feishuClient }) {
  const url = new URL(req.url, 'http://localhost');
  const code = url.searchParams.get('code');
  let user = null;

  if (code && feishuClient?.enabled) {
    user = await feishuClient.getUserByAuthCode(code);
  } else if (config.devAuth) {
    user = {
      id: header(req, 'x-user-id') || 'ou_admin',
      name: header(req, 'x-user-name') || '本地管理员',
    };
  }

  if (!user?.id) {
    throw unauthorized();
  }

  const state = await store.read();
  return {
    ...user,
    isAdmin: isAdminUser(user, state, config),
  };
}
