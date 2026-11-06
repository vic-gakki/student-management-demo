// 执行数据库迁移：有 DATABASE_URL 时迁移 PostgreSQL，否则迁移本地 PGlite
import { migrate, openPglite, openPostgres, PGLITE_DIR } from '../src/db/client';

const handle = process.env.DATABASE_URL ? openPostgres(process.env.DATABASE_URL) : await openPglite(PGLITE_DIR);
const applied = await migrate(handle);
console.log(applied.length ? `已执行迁移：${applied.join(', ')}` : '数据库已是最新');
await handle.close();
