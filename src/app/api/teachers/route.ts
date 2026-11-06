import { eq } from 'drizzle-orm';
import { route } from '@/server/http';
import { users } from '@/db/schema';

export const GET = route(
  async ({ db }) => db.select({ id: users.id, name: users.name }).from(users).where(eq(users.role, 'teacher')).orderBy(users.name),
  { roles: ['admin'] },
);
