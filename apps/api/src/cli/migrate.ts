import { migrate } from '../db/migrate.js';
import { closeDb } from '../db/index.js';
import { env } from '../env.js';

const res = await migrate({ log: (m) => console.log(`[migrate] ${m}`) });
console.log(`[migrate] driver=${env.dbDriver} applied=${res.applied.length} skipped=${res.skipped.length}`);
await closeDb();
