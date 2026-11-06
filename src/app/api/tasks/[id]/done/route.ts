import { intParam, route } from '@/server/http';
import { completeTask } from '@/server/services/students';

export const POST = route(async ({ db, actor, params }) => completeTask(db, actor, intParam(params.id)), { roles: ['admin'] });
