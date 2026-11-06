import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import * as schema from './schema';

// 服务层只依赖这个类型；事务对象（tx）也满足它，所以服务函数可以互相嵌套调用。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;

export interface DbHandle {
  db: Db;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

/** 嵌入式 PostgreSQL（WASM）。不传目录时是纯内存库，测试用。 */
export async function openPglite(dataDir?: string): Promise<DbHandle> {
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  // 注意：第一个参数为 undefined 时 PGlite 会忽略第二个参数，所以统一用单个 options 对象
  const client = new PGlite({ dataDir, extensions: { btree_gist } });
  await client.waitReady;
  return {
    db: drizzlePglite(client, { schema }) as unknown as Db,
    exec: async (sql) => {
      await client.exec(sql);
    },
    close: () => client.close(),
  };
}

/** 真正的 PostgreSQL（本地 Docker / Neon）。 */
export function openPostgres(url: string): DbHandle {
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  return {
    db: drizzlePg(pool, { schema }) as unknown as Db,
    exec: async (sql) => {
      await pool.query(sql);
    },
    close: () => pool.end(),
  };
}

const MIGRATIONS_DIR = path.join(process.cwd(), 'db', 'migrations');

/** 按文件名顺序执行未执行过的 SQL 迁移。 */
export async function migrate(handle: DbHandle): Promise<string[]> {
  await handle.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const file of files) {
    const result = (await handle.db.execute(sql`SELECT name FROM _migrations WHERE name = ${file}`)) as unknown as {
      rows: unknown[];
    };
    if (result.rows.length > 0) continue;
    const content = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    await handle.exec(`BEGIN;\n${content}\nINSERT INTO _migrations(name) VALUES ('${file}');\nCOMMIT;`);
    applied.push(file);
  }
  return applied;
}

export const PGLITE_DIR = path.join(process.cwd(), '.data', 'pglite');

/** 根据环境打开数据库：有 DATABASE_URL 用 PostgreSQL，否则用本地 PGlite 文件库。 */
export async function openDefault(): Promise<DbHandle> {
  const url = process.env.DATABASE_URL;
  if (url) return openPostgres(url);
  const handle = await openPglite(PGLITE_DIR);
  // 本地嵌入式库自动迁移，省去一步；PostgreSQL 由 `pnpm db:migrate` 显式迁移
  await migrate(handle);
  return handle;
}

const g = globalThis as unknown as { __dbHandle?: Promise<DbHandle>; __testDb?: Db };

/** 应用内获取数据库（Next.js 开发模式下热更新也复用同一个连接）。 */
export async function getDb(): Promise<Db> {
  if (g.__testDb) return g.__testDb;
  if (!g.__dbHandle) g.__dbHandle = openDefault();
  return (await g.__dbHandle).db;
}

/** 测试时把 API 路由指向内存库。 */
export function setDbForTests(db: Db | undefined) {
  g.__testDb = db;
}
