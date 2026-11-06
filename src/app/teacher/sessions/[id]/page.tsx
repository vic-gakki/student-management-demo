'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { melbourneTime } from '@/lib/time';
import { Badge, Button, Card, Empty, ErrorBox, inputCls, Loading } from '@/components/ui';

type Status = 'present' | 'late' | 'excused' | 'absent';
interface Roster {
  session: { id: number; startsAt: string; endsAt: string; status: string };
  cls: { name: string; subject: string };
  date: string;
  students: {
    studentId: number;
    name: string;
    grade: string | null;
    isNew: boolean;
    balanceFlag: 'ok' | 'low' | 'out' | 'owed';
    attendance: {
      status: Status;
      billing: string;
      feedbackRaw: string | null;
      feedbackJson: { engagement: string; parentSummary: string; concerns: string[]; needsAdminFollowUp: boolean } | null;
      llmStatus: 'none' | 'ok' | 'failed';
      needsFollowUp: boolean;
    } | null;
  }[];
}
interface MarkResult {
  results: { studentId: number; billing: string }[];
  feedback: { status: 'ok' | 'failed' | 'skipped'; processed: number; error?: string };
}

const STATUS_OPTIONS: [Status, string][] = [
  ['present', '出勤'],
  ['late', '迟到'],
  ['excused', '请假'],
  ['absent', '缺席'],
];

export default function RollCall({ params }: { params: Promise<{ id: string }> }) {
  const id = Number(use(params).id);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['session', id], queryFn: () => api<Roster>(`/api/sessions/${id}`) });
  const [marks, setMarks] = useState<Record<number, { status: Status; feedback: string; needsFollowUp: boolean }>>({});

  useEffect(() => {
    if (!q.data) return;
    setMarks(
      Object.fromEntries(
        q.data.students.map((s) => [
          s.studentId,
          { status: s.attendance?.status ?? 'present', feedback: s.attendance?.feedbackRaw ?? '', needsFollowUp: s.attendance?.needsFollowUp ?? false },
        ]),
      ),
    );
  }, [q.data]);

  const submit = useMutation({
    mutationFn: () =>
      api<MarkResult>(`/api/sessions/${id}/attendance`, {
        body: { entries: Object.entries(marks).map(([sid, m]) => ({ studentId: Number(sid), status: m.status, feedback: m.feedback || null, needsFollowUp: m.needsFollowUp })) },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['session', id] });
      qc.invalidateQueries({ queryKey: ['teacher-day'] });
    },
  });

  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data;
  const notStarted = new Date(r.session.startsAt) > new Date();
  const set = (sid: number, patch: Partial<(typeof marks)[number]>) => setMarks({ ...marks, [sid]: { ...marks[sid], ...patch } });

  return (
    <div className="space-y-4">
      <Link href="/teacher" className="text-sm text-slate-500 hover:underline">
        ← 今日课程
      </Link>
      <Card
        title={
          <span>
            {r.cls.name} · {r.date} {melbourneTime(new Date(r.session.startsAt))}–{melbourneTime(new Date(r.session.endsAt))} · {r.students.length} 人
          </span>
        }
        actions={
          <Button size="sm" variant="secondary" onClick={() => setMarks(Object.fromEntries(Object.entries(marks).map(([k, m]) => [k, { ...m, status: 'present' as Status }])))}>
            全部出勤
          </Button>
        }
      >
        {r.session.status === 'cancelled' && <p className="mb-3 rounded bg-slate-100 px-3 py-2 text-sm">这节课已停课，不需要点名。</p>}
        {notStarted && <p className="mb-3 rounded bg-yellow-50 px-3 py-2 text-sm text-yellow-800">课还没开始，开始后才能点名。</p>}
        {r.students.length === 0 ? (
          <Empty>这节课没有学生</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {r.students.map((s) => {
              const m = marks[s.studentId];
              if (!m) return null;
              return (
                <li key={s.studentId} className="py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="w-40">
                      <span className="font-medium">{s.name}</span>
                      <span className="ml-1 text-xs text-slate-400">{s.grade}</span>
                      <div className="mt-0.5 flex gap-1">
                        {s.isNew && <Badge tone="yellow">🆕 新生</Badge>}
                        {(s.balanceFlag === 'out' || s.balanceFlag === 'owed') && <Badge tone="red">⚠️ 课时已用完</Badge>}
                        {s.balanceFlag === 'low' && <Badge tone="orange">课时快用完</Badge>}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {STATUS_OPTIONS.map(([k, label]) => (
                        <button
                          key={k}
                          onClick={() => set(s.studentId, { status: k })}
                          className={`rounded px-2.5 py-1 text-sm ring-1 ${m.status === k ? (k === 'present' ? 'bg-emerald-600 text-white ring-emerald-600' : k === 'excused' ? 'bg-slate-600 text-white ring-slate-600' : 'bg-orange-600 text-white ring-orange-600') : 'ring-slate-300'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <input className={`${inputCls} min-w-48 flex-1`} placeholder="课堂反馈（选填，AI 会整理成给家长的一句话）" value={m.feedback} onChange={(e) => set(s.studentId, { feedback: e.target.value })} />
                    <label className="flex items-center gap-1 text-xs text-slate-600">
                      <input type="checkbox" checked={m.needsFollowUp} onChange={(e) => set(s.studentId, { needsFollowUp: e.target.checked })} />
                      需要顾问跟进
                    </label>
                  </div>
                  {s.attendance?.feedbackJson && (
                    <div className="mt-1 pl-40 text-xs text-slate-600">
                      AI 整理：{s.attendance.feedbackJson.parentSummary}
                      {s.attendance.feedbackJson.needsAdminFollowUp && <Badge tone="red">已提醒顾问跟进</Badge>}
                    </div>
                  )}
                  {s.attendance?.llmStatus === 'failed' && s.attendance.feedbackRaw && <div className="mt-1 pl-40 text-xs text-slate-400">AI 整理失败，已保存原文</div>}
                  {s.attendance?.billing === 'owed' && <div className="mt-1 pl-40 text-xs text-red-600">课时已用完，本节记为欠课，已通知顾问</div>}
                </li>
              );
            })}
          </ul>
        )}
        {submit.isError && <ErrorBox error={submit.error} />}
        {submit.isSuccess && (
          <p className="mt-3 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            点名已提交。
            {submit.data.feedback.status === 'ok' && ` AI 已整理 ${submit.data.feedback.processed} 条反馈。`}
            {submit.data.feedback.status === 'failed' && ' AI 整理反馈失败，已保存原文（点名和扣课时不受影响）。'}
          </p>
        )}
        <div className="mt-4 flex justify-end">
          <Button disabled={submit.isPending || notStarted || r.session.status === 'cancelled' || r.students.length === 0} onClick={() => submit.mutate()}>
            {submit.isPending ? '提交中，AI 整理反馈中…' : r.students.some((s) => s.attendance) ? '更新点名' : '提交点名'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
