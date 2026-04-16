import { isAdminUser } from './domain.js';
import { unauthorized } from './errors.js';
import { getSessionId } from './session.js';

function header(req, name) {
  const value = req.headers[name.toLowerCase()];
  if (typeof value !== 'string') return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function attachPermissions(user, state, config) {
  return {
    ...user,
    isAdmin: isAdminUser(user, state, config),
  };
}

export async function authenticate(req, { config, store, sessionStore }) {
  let user = null;
  const sessionId = getSessionId(req, config);

  if (sessionId && sessionStore) {
    user = sessionStore.get(sessionId);
  }

  if (!user && config.devAuth) {
    user = {
      id: header(req, 'x-user-id') || 'ou_admin',
      name: header(req, 'x-user-name') || '本地管理员',
      openId: header(req, 'x-user-id') || 'ou_admin',
      userId: '',
      unionId: '',
      avatarUrl: '',
    };
  }

  if (!user?.id) {
    throw unauthorized();
  }

  const state = await store.read();
  return attachPermissions(user, state, config);
}
