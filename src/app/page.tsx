import { redirect } from 'next/navigation';
import { getCurrentActor } from '@/server/session';

export const dynamic = 'force-dynamic';

/** 按角色进入各自首页：admin → 工作台，老师 → 今日课程 */
export default async function Home() {
  const actor = await getCurrentActor();
  if (!actor) redirect('/login');
  redirect(actor.role === 'admin' ? '/admin' : '/teacher');
}
