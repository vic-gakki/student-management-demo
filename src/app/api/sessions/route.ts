import { route, intParam } from '@/server/http';
import { listSessions } from '@/server/services/session-admin';
import { DomainError } from '@/server/errors';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 课次列表（admin）：?from=&to=&classId=&teacherId=，查询前会按需生成课次 */
export const GET = route(
  async ({ db, actor, req }) => {
    const sp = req.nextUrl.searchParams;
    const from = sp.get('from') ?? '';
    const to = sp.get('to') ?? '';
    if (!DATE.test(from) || !DATE.test(to)) throw new DomainError('VALIDATION', 'from / to 必须是 YYYY-MM-DD');
    return listSessions(db, actor, {
      from,
      to,
      classId: sp.get('classId') ? intParam(sp.get('classId')!, 'classId') : undefined,
      teacherId: sp.get('teacherId') ? intParam(sp.get('teacherId')!, 'teacherId') : undefined,
    });
  },
  { roles: ['admin'] },
);
