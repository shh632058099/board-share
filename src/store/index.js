import { FeishuClient } from '../feishuClient.js';
import { FeishuBitableStore } from './feishuBitableStore.js';
import { LocalStore } from './localStore.js';
import { SQLiteStore } from './sqliteStore.js';

export function createStore(config, feishuClient = undefined) {
  if (config.storage === 'feishu') {
    const client = feishuClient || new FeishuClient(config.feishu);
    return new FeishuBitableStore(client, config);
  }
  if (config.storage === 'sqlite') {
    return new SQLiteStore(config.sqliteFile);
  }
  return new LocalStore(config.dataFile);
}
