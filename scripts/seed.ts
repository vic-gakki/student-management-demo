// 演示数据：10 个 admin、20 个老师、约 60 个周班、约 300 个学生，以及一组刻意构造的演示场景。
// 运行前会清空数据库。所有日期相对"今天（墨尔本）"生成，任何时候运行都能演示。
// 测试账号统一密码见 DEMO_PASSWORD（只用于本地演示数据）。
import fs from 'node:fs';
import { sql } from 'drizzle-orm';
import { migrate, openPglite, openPostgres, PGLITE_DIR, type Db } from '../src/db/client';
import * as s from '../src/db/schema';
import { hashPassword } from '../src/server/auth';
import { addDays, isoWeekday, melbourneDate, melbourneDateTime, nextWeekdayOnOrAfter, timesOverlap, weekStart } from '../src/lib/time';

export const DEMO_PASSWORD = 'demo1234';

// ── 确定性随机数，保证每次生成的数据一样 ──
let rngState = 20261106;
function rand() {
  rngState = (rngState * 1664525 + 1013904223) % 4294967296;
  return rngState / 4294967296;
}
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];
const chance = (p: number) => rand() < p;

const SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾萧田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈'.split('');
const GIVEN = ['子涵', '欣怡', '梓轩', '雨桐', '浩然', '诗涵', '宇航', '思琪', '俊杰', '可馨', '一诺', '若曦', '天佑', '嘉怡', '明轩', '佳琪', '博文', '雅婷', '子墨', '晨曦', '梓萱', '皓轩', '语嫣', '沐阳', '安琪', '泽宇', '心怡', '奕辰', '梦瑶', '俊熙'];
const GRADES = ['三年级', '四年级', '五年级', '六年级', '七年级', '八年级'];
const SUBJECTS = ['数学', '英语', '物理', '编程'] as const;
const LEVELS = ['基础', '提高', '冲刺'] as const;
const SLOT_TYPES: { weekday: number; start: string; end: string }[] = [];
for (let wd = 1; wd <= 5; wd++)
  for (const [a, b] of [['16:00', '17:00'], ['17:30', '18:30'], ['19:00', '20:00']]) SLOT_TYPES.push({ weekday: wd, start: a, end: b });
for (let wd = 6; wd <= 7; wd++)
  for (const [a, b] of [['09:00', '10:00'], ['10:30', '11:30'], ['14:00', '15:00']]) SLOT_TYPES.push({ weekday: wd, start: a, end: b });

const usedNames = new Set<string>();
function personName() {
  for (;;) {
    const n = pick(SURNAMES) + pick(GIVEN);
    if (!usedNames.has(n)) {
      usedNames.add(n);
      return n;
    }
  }
}

async function open() {
  if (process.env.DATABASE_URL) {
    const h = openPostgres(process.env.DATABASE_URL);
    await h.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    return h;
  }
  fs.rmSync(PGLITE_DIR, { recursive: true, force: true });
  return openPglite(PGLITE_DIR);
}

type ClassRow = typeof s.classes.$inferSelect;

async function main() {
  const handle = await open();
  await migrate(handle);
  const db: Db = handle.db;
  const now = new Date();
  const today = melbourneDate(now);
  const todayWd = isoWeekday(today);
  const pw = await hashPassword(DEMO_PASSWORD);

  // ── 用户 ──
  const adminNames = ['王敏', '李娜', '张伟', '刘洋', '陈静', '杨帆', '黄蕾', '赵磊', '吴婷', '周杰'];
  const admins = await db
    .insert(s.users)
    .values(adminNames.map((n, i) => ({ email: `admin${i + 1}@school.test`, passwordHash: pw, name: `${n}（顾问）`, role: 'admin' as const })))
    .returning();
  const teachers = await db
    .insert(s.users)
    .values(Array.from({ length: 20 }, (_, i) => ({ email: `teacher${i + 1}@school.test`, passwordHash: pw, name: `${personName()}老师`, role: 'teacher' as const })))
    .returning();
  const [A1, A2] = admins;
  const T = teachers;

  // ── 试听内容 ──
  const templates = await db
    .insert(s.trialTemplates)
    .values(
      SUBJECTS.map((sub) => ({
        subject: sub,
        level: '通用',
        title: `${sub}体验课`,
        outline: `${sub}固定试听内容：10 分钟水平小测 + 25 分钟示范课 + 10 分钟与家长沟通学习建议`,
        durationMin: 45,
      })),
    )
    .returning();
  const tplBy = new Map(templates.map((t) => [t.subject, t]));

  // ── 班级 ──
  const termStart = addDays(today, -70);
  const teacherSlots = new Map<number, { weekday: number; start: string; end: string }[]>();
  const classValues: (typeof s.classes.$inferInsert)[] = [];
  const addClass = (teacherIdx: number, name: string, subject: string, level: string, weekday: number, start: string, end: string, capacity: number) => {
    const t = T[teacherIdx];
    const used = teacherSlots.get(t.id) ?? [];
    if (used.some((u) => u.weekday === weekday && timesOverlap(u.start, u.end, start, end))) return false;
    used.push({ weekday, start, end });
    teacherSlots.set(t.id, used);
    classValues.push({ name, subject, level, teacherId: t.id, weekday, startTime: start, endTime: end, capacity, startsOn: termStart });
    return true;
  };
  // 演示用的固定班级（与 DESIGN.md 草图一致）
  addClass(0, '数学提高（今日演示班）', '数学', '提高', todayWd, '09:00', '10:00', 8);
  addClass(1, '数学提高', '数学', '提高', 2, '16:00', '17:00', 8);
  addClass(2, '英语基础B', '英语', '基础', 2, '17:30', '18:30', 8);
  addClass(3, '英语基础A', '英语', '基础', 2, '16:00', '17:00', 8);
  addClass(4, '英语提高', '英语', '提高', 6, '10:30', '11:30', 4);
  addClass(5, '英语基础C', '英语', '基础', 4, '16:00', '17:00', 8);
  // 其余班级：每个老师凑到 3 个班
  for (let i = 0; i < T.length; i++) {
    let k = 0;
    while ((teacherSlots.get(T[i].id)?.length ?? 0) < 3 && k < 50) {
      const slot = SLOT_TYPES[(i * 7 + k * 5) % SLOT_TYPES.length];
      const subject = SUBJECTS[(i + k) % SUBJECTS.length];
      const level = LEVELS[(i * 3 + k) % LEVELS.length];
      addClass(i, `${subject}${level}`, subject, level, slot.weekday, slot.start, slot.end, 8 + ((i + k) % 3));
      k++;
    }
  }
  const classRows = await db.insert(s.classes).values(classValues).returning();
  const classByName = (n: string) => classRows.find((c) => c.name === n)!;
  const demoToday = classByName('数学提高（今日演示班）');
  const mathTue = classByName('数学提高');
  const engB = classByName('英语基础B');
  const engSat = classByName('英语提高');

  // ── 课次：过去 4 周 + 未来 4 周 ──
  const sessionValues: (typeof s.classSessions.$inferInsert)[] = [];
  for (const c of classRows) {
    let d = nextWeekdayOnOrAfter(addDays(today, -28), c.weekday);
    while (d <= addDays(today, 28)) {
      const startsAt = melbourneDateTime(d, c.startTime);
      sessionValues.push({
        classId: c.id,
        startsAt,
        endsAt: melbourneDateTime(d, c.endTime),
        status: startsAt.getTime() < now.getTime() && d < today ? 'done' : 'scheduled',
      });
      d = addDays(d, 7);
    }
  }
  const sessions = await db.insert(s.classSessions).values(sessionValues).returning();
  const sessionsByClass = new Map<number, typeof sessions>();
  for (const se of sessions) sessionsByClass.set(se.classId, [...(sessionsByClass.get(se.classId) ?? []), se]);

  // ── 学生 ──
  interface Plan {
    name: string;
    owner: (typeof admins)[number];
    status: s.StudentStatus;
    grade: string;
    hours: number; // 购买的课时
    enroll: { cls: ClassRow; start: string }[];
    createdAt: Date;
    subjects: { subject: string; status: 'inquiry' | 'trial' | 'active' | 'stopped' }[];
    notes?: string;
    lostReason?: string;
    availability?: { weekday: number; fromTime: string; toTime: string }[];
    attendRate?: number;
  }
  const plans: Plan[] = [];
  const enrolledCount = new Map<number, number>();
  const studentSlots = new Map<string, { weekday: number; start: string; end: string }[]>();
  const tryEnroll = (p: Plan, cls: ClassRow, start: string) => {
    if ((enrolledCount.get(cls.id) ?? 0) >= cls.capacity) return false;
    const used = studentSlots.get(p.name) ?? [];
    if (used.some((u) => u.weekday === cls.weekday && timesOverlap(u.start, u.end, cls.startTime, cls.endTime))) return false;
    if (p.enroll.some((e) => e.cls.subject === cls.subject)) return false;
    used.push({ weekday: cls.weekday, start: cls.startTime, end: cls.endTime });
    studentSlots.set(p.name, used);
    enrolledCount.set(cls.id, (enrolledCount.get(cls.id) ?? 0) + 1);
    p.enroll.push({ cls, start });
    return true;
  };
  const daysAgo = (n: number) => new Date(now.getTime() - n * 864e5);
  const base = (name: string, owner: (typeof admins)[number], status: s.StudentStatus, hours: number): Plan => ({
    name,
    owner,
    status,
    grade: pick(GRADES),
    hours,
    enroll: [],
    createdAt: daysAgo(60 + Math.floor(rand() * 60)),
    subjects: [],
    attendRate: 0.92,
  });

  // 演示学生（负责人：admin1 王敏）
  for (const n of ['张悦', '王小明', '刘洋', '赵一', '李明', '周舟', '陈晨', '孙琪', '吴桐']) usedNames.add(n);
  const zhangYue = base('张悦', A1, 'enrolled', 3);
  zhangYue.grade = '五年级';
  zhangYue.subjects = [{ subject: '数学', status: 'active' }, { subject: '英语', status: 'inquiry' }];
  zhangYue.availability = [
    { weekday: 2, fromTime: '15:30', toTime: '19:00' },
    { weekday: 4, fromTime: '15:30', toTime: '19:00' },
  ];
  zhangYue.notes = '妈妈希望周末留给游泳课；想加英语';
  zhangYue.attendRate = 1;
  tryEnroll(zhangYue, mathTue, addDays(today, -35));
  // 张悦：买了 3 节，过去 4 周每周都来上课 → 余额 0、欠 1 节（见下方模拟）
  plans.push(zhangYue);

  const wangXiaoming = base('王小明', A2, 'enrolled', 20);
  wangXiaoming.subjects = [{ subject: '英语', status: 'active' }];
  tryEnroll(wangXiaoming, engB, addDays(today, -35));
  plans.push(wangXiaoming);

  const liuYang = base('刘洋', A1, 'enrolled', 5);
  liuYang.attendRate = 1;
  plans.push(liuYang);
  const zhaoYi = base('赵一', A1, 'enrolled', 7);
  zhaoYi.attendRate = 1;
  plans.push(zhaoYi);

  const chenChen = base('陈晨', A1, 'enrolled', 20);
  chenChen.subjects = [{ subject: '数学', status: 'active' }];
  tryEnroll(chenChen, demoToday, weekStart(today));
  plans.push(chenChen);

  const sunQi = base('孙琪', A1, 'enrolled', 4);
  sunQi.attendRate = 1;
  tryEnroll(sunQi, demoToday, addDays(today, -28));
  plans.push(sunQi);

  const liMing = base('李明', A1, 'trial', 0);
  liMing.subjects = [{ subject: '数学', status: 'trial' }];
  liMing.createdAt = daysAgo(8);
  plans.push(liMing);
  const zhouZhou = base('周舟', A1, 'lead', 0);
  zhouZhou.subjects = [{ subject: '英语', status: 'inquiry' }];
  zhouZhou.createdAt = daysAgo(5);
  zhouZhou.notes = '家长微信咨询，想了解英语提高班';
  plans.push(zhouZhou);
  const wuTong = base('吴桐', A1, 'trial', 0);
  wuTong.subjects = [{ subject: '数学', status: 'trial' }];
  wuTong.createdAt = daysAgo(2);
  plans.push(wuTong);

  // 把英语提高（周六）排满，用于演示"已满"
  for (let i = 0; i < engSat.capacity; i++) {
    const p = base(personName(), admins[2 + (i % 8)], 'enrolled', 20);
    p.subjects = [{ subject: '英语', status: 'active' }];
    tryEnroll(p, engSat, addDays(today, -35));
    plans.push(p);
  }
  // 今日演示班再填几个人
  for (let i = 0; i < 4; i++) {
    const p = base(personName(), admins[(i % 9) + 1], 'enrolled', 20);
    p.subjects = [{ subject: '数学', status: 'active' }];
    tryEnroll(p, demoToday, addDays(today, -35));
    plans.push(p);
  }

  // 其余学生：每个 admin 补到约 30 人
  // 随机学生不进演示用的固定班，保证"冲突""已满"等演示效果稳定
  const engA = classByName('英语基础A');
  const regularClasses = classRows.filter((c) => ![demoToday.id, engSat.id, engA.id].includes(c.id));
  for (const admin of admins) {
    let count = plans.filter((p) => p.owner.id === admin.id).length;
    while (count < 30) {
      const r = rand();
      const status: s.StudentStatus = r < 0.76 ? 'enrolled' : r < 0.84 ? 'lead' : r < 0.92 ? 'trial' : 'churned';
      const p = base(personName(), admin, status, status === 'enrolled' ? pick([10, 20, 20, 30]) : 0);
      if (status === 'enrolled') {
        const want = chance(0.35) ? 2 : 1;
        for (let tries = 0; tries < 20 && p.enroll.length < want; tries++) {
          const start = chance(0.08) ? weekStart(today) : addDays(today, -35 - Math.floor(rand() * 20));
          tryEnroll(p, pick(regularClasses), start);
        }
        if (p.enroll.length === 0) p.status = 'paused';
        p.subjects = p.enroll.map((e) => ({ subject: e.cls.subject, status: 'active' as const }));
      } else {
        p.subjects = [{ subject: pick(SUBJECTS), status: status === 'churned' ? 'stopped' : status === 'trial' ? 'trial' : 'inquiry' }];
        p.createdAt = daysAgo(status === 'lead' ? Math.floor(rand() * 3) : 3 + Math.floor(rand() * 20));
        if (status === 'churned') p.lostReason = pick(['价格', '时间不合适', '选择了其他机构']);
      }
      plans.push(p);
      count++;
    }
  }
  // 刘洋、赵一也要有班
  for (const p of [liuYang, zhaoYi]) {
    for (let tries = 0; tries < 30 && p.enroll.length === 0; tries++) tryEnroll(p, pick(regularClasses), addDays(today, -35));
    p.subjects = p.enroll.map((e) => ({ subject: e.cls.subject, status: 'active' as const }));
  }

  // ── 写入学生、家长、科目、可用时间 ──
  const studentRows = await db
    .insert(s.students)
    .values(plans.map((p) => ({ name: p.name, grade: p.grade, status: p.status, ownerAdminId: p.owner.id, notes: p.notes ?? null, lostReason: p.lostReason ?? null, createdAt: p.createdAt })))
    .returning();
  const idOf = new Map(studentRows.map((r, i) => [plans[i], r.id]));
  const guardianRows = await db
    .insert(s.guardians)
    .values(plans.map((p) => ({ name: `${p.name[0]}${pick(['女士', '先生'])}`, phone: `04${String(Math.floor(rand() * 1e8)).padStart(8, '0')}`, wechat: null })))
    .returning();
  await db.insert(s.studentGuardians).values(plans.map((p, i) => ({ studentId: idOf.get(p)!, guardianId: guardianRows[i].id, relation: pick(['妈妈', '爸爸']), isPrimary: true })));
  await db.insert(s.studentOwnerHistory).values(plans.map((p) => ({ studentId: idOf.get(p)!, toAdmin: p.owner.id, reason: '咨询登记', at: p.createdAt })));
  const subjectRows = plans.flatMap((p) => p.subjects.map((sub) => ({ studentId: idOf.get(p)!, subject: sub.subject, status: sub.status })));
  if (subjectRows.length) await db.insert(s.studentSubjects).values(subjectRows).onConflictDoNothing();
  const availRows = plans.flatMap((p) => (p.availability ?? []).map((a) => ({ studentId: idOf.get(p)!, ...a })));
  if (availRows.length) await db.insert(s.studentAvailability).values(availRows);

  // ── 报名 ──
  const enrollRows = plans.flatMap((p) => p.enroll.map((e) => ({ studentId: idOf.get(p)!, classId: e.cls.id, startDate: e.start, createdBy: p.owner.id, createdAt: daysAgo(40) })));
  await db.insert(s.enrollments).values(enrollRows);

  // ── 课时包、出勤与流水（在内存里按时间顺序模拟，保证余额 = 流水之和） ──
  // 先在内存里算好所有行，再批量写入（远程数据库逐条插入要几千次往返）
  let payRef = 1000;
  const balances: { studentId: number; remainingHours: number; owedHours: number }[] = [];
  const pkgValues: (typeof s.lessonPackages.$inferInsert)[] = [];
  const attValues: (typeof s.attendance.$inferInsert)[] = [];
  const attCharged: boolean[] = []; // 与 attValues 一一对应：是否需要写扣课流水
  const owedTasks: (typeof s.followUpTasks.$inferInsert)[] = [];
  for (const p of plans) {
    const sid = idOf.get(p)!;
    let remaining = 0;
    let owed = 0;
    if (p.hours > 0) {
      pkgValues.push({ studentId: sid, hours: p.hours, priceCents: p.hours * 4500, paymentMethod: pick(['转账', '刷卡']), paymentRef: `DEMO-${payRef++}`, purchasedAt: daysAgo(45), createdBy: p.owner.id });
      remaining = p.hours;
    }
    // 过去的课次（今天之前）
    const past = p.enroll
      .flatMap((e) => (sessionsByClass.get(e.cls.id) ?? []).filter((se) => melbourneDate(se.startsAt) >= e.start && melbourneDate(se.startsAt) < today).map((se) => ({ se, cls: e.cls })))
      .sort((a, b) => a.se.startsAt.getTime() - b.se.startsAt.getTime());
    // 刘洋、赵一：没有班的模拟消耗，用固定课时数表示余额
    for (const { se, cls } of past) {
      const status: s.AttendanceStatus = chance(p.attendRate ?? 0.92) ? (chance(0.05) ? 'late' : 'present') : chance(0.6) ? 'excused' : 'absent';
      const chargeable = status !== 'excused';
      let billing: s.Billing = 'free';
      if (chargeable) {
        if (remaining > 0) billing = 'charged';
        else if (owed < 1) billing = 'owed';
        else continue; // 模拟里不让欠超过 1 节
      }
      const teacherId = cls.teacherId;
      const fb = chance(0.25) ? pick(['认真听讲，作业完成好', '这周有点走神', '进步明显，课堂积极', '计算粗心，需多练习', '状态不错']) : null;
      attValues.push({ sessionId: se.id, studentId: sid, status, billing, feedbackRaw: fb, llmStatus: 'none', markedBy: teacherId, markedAt: se.endsAt });
      attCharged.push(billing === 'charged');
      if (billing === 'charged') remaining--;
      else if (billing === 'owed') owed++;
    }
    if (owed > 0) {
      owedTasks.push({ studentId: sid, adminId: p.owner.id, type: 'owed_hours', note: '课时已用完，学生仍在上课（欠课），需尽快续费', dueAt: daysAgo(1), sourceRef: 'owed' });
    }
    balances.push({ studentId: sid, remainingHours: remaining, owedHours: owed });
  }

  const pkgRows = await db.insert(s.lessonPackages).values(pkgValues).returning();
  const pkgOf = new Map(pkgRows.map((r) => [r.studentId, r]));
  await db.insert(s.lessonLedger).values(
    pkgRows.map((r) => ({ studentId: r.studentId, packageId: r.id, delta: r.hours, reason: 'purchase' as const, createdBy: r.createdBy, createdAt: r.purchasedAt, note: `购买 ${r.hours} 节` })),
  );
  const CHUNK = 400;
  for (let i = 0; i < attValues.length; i += CHUNK) {
    const chunk = attValues.slice(i, i + CHUNK);
    const rows = await db.insert(s.attendance).values(chunk).returning({ id: s.attendance.id, studentId: s.attendance.studentId, markedBy: s.attendance.markedBy, markedAt: s.attendance.markedAt });
    const ledger = rows
      .filter((_, j) => attCharged[i + j])
      .map((a) => ({ studentId: a.studentId, packageId: pkgOf.get(a.studentId)?.id ?? null, delta: -1, reason: 'attendance' as const, attendanceId: a.id, createdBy: a.markedBy, createdAt: a.markedAt }));
    if (ledger.length) await db.insert(s.lessonLedger).values(ledger);
  }
  if (owedTasks.length) await db.insert(s.followUpTasks).values(owedTasks);
  // 刘洋 / 赵一 演示余额：直接按剩余 1 节 / 3 节调整（写调整流水，保证对账）
  for (const [p, target] of [[liuYang, 1], [zhaoYi, 3]] as const) {
    const b = balances.find((x) => x.studentId === idOf.get(p))!;
    if (b.remainingHours !== target) {
      await db.insert(s.lessonLedger).values({ studentId: b.studentId, delta: target - b.remainingHours, reason: 'adjustment', createdBy: p.owner.id, note: '演示数据：调整余额' });
      b.remainingHours = target;
    }
  }
  await db.insert(s.studentBalances).values(balances);

  // ── 试听 ──
  // 李明：3 天前试听已完成，跟进待办已逾期 1 天
  const [slotPast] = await db
    .insert(s.trialSlots)
    .values({ templateId: tplBy.get('数学')!.id, teacherId: T[6].id, startsAt: melbourneDateTime(addDays(today, -3), '12:00'), endsAt: melbourneDateTime(addDays(today, -3), '12:45'), capacity: 2, createdBy: A1.id })
    .returning();
  const [liMingTrial] = await db
    .insert(s.trialLessons)
    .values({ studentId: idOf.get(liMing)!, slotId: slotPast.id, subject: '数学', status: 'attended', feedback: '基础扎实，反应快', suggestedLevel: '提高', createdBy: A1.id })
    .returning();
  await db.insert(s.followUpTasks).values({ studentId: idOf.get(liMing)!, adminId: A1.id, type: 'trial_follow_up', note: '试听已完成（数学），请在 2 天内跟进', dueAt: daysAgo(1), sourceRef: `trial:${liMingTrial.id}` });

  // 吴桐：今天在 teacher1 的试听时段（今日演示）
  const [slotToday] = await db
    .insert(s.trialSlots)
    .values({ templateId: tplBy.get('数学')!.id, teacherId: T[0].id, startsAt: melbourneDateTime(today, '10:30'), endsAt: melbourneDateTime(today, '11:15'), capacity: 2, createdBy: A1.id })
    .returning();
  await db.insert(s.trialLessons).values({ studentId: idOf.get(wuTong)!, slotId: slotToday.id, subject: '数学', createdBy: A1.id });

  // 未来几天的试听时段（供"安排试听"选择）
  const futureSlots: (typeof s.trialSlots.$inferInsert)[] = [];
  for (let d = 1; d <= 6; d++) {
    const date = addDays(today, d);
    for (const [i, sub] of SUBJECTS.entries()) {
      const teacher = T[(d * 4 + i) % T.length];
      const busy = (teacherSlots.get(teacher.id) ?? []).some((u) => u.weekday === isoWeekday(date) && timesOverlap(u.start, u.end, '13:00', '13:45'));
      if (busy) continue;
      futureSlots.push({ templateId: tplBy.get(sub)!.id, teacherId: teacher.id, startsAt: melbourneDateTime(date, '13:00'), endsAt: melbourneDateTime(date, '13:45'), capacity: 3, createdBy: A1.id });
    }
  }
  await db.insert(s.trialSlots).values(futureSlots);

  // 其他试听状态的学生给一条已安排的试听，避免出现在"未安排试听"里
  const otherTrials = plans.filter((p) => p.status === 'trial' && p !== liMing && p !== wuTong);
  // seed 直接写库、绕过了服务层，所以这里要自己遵守人数上限：按剩余名额分配，没有名额的退回"咨询中"
  const slotRows = await db.select().from(s.trialSlots).where(sql`${s.trialSlots.startsAt} > now()`).orderBy(s.trialSlots.startsAt);
  const booked = new Map<number, number>();
  for (const p of otherTrials) {
    const sub = p.subjects[0].subject;
    const slot = slotRows.find((x) => x.templateId === tplBy.get(sub)!.id && (booked.get(x.id) ?? 0) < x.capacity);
    if (!slot) {
      await db.update(s.students).set({ status: 'lead' }).where(sql`${s.students.id} = ${idOf.get(p)!}`);
      continue;
    }
    booked.set(slot.id, (booked.get(slot.id) ?? 0) + 1);
    await db.insert(s.trialLessons).values({ studentId: idOf.get(p)!, slotId: slot.id, subject: sub, createdBy: p.owner.id });
  }

  // 校验：没有超员的试听时段
  const over = (await db.execute(
    sql`SELECT ts.id FROM trial_slots ts JOIN trial_lessons tl ON tl.slot_id = ts.id AND tl.status <> 'cancelled' GROUP BY ts.id, ts.capacity HAVING count(*) > ts.capacity`,
  )) as unknown as { rows: unknown[] };
  if (over.rows.length) throw new Error(`校验失败：${over.rows.length} 个试听时段超员`);

  // 对账：余额必须等于流水之和
  const mismatch = (await db.execute(
    sql`SELECT b.student_id FROM student_balances b LEFT JOIN (SELECT student_id, sum(delta) AS s FROM lesson_ledger GROUP BY student_id) l ON l.student_id = b.student_id WHERE b.remaining_hours <> coalesce(l.s, 0)`,
  )) as unknown as { rows: unknown[] };
  if (mismatch.rows.length) throw new Error(`对账失败：${mismatch.rows.length} 个学生余额与流水不一致`);

  const counts = (await db.execute(sql`SELECT (SELECT count(*) FROM students) AS students, (SELECT count(*) FROM classes) AS classes, (SELECT count(*) FROM class_sessions) AS sessions, (SELECT count(*) FROM attendance) AS attendance`)) as unknown as { rows: Record<string, unknown>[] };
  console.log('演示数据已生成：', counts.rows[0]);
  console.log(`今天（墨尔本）：${today}；teacher1 今日演示班 09:00，试听 10:30`);
  console.log(`登录账号：admin1@school.test / teacher1@school.test，密码 ${DEMO_PASSWORD}`);
  await handle.close();
}

await main();
