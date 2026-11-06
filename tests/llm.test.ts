// AI 两处功能的测试：用脚本化的假 LLM，验证"只给建议 + 服务端校验 + 失败降级"。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { and, eq, isNull } from 'drizzle-orm';
import type { DbHandle } from '@/db/client';
import { attendance, followUpTasks, scheduleSuggestions } from '@/db/schema';
import type { CreateParams, LlmClient } from '@/server/llm/client';
import { MAX_ROUNDS, requestScheduleSuggestion } from '@/server/llm/scheduling';
import { processSessionFeedback } from '@/server/llm/feedback';
import { enrollStudent } from '@/server/services/enrollment';
import { markAttendance } from '@/server/services/attendance';
import { at, balanceOf, createTestDb, expectCode, makeClass, makeEnrollment, makeSession, makeStudent, makeUser, TUESDAY } from './helpers';

let h: DbHandle;
beforeAll(async () => {
  h = await createTestDb();
});
afterAll(async () => {
  await h.close();
});

const now = at(TUESDAY, '09:00');

function message(content: unknown[]): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'fake',
    content,
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  } as unknown as Anthropic.Message;
}
const toolUse = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input });

/** 按顺序返回预设回复，并记录每次请求 */
function scripted(replies: ((p: CreateParams) => Anthropic.Message)[]): LlmClient & { calls: CreateParams[] } {
  const calls: CreateParams[] = [];
  return {
    model: 'fake-model',
    calls,
    async create(params) {
      calls.push(JSON.parse(JSON.stringify(params)));
      const next = replies[Math.min(calls.length - 1, replies.length - 1)];
      return next(params);
    },
  };
}

async function schedulingFixture() {
  const admin = await makeUser(h.db, 'admin');
  const ts = await Promise.all([1, 2, 3, 4, 5].map(() => makeUser(h.db, 'teacher')));
  const math = await makeClass(h.db, { teacherId: ts[0].id, weekday: 2, start: '16:00', end: '17:00', subject: '数学', name: '数学提高' });
  const engConflict = await makeClass(h.db, { teacherId: ts[1].id, weekday: 2, start: '16:00', end: '17:00', subject: '英语', name: '英语基础A' });
  const engSameDay = await makeClass(h.db, { teacherId: ts[2].id, weekday: 2, start: '17:30', end: '18:30', subject: '英语', name: '英语基础B' });
  const engThu = await makeClass(h.db, { teacherId: ts[3].id, weekday: 4, start: '16:00', end: '17:00', subject: '英语', name: '英语基础C' });
  const engSatFull = await makeClass(h.db, { teacherId: ts[4].id, weekday: 6, start: '10:00', end: '11:00', subject: '英语', name: '英语提高', capacity: 1 });
  const st = await makeStudent(h.db, admin, { name: '张悦' });
  await makeEnrollment(h.db, st.id, math.id, admin.id);
  const filler = await makeStudent(h.db, admin);
  await makeEnrollment(h.db, filler.id, engSatFull.id, admin.id);
  return { admin, st, math, engConflict, engSameDay, engThu, engSatFull };
}

describe('AI 排班助手', () => {
  it('通过只读工具查询，丢弃违反规则的方案，确认后走正常排班接口', async () => {
    const f = await schedulingFixture();
    const llm = scripted([
      () =>
        message([
          { type: 'text', text: '先看看学生和候选班级' },
          toolUse('t1', 'get_student_profile', {}),
          toolUse('t2', 'list_class_options', { subject: '英语' }),
        ]),
      () =>
        message([
          toolUse('t3', 'submit_proposals', {
            summary: '推荐周二 17:30，和数学同一天',
            proposals: [
              // 冲突的班：服务端校验会丢掉
              { classId: f.engConflict.id, reasons: ['和数学同一天'], unmetPreferences: [] },
              { classId: f.engSameDay.id, reasons: ['工作日', '和数学同一天'], unmetPreferences: [] },
              { classId: f.engThu.id, reasons: ['工作日'], unmetPreferences: ['不是同一天'] },
              { classId: f.engSatFull.id, reasons: [], unmetPreferences: [] },
            ],
          }),
        ]),
    ]);

    const res = await requestScheduleSuggestion(
      h.db,
      f.admin,
      { studentId: f.st.id, request: '想加英语，避开周末，最好和数学同一天', subject: '英语' },
      llm,
      now,
    );
    expect(res.status).toBe('ready');
    expect(res.proposals.map((p) => p.classId)).toEqual([f.engSameDay.id, f.engThu.id]);

    // 只给了只读工具 + 提交工具
    const toolNames = (llm.calls[0].tools as { name: string }[]).map((t) => t.name).sort();
    expect(toolNames).toEqual(['check_enrollment', 'find_student', 'get_student_profile', 'list_class_options', 'submit_proposals']);
    // 第二轮请求里带着工具结果，其中冲突班级已由规则代码标为 ok=false
    const lastMsg = llm.calls[1].messages.at(-1)!;
    const results = lastMsg.content as { type: string; content: string }[];
    const options = JSON.parse(results[1].content) as { classId: number; ok: boolean; reasons: string[] }[];
    expect(options.find((o) => o.classId === f.engConflict.id)!.ok).toBe(false);
    expect(options.find((o) => o.classId === f.engConflict.id)!.reasons[0]).toContain('时间冲突');

    // admin 确认：走正常排班接口，带上建议 id 留痕
    await enrollStudent(h.db, f.admin, { studentId: f.st.id, classId: f.engSameDay.id, suggestionId: res.suggestionId }, now);
    const [sug] = await h.db.select().from(scheduleSuggestions).where(eq(scheduleSuggestions.id, res.suggestionId));
    expect(sug.status).toBe('accepted');
    expect(sug.acceptedClassId).toBe(f.engSameDay.id);
  });

  it('确认时重新检查全部规则：建议生成后班级满了就拒绝', async () => {
    const f = await schedulingFixture();
    const llm = scripted([
      () => message([toolUse('t1', 'submit_proposals', { summary: '', proposals: [{ classId: f.engThu.id, reasons: [], unmetPreferences: [] }] })]),
    ]);
    const res = await requestScheduleSuggestion(h.db, f.admin, { studentId: f.st.id, request: '英语', subject: '英语' }, llm, now);
    expect(res.status).toBe('ready');
    // 期间别人把班排满了
    const others = await Promise.all(Array.from({ length: 8 }, () => makeStudent(h.db, f.admin)));
    for (const o of others) await makeEnrollment(h.db, o.id, f.engThu.id, f.admin.id);
    await expectCode(
      enrollStudent(h.db, f.admin, { studentId: f.st.id, classId: f.engThu.id, suggestionId: res.suggestionId }, now),
      'CLASS_FULL',
    );
  });

  it('降级：没配置 AI / AI 报错 / 格式不对 / 没有有效方案 / 轮数用完，都返回候选班级列表', async () => {
    const f = await schedulingFixture();
    const input = { studentId: f.st.id, request: '英语', subject: '英语' };

    const none = await requestScheduleSuggestion(h.db, f.admin, input, null, now);
    expect(none.status).toBe('failed');
    expect(none.options.length).toBeGreaterThan(0);

    const boom = scripted([
      () => {
        throw new Error('network down');
      },
    ]);
    const r1 = await requestScheduleSuggestion(h.db, f.admin, input, boom, now);
    expect(r1.status).toBe('failed');
    expect(r1.error).toContain('network down');
    expect(r1.options.length).toBeGreaterThan(0);

    const bad = scripted([() => message([toolUse('x', 'submit_proposals', { proposals: 'oops' })])]);
    expect((await requestScheduleSuggestion(h.db, f.admin, input, bad, now)).status).toBe('failed');

    const invalid = scripted([
      () => message([toolUse('x', 'submit_proposals', { summary: '', proposals: [{ classId: f.engConflict.id, reasons: [], unmetPreferences: [] }] })]),
    ]);
    const r3 = await requestScheduleSuggestion(h.db, f.admin, input, invalid, now);
    expect(r3.status).toBe('failed');
    expect(r3.error).toBe('AI 没有给出有效方案');

    const loop = scripted([() => message([toolUse('y', 'get_student_profile', {})])]);
    const r4 = await requestScheduleSuggestion(h.db, f.admin, input, loop, now);
    expect(r4.status).toBe('failed');
    expect(loop.calls).toHaveLength(MAX_ROUNDS);
  });

  it('规则 16：只有负责 admin 能请求 AI 建议', async () => {
    const f = await schedulingFixture();
    const other = await makeUser(h.db, 'admin');
    await expectCode(requestScheduleSuggestion(h.db, other, { studentId: f.st.id, request: '英语' }, null, now), 'FORBIDDEN');
  });
});

describe('AI 课后反馈整理', () => {
  async function fixture() {
    const admin = await makeUser(h.db, 'admin');
    const teacher = await makeUser(h.db, 'teacher');
    const cls = await makeClass(h.db, { teacherId: teacher.id, weekday: 2, start: '16:00', end: '17:00' });
    const a = await makeStudent(h.db, admin, { name: '周舟' });
    const b = await makeStudent(h.db, admin, { name: '陈晨' });
    await makeEnrollment(h.db, a.id, cls.id, admin.id);
    await makeEnrollment(h.db, b.id, cls.id, admin.id);
    const session = await makeSession(h.db, cls, TUESDAY);
    await markAttendance(
      h.db,
      teacher,
      session.id,
      [
        { studentId: a.id, status: 'present', feedback: '最近注意力很差，说不想学了' },
        { studentId: b.id, status: 'present', feedback: '表现很好' },
      ],
      at(TUESDAY, '16:30'),
    );
    return { admin, a, b, session };
  }

  it('结构化结果写回出勤记录；只接受名单内学生；需要跟进的生成待办', async () => {
    const f = await fixture();
    const llm = scripted([
      () =>
        message([
          toolUse('f1', 'submit_feedback', {
            students: [
              { studentId: f.a.id, engagement: 'low', parentSummary: '本周状态有些波动', concerns: ['注意力'], needsAdminFollowUp: true, followUpReason: '提到不想学' },
              { studentId: 999999, engagement: 'high', parentSummary: '编造的学生', concerns: [], needsAdminFollowUp: true, followUpReason: 'x' },
            ],
          }),
        ]),
    ]);
    const r = await processSessionFeedback(h.db, f.session.id, llm, at(TUESDAY, '16:31'));
    expect(r).toEqual({ status: 'ok', processed: 1 });
    const rows = await h.db.select().from(attendance).where(eq(attendance.sessionId, f.session.id));
    const ra = rows.find((x) => x.studentId === f.a.id)!;
    const rb = rows.find((x) => x.studentId === f.b.id)!;
    expect(ra.llmStatus).toBe('ok');
    expect((ra.feedbackJson as { engagement: string }).engagement).toBe('low');
    expect(rb.llmStatus).toBe('failed'); // 模型漏掉的学生
    expect(rb.feedbackRaw).toBe('表现很好'); // 原文保留
    const tasks = await h.db
      .select()
      .from(followUpTasks)
      .where(and(eq(followUpTasks.studentId, f.a.id), eq(followUpTasks.type, 'teacher_flag'), isNull(followUpTasks.doneAt)));
    expect(tasks).toHaveLength(1);
    expect(tasks[0].adminId).toBe(f.admin.id);
  });

  it('AI 失败时只标记失败，点名和扣课时不受影响', async () => {
    const f = await fixture();
    const boom = scripted([
      () => {
        throw new Error('timeout');
      },
    ]);
    const r = await processSessionFeedback(h.db, f.session.id, boom);
    expect(r.status).toBe('failed');
    const rows = await h.db.select().from(attendance).where(eq(attendance.sessionId, f.session.id));
    expect(rows.every((x) => x.llmStatus === 'failed' && x.billing === 'charged')).toBe(true);
    expect((await balanceOf(h.db, f.a.id)).remainingHours).toBe(9);
    // 没配置 AI 同样降级
    expect((await processSessionFeedback(h.db, f.session.id, null)).status).toBe('skipped');
  });
});
