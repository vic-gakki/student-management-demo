// 服务端组件里获取当前用户（页面级守卫用；接口级守卫在 http.ts）
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import type { Actor } from './actor';
import { actorFromToken, SESSION_COOKIE } from './auth';

export async function getCurrentActor(): Promise<Actor | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return actorFromToken(await getDb(), token);
}

export async function requirePageRole(role: Actor['role']): Promise<Actor> {
  const actor = await getCurrentActor();
  if (!actor) redirect('/login');
  if (actor.role !== role) redirect(actor.role === 'admin' ? '/admin' : '/teacher');
  return actor;
}
