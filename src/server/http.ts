// Route Handler 的统一包装：解析会话 → 角色检查 → 调用服务 → 错误映射。
// 路由文件因此很薄，业务规则全部在 services 里。
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import type { Actor } from './actor';
import { actorFromToken, SESSION_COOKIE } from './auth';
import { DomainError, mapDbError } from './errors';

type Params = Record<string, string>;

export interface HandlerCtx {
  req: NextRequest;
  db: Db;
  actor: Actor;
  params: Params;
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function errorResponse(err: unknown) {
  const de = err instanceof DomainError ? err : mapDbError(err);
  if (de) return json({ error: { code: de.code, message: de.message, details: de.details } }, de.status);
  if (err instanceof z.ZodError)
    return json({ error: { code: 'VALIDATION', message: '请求参数不正确', details: err.issues } }, 400);
  console.error(err);
  return json({ error: { code: 'INTERNAL', message: '服务器内部错误' } }, 500);
}

export function route(handler: (ctx: HandlerCtx) => Promise<unknown>, opts: { roles?: Actor['role'][] } = {}) {
  return async (req: NextRequest, context: { params: Promise<Params> }) => {
    try {
      const db = await getDb();
      const actor = await actorFromToken(db, req.cookies.get(SESSION_COOKIE)?.value);
      if (!actor) throw new DomainError('UNAUTHENTICATED', '请先登录');
      if (opts.roles && !opts.roles.includes(actor.role)) throw new DomainError('FORBIDDEN', '当前角色无权访问');
      const params = (await context?.params) ?? {};
      const result = await handler({ req, db, actor, params });
      return result instanceof Response ? result : json(result);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function body<T>(req: NextRequest, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new DomainError('VALIDATION', '请求体不是合法的 JSON');
  }
  return schema.parse(raw);
}

export function intParam(v: string | undefined, name = 'id'): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new DomainError('VALIDATION', `${name} 不正确`);
  return n;
}
