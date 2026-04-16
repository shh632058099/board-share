import fs from 'node:fs/promises';
import path from 'node:path';
import { createDefaultState, normalizeState } from '../state.js';

export class LocalStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.queue = Promise.resolve();
  }

  async read() {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      return normalizeState(JSON.parse(content), { seedLocalAdmin: true });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      const state = createDefaultState({ seedLocalAdmin: true });
      await this.write(state);
      return state;
    }
  }

  async write(state) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const normalized = normalizeState(state, { seedLocalAdmin: true });
    const tmpPath = `${this.filePath}.tmp`;
    await fs.writeFile(tmpPath, `${JSON.stringify(normalized, null, 2)}
`, 'utf-8');
    await fs.rename(tmpPath, this.filePath);
  }

  async update(mutator) {
    const run = async () => {
      const state = await this.read();
      const result = await mutator(state);
      await this.write(state);
      return result;
    };

    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
