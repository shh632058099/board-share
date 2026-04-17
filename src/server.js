import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachPermissions, authenticate } from './auth.js';
import { loadConfig } from './config.js';
import {
  cancelReservation,
  createBoard,
  createReservation,
  deleteBoard,
  listBoards,
  listMyReservations,
  listTimeline,
  requestReturn,
  restoreBoard,
  returnReservation,
  updateBoard,
} from './domain.js';
import { HttpError, badRequest, notFound } from './errors.js';
import { FeishuClient } from './feishuClient.js';
import { createNotifier } from './notifier.js';
import {
  MemorySessionStore,
  getSessionId,
  serializeExpiredSessionCookie,
  serializeSessionCookie,
} from './session.js';
import { createStore } from './store/index.js';

const __filename = fileURLToPath(import.meta.url);

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, error) {
  const status = error instanceof HttpError ? error.status : 500;
  const payload = {
    error: {
      code: error instanceof HttpError ? error.code : 'internal_error',
      message: error instanceof HttpError ? error.message : '服务器内部错误',
    },
  };
  if (error instanceof HttpError && error.details !== undefined) {
    payload.error.details = error.details;
  }
  if (!(error instanceof HttpError)) {
    console.error(error);
  }
  sendJson(res, status, payload);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      throw badRequest('请求体过大');
    }
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  } catch {
    throw badRequest('请求体必须是合法 JSON');
  }
}

function getRequestNow(req, config) {
  const override = req.headers['x-now'];
  if (config.allowTimeOverride && override) {
    const date = new Date(String(override));
    if (Number.isNaN(date.getTime())) {
      throw badRequest('x-now 不是合法时间');
    }
    return date;
  }
  return new Date();
}

function boardRestoreIdFromPath(pathname) {
  const match = pathname.match(/^\/api\/boards\/([^/]+)\/restore$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function boardIdFromPath(pathname) {
  const match = pathname.match(/^\/api\/boards\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function reservationActionFromPath(pathname) {
  const match = pathname.match(/^\/api\/reservations\/([^/]+)\/(return|request-return|cancel)$/);
  if (!match) return null;
  return { id: decodeURIComponent(match[1]), action: match[2] };
}

async function handleAuthApi(req, res, deps) {
  const { config, store, feishuClient, sessionStore } = deps;
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/api/auth/config') {
    sendJson(res, 200, {
      auth: {
        devAuth: config.devAuth,
        feishuAuthEnabled: feishuClient.enabled,
        feishuAppId: config.feishu.appId,
        redirectUri: config.feishu.redirectUri,
        loginUrl: 'https://open.feishu.cn/open-apis/authen/v1/index',
      },
    });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/auth/feishu') {
    if (!feishuClient.enabled) {
      throw badRequest('未配置 FEISHU_APP_ID 或 FEISHU_APP_SECRET');
    }

    const body = await readJsonBody(req);
    const code = String(body.code || '').trim();
    if (!code) {
      throw badRequest('缺少飞书登录 code');
    }

    const feishuUser = await feishuClient.getUserByAuthCode(code);
    if (!feishuUser?.id) {
      throw badRequest('飞书用户身份为空');
    }

    const session = sessionStore.create(feishuUser);
    const state = await store.read();
    const user = attachPermissions(feishuUser, state, config);
    sendJson(
      res,
      200,
      { user },
      { 'set-cookie': serializeSessionCookie(session.id, config, { maxAgeSeconds: session.maxAgeSeconds }) },
    );
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/logout') {
    sessionStore.destroy(getSessionId(req, config));
    sendJson(res, 200, { ok: true }, { 'set-cookie': serializeExpiredSessionCookie(config) });
    return true;
  }

  return false;
}

async function handleApi(req, res, deps) {
  const { config, store, notifier, sessionStore } = deps;
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type,x-user-id,x-user-name,x-now,authorization',
    });
    res.end();
    return;
  }

  if (await handleAuthApi(req, res, deps)) {
    return;
  }

  const user = await authenticate(req, { config, store, sessionStore });
  const now = getRequestNow(req, config);

  if (req.method === 'GET' && pathname === '/api/me') {
    sendJson(res, 200, { user });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/boards') {
    const state = await store.read();
    const includeDeleted = user.isAdmin && url.searchParams.get('includeDeleted') === 'true';
    sendJson(res, 200, { boards: listBoards(state, { includeDeleted, now }) });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/timeline') {
    const state = await store.read();
    const includeDeleted = user.isAdmin && url.searchParams.get('includeDeleted') === 'true';
    sendJson(
      res,
      200,
      listTimeline(state, {
        from: url.searchParams.get('from'),
        to: url.searchParams.get('to'),
        includeDeleted,
        now,
      }),
    );
    return;
  }

  if (req.method === 'POST' && pathname === '/api/boards') {
    const body = await readJsonBody(req);
    const board = await store.update((state) => createBoard(state, body, user, config, now));
    sendJson(res, 201, { board });
    return;
  }

  const restoreBoardId = boardRestoreIdFromPath(pathname);
  if (restoreBoardId && req.method === 'POST') {
    const board = await store.update((state) => restoreBoard(state, restoreBoardId, user, config, now));
    sendJson(res, 200, { board });
    return;
  }

  const boardId = boardIdFromPath(pathname);
  if (boardId && req.method === 'PATCH') {
    const body = await readJsonBody(req);
    const board = await store.update((state) => updateBoard(state, boardId, body, user, config, now));
    sendJson(res, 200, { board });
    return;
  }

  if (boardId && req.method === 'DELETE') {
    const board = await store.update((state) => deleteBoard(state, boardId, user, config, now));
    sendJson(res, 200, { board });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/reservations') {
    const body = await readJsonBody(req);
    const reservation = await store.update((state) => createReservation(state, body, user, now));
    sendJson(res, 201, { reservation });
    return;
  }

  const reservationAction = reservationActionFromPath(pathname);
  if (reservationAction && req.method === 'POST') {
    if (reservationAction.action === 'return') {
      const reservation = await store.update((state) =>
        returnReservation(state, reservationAction.id, user, config, now),
      );
      sendJson(res, 200, { reservation });
      return;
    }

    if (reservationAction.action === 'cancel') {
      const reservation = await store.update((state) =>
        cancelReservation(state, reservationAction.id, user, config, now),
      );
      sendJson(res, 200, { reservation });
      return;
    }

    const returnRequest = await store.update((state) =>
      requestReturn(state, reservationAction.id, user, now, notifier),
    );
    sendJson(res, 201, { returnRequest });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/my/reservations') {
    const state = await store.read();
    sendJson(res, 200, listMyReservations(state, user, now));
    return;
  }

  throw notFound('接口不存在');
}

function safeStaticPath(publicDir, pathname) {
  const relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const resolved = path.resolve(publicDir, relativePath);
  const publicRoot = path.resolve(publicDir);
  const relative = path.relative(publicRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw notFound('文件不存在');
  }
  return resolved;
}

async function serveStatic(req, res, publicDir) {
  const url = new URL(req.url, 'http://localhost');
  const filePath = safeStaticPath(publicDir, url.pathname);
  const extension = path.extname(filePath);
  try {
    const content = await fs.readFile(filePath);
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extension] || 'application/octet-stream',
    });
    res.end(content);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'EISDIR') {
      throw error;
    }
    const fallback = path.join(publicDir, 'index.html');
    const content = await fs.readFile(fallback);
    res.writeHead(200, { 'content-type': CONTENT_TYPES['.html'] });
    res.end(content);
  }
}

export function createApp({ config = loadConfig(), store, feishuClient, notifier, sessionStore } = {}) {
  const client = feishuClient || new FeishuClient(config.feishu);
  const finalStore = store || createStore(config, client);
  const finalNotifier = notifier || createNotifier(config, client);
  const finalSessionStore = sessionStore || new MemorySessionStore(config.session);

  return http.createServer(async (req, res) => {
    try {
      if (req.url.startsWith('/api/')) {
        await handleApi(req, res, {
          config,
          store: finalStore,
          notifier: finalNotifier,
          feishuClient: client,
          sessionStore: finalSessionStore,
        });
      } else {
        await serveStatic(req, res, config.publicDir);
      }
    } catch (error) {
      sendError(res, error);
    }
  });
}

if (process.argv[1] === __filename) {
  const config = loadConfig();
  const server = createApp({ config });
  server.listen(config.port, () => {
    console.log(`share-board listening on http://localhost:${config.port}`);
  });
}
