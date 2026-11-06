import { intParam, route } from '@/server/http';
import { restoreSession } from '@/server/services/session-admin';

/** 恢复上课 */
export const POST = route(async ({ db, actor, params }) => restoreSession(db, actor, intParam(params.id)), { roles: ['admin'] });
