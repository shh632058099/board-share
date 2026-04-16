import { randomBytes } from 'node:crypto';

function parseMaxAge(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 7 * 24 * 60 * 60;
}

export class MemorySessionStore {
  constructor({ maxAgeSeconds = 7 * 24 * 60 * 60 } = {}) {
    this.maxAgeSeconds = parseMaxAge(maxAgeSeconds);
    this.sessions = new Map();
  }

  create(user) {
    const id = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + this.maxAgeSeconds * 1000;
    this.sessions.set(id, { user, expiresAt });
    return { id, expiresAt, maxAgeSeconds: this.maxAgeSeconds };
  }

  get(id) {
    if (!id) return null;
    const session = this.sessions.get(id);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(id);
      return null;
    }
    return session.user;
  }

  destroy(id) {
    if (id) {
      this.sessions.delete(id);
    }
  }
}

export function parseCookies(header = '') {
  return String(header)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const index = part.indexOf('=');
      if (index === -1) return cookies;
      const name = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      try {
        cookies[name] = decodeURIComponent(value);
      } catch {
        cookies[name] = value;
      }
      return cookies;
    }, {});
}

export function getSessionId(req, config) {
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies[config.session.cookieName] || '';
}

export function serializeSessionCookie(sessionId, config, { maxAgeSeconds } = {}) {
  const parts = [
    `${config.session.cookieName}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${config.session.cookieSameSite}`,
    `Max-Age=${Math.floor(maxAgeSeconds ?? config.session.maxAgeSeconds)}`,
  ];
  if (config.session.cookieSecure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function serializeExpiredSessionCookie(config) {
  const parts = [
    `${config.session.cookieName}=`,
    'Path=/',
    'HttpOnly',
    `SameSite=${config.session.cookieSameSite}`,
    'Max-Age=0',
  ];
  if (config.session.cookieSecure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}
