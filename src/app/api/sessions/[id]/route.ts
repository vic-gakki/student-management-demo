import { intParam, route } from '@/server/http';
import { getRoster } from '@/server/services/attendance';
import { DomainError } from '@/server/errors';

/** 点名名单：老师只能看自己（或代课）的课；admin 可以查看 */
export const GET = route(async ({ db, actor, params }) => {
  const roster = await getRoster(db, intParam(params.id));
  const teacherId = roster.session.substituteTeacherId ?? roster.cls.teacherId;
  if (actor.role === 'teacher' && teacherId !== actor.id) throw new DomainError('FORBIDDEN', '只能查看自己的课');
  return roster;
});
