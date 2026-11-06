'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatMelbourne } from '@/lib/time';
import { Badge, Button, Card, Empty, ErrorBox, inputCls, Loading } from '@/components/app-ui';

interface TrialRoster {
  slot: { id: number; startsAt: string; endsAt: string };
  template: { title: string; outline: string; subject: string };
  lessons: { trialLessonId: number; name: string; grade: string | null; status: string; feedback: string | null; suggestedLevel: string | null }[];
}

/** 试听点名：出勤/缺席、反馈、建议级别；提交后系统给负责顾问生成 2 天内跟进待办 */
export default function TrialRollCall({ params }: { params: Promise<{ id: string }> }) {
  const id = Number(use(params).id);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['trial-slot', id], queryFn: () => api<TrialRoster>(`/api/trial-slots/${id}`) });
  const [marks, setMarks] = useState<Record<number, { status: 'attended' | 'no_show'; feedback: string; suggestedLevel: string }>>({});
  useEffect(() => {
    if (!q.data) return;
    setMarks(
      Object.fromEntries(
        q.data.lessons.map((l) => [l.trialLessonId, { status: l.status === 'no_show' ? 'no_show' : 'attended', feedback: l.feedback ?? '', suggestedLevel: l.suggestedLevel ?? '' }]),
      ),
    );
  }, [q.data]);
  const submit = useMutation({
    mutationFn: () =>
      api(`/api/trial-slots/${id}/attendance`, {
        body: { entries: Object.entries(marks).map(([k, m]) => ({ trialLessonId: Number(k), status: m.status, feedback: m.feedback || null, suggestedLevel: m.suggestedLevel || null })) },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trial-slot', id] });
      qc.invalidateQueries({ queryKey: ['teacher-day'] });
    },
  });

  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data;
  const notStarted = new Date(r.slot.startsAt) > new Date();
  const set = (k: number, patch: Partial<(typeof marks)[number]>) => setMarks({ ...marks, [k]: { ...marks[k], ...patch } });

  return (
    <div className="space-y-4">
      <Link href="/teacher" className="text-sm text-slate-500 hover:underline">
        ← 今日课程
      </Link>
      <Card title={<span>🎧 {r.template.title} · {formatMelbourne(new Date(r.slot.startsAt))}</span>}>
        <p className="mb-3 rounded bg-violet-50 px-3 py-2 text-sm text-violet-900">固定试听内容：{r.template.outline}</p>
        {notStarted && <p className="mb-3 rounded bg-yellow-50 px-3 py-2 text-sm text-yellow-800">试听还没开始，开始后才能点名。</p>}
        {r.lessons.length === 0 ? (
          <Empty>这个时段还没有试听学生</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {r.lessons.map((l) => {
              const m = marks[l.trialLessonId];
              if (!m) return null;
              return (
                <li key={l.trialLessonId} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="w-32">
                    <span className="font-medium">{l.name}</span> <span className="text-xs text-slate-400">{l.grade}</span>
                    {l.status !== 'scheduled' && (
                      <div>
                        <Badge tone="green">已提交</Badge>
                      </div>
                    )}
                  </div>
                  {(['attended', 'no_show'] as const).map((k) => (
                    <button
                      key={k}
                      onClick={() => set(l.trialLessonId, { status: k })}
                      className={`rounded px-2.5 py-1 text-sm ring-1 ${m.status === k ? (k === 'attended' ? 'bg-emerald-600 text-white ring-emerald-600' : 'bg-orange-600 text-white ring-orange-600') : 'ring-slate-300'}`}
                    >
                      {k === 'attended' ? '已到' : '缺席'}
                    </button>
                  ))}
                  <input className={`${inputCls} w-28`} placeholder="建议级别" value={m.suggestedLevel} onChange={(e) => set(l.trialLessonId, { suggestedLevel: e.target.value })} />
                  <input className={`${inputCls} min-w-48 flex-1`} placeholder="试听反馈" value={m.feedback} onChange={(e) => set(l.trialLessonId, { feedback: e.target.value })} />
                </li>
              );
            })}
          </ul>
        )}
        {submit.isError && <ErrorBox error={submit.error} />}
        {submit.isSuccess && <p className="mt-3 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800">已提交，系统已提醒负责顾问在 2 天内跟进。</p>}
        <div className="mt-4 flex justify-end">
          <Button disabled={submit.isPending || notStarted || r.lessons.length === 0} onClick={() => submit.mutate()}>
            提交试听点名
          </Button>
        </div>
      </Card>
    </div>
  );
}
