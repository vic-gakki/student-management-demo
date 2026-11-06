import { z } from 'zod';
import { body, route } from '@/server/http';
import { bookTrial } from '@/server/services/trials';

const Schema = z.object({ studentId: z.number().int().positive(), slotId: z.number().int().positive() });

/** 安排试听 */
export const POST = route(async ({ db, actor, req }) => bookTrial(db, actor, await body(req, Schema)), { roles: ['admin'] });
