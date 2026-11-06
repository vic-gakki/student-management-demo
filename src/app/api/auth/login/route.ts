import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { login, SESSION_COOKIE } from '@/server/auth';
import { body, errorResponse, json } from '@/server/http';

const Schema = z.object({ email: z.string().min(1), password: z.string().min(1) });

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await body(req, Schema);
    const db = await getDb();
    const { token, expiresAt, actor } = await login(db, email, password);
    const res = json({ user: actor });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: expiresAt,
    });
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
