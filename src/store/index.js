import { FeishuClient } from '../feishuClient.js';
import { FeishuBitableStore } from './feishuBitableStore.js';
import { LocalStore } from './localStore.js';

export function createStore(config, feishuClient = undefined) {
  if (config.storage === 'feishu') {
    const client = feishuClient || new FeishuClient(config.feishu);
    return new FeishuBitableStore(client, config);
  }
  return new LocalStore(config.dataFile);
}
