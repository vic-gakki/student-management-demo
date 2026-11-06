import { intParam, route } from '@/server/http';
import { getTrialSlotRoster } from '@/server/services/trials';

export const GET = route(async ({ db, actor, params }) => getTrialSlotRoster(db, actor, intParam(params.id)));
