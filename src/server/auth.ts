// 最小会话认证：users + sessions 表、bcrypt 密码、httpOnly cookie。
// 数据库只存 token 的 sha256，数据库泄露也拿不到可用的会话。
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { sessions, users } from '@/db/schema';
import type { Actor } from './actor';
import { DomainError } from './errors';

export const SESSION_COOKIE = 'sid';
const SESSION_DAYS = 7;

export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export async function login(db: Db, email: string, password: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
  // 用户不存在时也做一次比较，避免通过响应时间判断邮箱是否存在
  const ok = await bcrypt.compare(password, user?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
  if (!user || !ok) throw new DomainError('UNAUTHENTICATED', '邮箱或密码错误');
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);
  await db.insert(sessions).values({ id: sha256(token), userId: user.id, expiresAt });
  return { token, expiresAt, actor: { id: user.id, role: user.role, name: user.name } satisfies Actor };
}

export async function actorFromToken(db: Db, token: string | undefined | null): Promise<Actor | null> {
  if (!token) return null;
  const [row] = await db
    .select({ s: sessions, u: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sha256(token)));
  if (!row || row.s.expiresAt.getTime() < Date.now()) return null;
  return { id: row.u.id, role: row.u.role, name: row.u.name };
}

export async function logout(db: Db, token: string | undefined) {
  if (token) await db.delete(sessions).where(eq(sessions.id, sha256(token)));
}
