'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { balanceBadge, TASK_TYPE } from '@/lib/labels';
import { WEEKDAY_LABELS, formatMelbourne } from '@/lib/time';
import { Badge, Button, Card, Empty, ErrorBox, Loading } from '@/components/ui';

interface Dashboard {
  myStudentCount: number;
  followUps: { key: string; taskId: number | null; studentId: number; studentName: string; type: string; note: string | null; dueAt: string; overdue: boolean }[];
  lowBalance: { studentId: number; studentName: string; remainingHours: number; owedHours: number; flag: string }[];
  newThisWeek: { studentId: number; studentName: string; className: string; weekday: number; startTime: string; startDate: string }[];
}

export default function Workbench() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/api/dashboard') });
  const done = useMutation({
    mutationFn: (taskId: number) => api(`/api/tasks/${taskId}/done`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard'] }),
  });

  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">工作台</h1>
        <span className="text-sm text-slate-500">我负责的学生 {d.myStudentCount} 人</span>
      </div>
      {done.isError && <ErrorBox error={done.error} />}
      <div className="grid gap-4 md:grid-cols-3">
        <Card title={`需跟进（${d.followUps.length}）`}>
          {d.followUps.length === 0 ? (
            <Empty>没有待跟进的学生 🎉</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.followUps.map((f) => (
                <li key={f.key} className="py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/admin/students/${f.studentId}`} className="font-medium text-sky-800 hover:underline">
                      {f.studentName}
                    </Link>
                    <Badge tone={f.overdue ? 'red' : 'yellow'}>{TASK_TYPE[f.type] ?? f.type}</Badge>
                  </div>
                  {f.note && <p className="mt-1 text-sm text-slate-600">{f.note}</p>}
                  <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
                    <span className={f.overdue ? 'text-red-600' : ''}>
                      {f.overdue ? '已逾期 · ' : '截止 '}
                      {formatMelbourne(new Date(f.dueAt))}
                    </span>
                    {f.taskId && (
                      <Button size="sm" variant="ghost" disabled={done.isPending} onClick={() => done.mutate(f.taskId!)}>
                        标记完成
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={`课时快用完（${d.lowBalance.length}）`}>
          {d.lowBalance.length === 0 ? (
            <Empty>没有课时不足的学生</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.lowBalance.map((l) => {
                const b = balanceBadge(l.flag, l.remainingHours, l.owedHours);
                return (
                  <li key={l.studentId} className="flex items-center justify-between gap-2 py-2.5">
                    <Link href={`/admin/students/${l.studentId}`} className="font-medium text-sky-800 hover:underline">
                      {l.studentName}
                    </Link>
                    <div className="flex items-center gap-2">
                      <Badge tone={b.tone}>{b.label}</Badge>
                      <Link href={`/admin/students/${l.studentId}?action=purchase`} className="text-xs text-sky-700 hover:underline">
                        录入续费
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title={`本周新入班（${d.newThisWeek.length}）`}>
          {d.newThisWeek.length === 0 ? (
            <Empty>本周没有新入班的学生</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.newThisWeek.map((n) => (
                <li key={`${n.studentId}-${n.className}`} className="py-2.5">
                  <Link href={`/admin/students/${n.studentId}`} className="font-medium text-sky-800 hover:underline">
                    {n.studentName}
                  </Link>
                  <p className="text-sm text-slate-600">
                    {n.className} · {WEEKDAY_LABELS[n.weekday]} {n.startTime}
                  </p>
                  <p className="text-xs text-slate-400">从 {n.startDate} 开始</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
