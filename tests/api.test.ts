// 绕过界面直接调 API：验证登录、角色权限和错误格式。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { setDbForTests, type DbHandle } from '@/db/client';
import { users } from '@/db/schema';
import { hashPassword } from '@/server/auth';
import { POST as loginPost } from '@/app/api/auth/login/route';
import { GET as meGet } from '@/app/api/me/route';
import { GET as dashboardGet } from '@/app/api/dashboard/route';
import { POST as enrollPost } from '@/app/api/enrollments/route';
import { POST as packagesPost } from '@/app/api/students/[id]/packages/route';
import { createTestDb, makeClass, makeStudent } from './helpers';

let h: DbHandle;
const BASE = 'http://localhost';

beforeAll(async () => {
  h = await createTestDb();
  setDbForTests(h.db);
  const pw = await hashPassword('test-pass');
  await h.db.insert(users).values([
    { email: 'a1@test.local', passwordHash: pw, name: '甲', role: 'admin' },
    { email: 'a2@test.local', passwordHash: pw, name: '乙', role: 'admin' },
    { email: 't1@test.local', passwordHash: pw, name: '丙', role: 'teacher' },
  ]);
});
afterAll(async () => {
  setDbForTests(undefined);
  await h.close();
});

const noParams = { params: Promise.resolve({}) };

async function loginAs(email: string) {
  const res = await loginPost(new NextRequest(`${BASE}/api/auth/login`, { method: 'POST', body: JSON.stringify({ email, password: 'test-pass' }) }));
  expect(res.status).toBe(200);
  const cookie = res.headers.get('set-cookie')!;
  expect(cookie).toContain('HttpOnly');
  return cookie.split(';')[0];
}

function req(path: string, cookie: string | null, init: { method?: string; body?: string } = {}) {
  return new NextRequest(`${BASE}${path}`, { ...init, headers: cookie ? { cookie } : {} });
}

describe('API 权限', () => {
  it('未登录 401；错误密码 401', async () => {
    const res = await meGet(req('/api/me', null), noParams);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
    const bad = await loginPost(new NextRequest(`${BASE}/api/auth/login`, { method: 'POST', body: JSON.stringify({ email: 'a1@test.local', password: 'nope' }) }));
    expect(bad.status).toBe(401);
  });

  it('老师访问 admin 接口 403', async () => {
    const cookie = await loginAs('t1@test.local');
    const res = await dashboardGet(req('/api/dashboard', cookie), noParams);
    expect(res.status).toBe(403);
  });

  it('admin2 绕过界面给 admin1 的学生排班 / 录入续费 → 403；非法 JSON → 400', async () => {
    const [a1] = await h.db.select().from(users).where((await import('drizzle-orm')).eq(users.email, 'a1@test.local'));
    const [t1] = await h.db.select().from(users).where((await import('drizzle-orm')).eq(users.email, 't1@test.local'));
    const st = await makeStudent(h.db, { id: a1.id, role: 'admin', name: a1.name });
    const cls = await makeClass(h.db, { teacherId: t1.id, weekday: 3, start: '16:00', end: '17:00' });
    const cookie2 = await loginAs('a2@test.local');

    const r1 = await enrollPost(req('/api/enrollments', cookie2, { method: 'POST', body: JSON.stringify({ studentId: st.id, classId: cls.id }) }), noParams);
    expect(r1.status).toBe(403);
    expect((await r1.json()).error.code).toBe('FORBIDDEN');

    const r2 = await packagesPost(
      req(`/api/students/${st.id}/packages`, cookie2, { method: 'POST', body: JSON.stringify({ hours: 10, priceCents: 1, paymentMethod: 'x', paymentRef: 'y' }) }),
      { params: Promise.resolve({ id: String(st.id) }) },
    );
    expect(r2.status).toBe(403);

    const r3 = await enrollPost(req('/api/enrollments', cookie2, { method: 'POST', body: '{not json' }), noParams);
    expect(r3.status).toBe(400);

    // 负责人可以
    const cookie1 = await loginAs('a1@test.local');
    const ok = await enrollPost(req('/api/enrollments', cookie1, { method: 'POST', body: JSON.stringify({ studentId: st.id, classId: cls.id }) }), noParams);
    expect(ok.status).toBe(200);
  });
});
