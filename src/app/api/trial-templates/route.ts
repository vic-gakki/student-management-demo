import { route } from '@/server/http';
import { listTrialTemplates } from '@/server/services/trials';

export const GET = route(async ({ db }) => listTrialTemplates(db), { roles: ['admin'] });
