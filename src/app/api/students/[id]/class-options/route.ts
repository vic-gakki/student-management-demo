import { intParam, route } from '@/server/http';
import { listClassOptions } from '@/server/services/eligibility';
import { melbourneDate } from '@/lib/time';

export const GET = route(
  async ({ db, params, req }) => {
    const sp = req.nextUrl.searchParams;
    const exclude = sp.get('transferFrom');
    return listClassOptions(db, {
      studentId: intParam(params.id),
      subject: sp.get('subject') || undefined,
      today: melbourneDate(new Date()),
      excludeClassId: exclude ? intParam(exclude, 'transferFrom') : undefined,
    });
  },
  { roles: ['admin'] },
);
