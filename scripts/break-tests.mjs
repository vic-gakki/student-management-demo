// 按 break-tests.http 的顺序绕过界面打接口，打印状态码和错误码
// 用法：node scripts/break-tests.mjs [地址]，默认 http://localhost:3000；会修改数据，跑完请重新 seed
const base = process.argv[2] ?? 'http://localhost:3000';
let cookie = '';
async function call(label, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const data = await res.json().catch(() => ({}));
  console.log(`${label.padEnd(36)} ${res.status} ${data?.error?.code ?? ''} ${data?.settledOwed !== undefined ? 'settledOwed=' + data.settledOwed : ''}${data?.canEdit !== undefined ? 'canEdit=' + data.canEdit : ''}`);
}
const login = (email) => call(`login ${email}`, 'POST', '/api/auth/login', { email, password: 'demo1234' });

await call('0 未登录', 'GET', '/api/dashboard');
await login('admin2@school.test');
await call('2 admin2 查看张悦', 'GET', '/api/students/1');
await call('3 admin2 排班', 'POST', '/api/enrollments', { studentId: 1, classId: 3 });
await call('4 admin2 续费', 'POST', '/api/students/1/packages', { hours: 100, priceCents: 0, paymentMethod: '现金', paymentRef: 'HACK-1' });
await call('5 admin2 AI 建议', 'POST', '/api/students/1/schedule-suggestions', { request: '随便排' });
await login('admin1@school.test');
await call('6 余额 0 排班', 'POST', '/api/enrollments', { studentId: 1, classId: 3 });
await call('7 续费', 'POST', '/api/students/1/packages', { hours: 20, priceCents: 90000, paymentMethod: '转账', paymentRef: 'BREAK-001' });
await call('8 重复凭证号', 'POST', '/api/students/1/packages', { hours: 20, priceCents: 90000, paymentMethod: '转账', paymentRef: 'BREAK-001' });
await call('9 冲突班', 'POST', '/api/enrollments', { studentId: 1, classId: 4 });
await call('10 已满班', 'POST', '/api/enrollments', { studentId: 1, classId: 5 });
await call('11 过去日期', 'POST', '/api/enrollments', { studentId: 1, classId: 3, startDate: '2020-01-01' });
await call('12 咨询学生排正式班', 'POST', '/api/enrollments', { studentId: 8, classId: 3 });
await call('13 类型错误', 'POST', '/api/enrollments', { studentId: '1; DROP TABLE students', classId: 3 });
await login('teacher2@school.test');
await call('14 老师访问工作台', 'GET', '/api/dashboard');
await call('15 teacher2 点 teacher1 的课', 'POST', '/api/sessions/5/attendance', { entries: [{ studentId: 5, status: 'present' }] });
