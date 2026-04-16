import path from 'node:path';

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function boolFromEnv(value, defaultValue) {
  if (value === undefined) {
    return defaultValue;
  }
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
}

export function loadConfig(env = process.env, cwd = process.cwd()) {
  const feishuBitableConfigured = Boolean(
    env.FEISHU_BITABLE_APP_TOKEN &&
      env.FEISHU_BOARDS_TABLE_ID &&
      env.FEISHU_RESERVATIONS_TABLE_ID &&
      env.FEISHU_RETURN_REQUESTS_TABLE_ID &&
      env.FEISHU_ADMINS_TABLE_ID,
  );

  return {
    port: Number(env.PORT || 3000),
    dataFile: env.DATA_FILE || path.join(cwd, 'data', 'share-board.json'),
    publicDir: env.PUBLIC_DIR || path.join(cwd, 'public'),
    devAuth: boolFromEnv(env.DEV_AUTH, true),
    allowTimeOverride: boolFromEnv(env.ALLOW_TIME_OVERRIDE, env.NODE_ENV === 'test'),
    adminUserIds: splitCsv(env.ADMIN_USER_IDS),
    storage: env.STORAGE || (feishuBitableConfigured ? 'feishu' : 'local'),
    feishu: {
      appId: env.FEISHU_APP_ID || '',
      appSecret: env.FEISHU_APP_SECRET || '',
      chatId: env.FEISHU_CHAT_ID || '',
      bitableAppToken: env.FEISHU_BITABLE_APP_TOKEN || '',
      tables: {
        boards: env.FEISHU_BOARDS_TABLE_ID || '',
        reservations: env.FEISHU_RESERVATIONS_TABLE_ID || '',
        returnRequests: env.FEISHU_RETURN_REQUESTS_TABLE_ID || '',
        admins: env.FEISHU_ADMINS_TABLE_ID || '',
      },
    },
  };
}
