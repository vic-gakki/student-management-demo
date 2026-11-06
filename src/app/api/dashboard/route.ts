import { route } from '@/server/http';
import { getAdminDashboard } from '@/server/services/dashboard';

export const GET = route(async ({ db, actor }) => getAdminDashboard(db, actor), { roles: ['admin'] });
