import { route } from '@/server/http';

export const GET = route(async ({ actor }) => ({ user: actor }));
