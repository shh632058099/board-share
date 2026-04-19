import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeState } from '../src/state.js';
import { SQLiteStore } from '../src/store/sqliteStore.js';

function countState(state) {
  return {
    boards: state.boards.length,
    reservations: state.reservations.length,
    returnRequests: state.returnRequests.length,
    admins: state.admins.length,
  };
}

function sameCounts(left, right) {
  return Object.keys(left).every((key) => left[key] === right[key]);
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function removeSqliteFiles(sqliteFile) {
  await fs.rm(sqliteFile, { force: true });
  await fs.rm(`${sqliteFile}-wal`, { force: true });
  await fs.rm(`${sqliteFile}-shm`, { force: true });
}

async function main() {
  const force = process.argv.includes('--force');
  const dataFile = process.env.DATA_FILE || path.join(process.cwd(), 'data', 'share-board.json');
  const sqliteFile = process.env.SQLITE_FILE || path.join(process.cwd(), 'data', 'share-board.sqlite');

  if ((await exists(sqliteFile)) && !force) {
    throw new Error(`SQLite 文件已存在：${sqliteFile}。如需覆盖请添加 --force。`);
  }

  if (force) {
    await removeSqliteFiles(sqliteFile);
  }

  const raw = await fs.readFile(dataFile, 'utf-8');
  const sourceState = normalizeState(JSON.parse(raw), { seedLocalAdmin: true });
  const expectedCounts = countState(sourceState);

  const store = new SQLiteStore(sqliteFile);
  try {
    await store.write(sourceState);
    const migratedState = await store.read();
    const actualCounts = countState(migratedState);
    if (!sameCounts(expectedCounts, actualCounts)) {
      throw new Error(
        `迁移后数量不一致：expected=${JSON.stringify(expectedCounts)} actual=${JSON.stringify(actualCounts)}`,
      );
    }
    console.log(`已迁移 ${dataFile} -> ${sqliteFile}`);
    console.log(JSON.stringify(actualCounts, null, 2));
  } finally {
    store.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
