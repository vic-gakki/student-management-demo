import { intParam, route } from '@/server/http';
import { getStudentDetail } from '@/server/services/students';

export const GET = route(async ({ db, actor, params }) => getStudentDetail(db, actor, intParam(params.id)), { roles: ['admin'] });
