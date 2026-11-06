import { route } from '@/server/http';
import { listTrialSchedule } from '@/server/services/trials';
import { DomainError } from '@/server/errors';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 试听安排：?from=&to=&subject= */
export const GET = route(
  async ({ db, actor, req }) => {
    const sp = req.nextUrl.searchParams;
    const from = sp.get('from') ?? '';
    const to = sp.get('to') ?? '';
    if (!DATE.test(from) || !DATE.test(to)) throw new DomainError('VALIDATION', 'from / to 必须是 YYYY-MM-DD');
    return listTrialSchedule(db, actor, { from, to, subject: sp.get('subject') || undefined });
  },
  { roles: ['admin'] },
);
