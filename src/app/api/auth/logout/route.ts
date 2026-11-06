import type { NextRequest } from 'next/server';
import { getDb } from '@/db/client';
import { logout, SESSION_COOKIE } from '@/server/auth';
import { errorResponse, json } from '@/server/http';

export async function POST(req: NextRequest) {
  try {
    await logout(await getDb(), req.cookies.get(SESSION_COOKIE)?.value);
    const res = json({ ok: true });
    res.cookies.delete(SESSION_COOKIE);
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
