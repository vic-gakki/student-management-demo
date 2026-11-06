'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BellRing, CheckCheck, Sparkles, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { melbourneTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { StatusBadge } from '@/components/status';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';

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

const STATUS_OPTIONS: { value: Status; label: string; active: string }[] = [
  { value: 'present', label: '出勤', active: 'data-[state=on]:bg-emerald-600 data-[state=on]:text-white' },
  { value: 'late', label: '迟到', active: 'data-[state=on]:bg-amber-500 data-[state=on]:text-white' },
  { value: 'excused', label: '请假', active: 'data-[state=on]:bg-slate-600 data-[state=on]:text-white' },
  { value: 'absent', label: '缺席', active: 'data-[state=on]:bg-red-600 data-[state=on]:text-white' },
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
    onSuccess: (r) => {
      const owed = r.results.filter((x) => x.billing === 'owed').length;
      toast.success('点名已提交', {
        description: [
          owed > 0 ? `${owed} 名学生课时已用完，本节记为欠课并已通知顾问` : null,
          r.feedback.status === 'ok' ? `AI 已整理 ${r.feedback.processed} 条反馈` : null,
          r.feedback.status === 'failed' ? 'AI 整理反馈失败，已保存原文（点名和扣课时不受影响）' : null,
        ]
          .filter(Boolean)
          .join('；'),
      });
      qc.invalidateQueries({ queryKey: ['session', id] });
      qc.invalidateQueries({ queryKey: ['teacher-day'] });
    },
  });

  if (q.isPending) return <LoadingState rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data;
  const notStarted = new Date(r.session.startsAt) > new Date();
  const set = (sid: number, patch: Partial<(typeof marks)[number]>) => setMarks({ ...marks, [sid]: { ...marks[sid], ...patch } });
  const counts = Object.values(marks).reduce<Record<string, number>>((acc, m) => ({ ...acc, [m.status]: (acc[m.status] ?? 0) + 1 }), {});

  return (
    <>
      <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
        <Link href="/teacher">
          <ArrowLeft data-icon="inline-start" />
          今日课程
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{r.cls.name}</CardTitle>
          <CardDescription>
            {r.date} {melbourneTime(new Date(r.session.startsAt))}–{melbourneTime(new Date(r.session.endsAt))} · {r.students.length} 人 · 出勤 {counts.present ?? 0} · 迟到 {counts.late ?? 0} · 请假{' '}
            {counts.excused ?? 0} · 缺席 {counts.absent ?? 0}
          </CardDescription>
          <CardAction>
            <Button size="sm" variant="outline" onClick={() => setMarks(Object.fromEntries(Object.entries(marks).map(([k, m]) => [k, { ...m, status: 'present' as Status }])))}>
              <CheckCheck data-icon="inline-start" />
              全部出勤
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-3">
          {r.session.status === 'cancelled' && (
            <Alert>
              <AlertDescription>这节课已停课，不需要点名。</AlertDescription>
            </Alert>
          )}
          {notStarted && (
            <Alert className="border-amber-200 bg-amber-50 text-amber-900">
              <TriangleAlert />
              <AlertDescription className="text-amber-800">课还没开始，开始后才能点名。</AlertDescription>
            </Alert>
          )}
          {r.students.length === 0 ? (
            <EmptyState title="这节课没有学生" />
          ) : (
            <ul className="divide-y rounded-lg border">
              {r.students.map((s) => {
                const m = marks[s.studentId];
                if (!m) return null;
                return (
                  <li key={s.studentId} className={cn('space-y-2 p-3', s.isNew && 'bg-amber-50/40')}>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex w-48 items-center gap-2.5">
                        <Avatar className="size-8">
                          <AvatarFallback className="bg-primary/10 text-xs text-primary">{s.name.slice(0, 1)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-medium">
                            {s.name} <span className="text-xs font-normal text-muted-foreground">{s.grade}</span>
                          </div>
                          <div className="flex gap-1">
                            {s.isNew && (
                              <StatusBadge tone="yellow">
                                <Sparkles />
                                新生
                              </StatusBadge>
                            )}
                            {(s.balanceFlag === 'out' || s.balanceFlag === 'owed') && <StatusBadge tone="red">课时已用完</StatusBadge>}
                            {s.balanceFlag === 'low' && <StatusBadge tone="orange">课时快用完</StatusBadge>}
                          </div>
                        </div>
                      </div>
                      <ToggleGroup type="single" variant="outline" size="sm" value={m.status} onValueChange={(v) => v && set(s.studentId, { status: v as Status })}>
                        {STATUS_OPTIONS.map((o) => (
                          <ToggleGroupItem key={o.value} value={o.value} className={cn('px-3', o.active)}>
                            {o.label}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                      <Input className="min-w-48 flex-1" placeholder="课堂反馈（选填，AI 会整理成给家长的一句话）" value={m.feedback} onChange={(e) => set(s.studentId, { feedback: e.target.value })} />
                      <div className="flex items-center gap-1.5">
                        <Checkbox id={`f-${s.studentId}`} checked={m.needsFollowUp} onCheckedChange={(v) => set(s.studentId, { needsFollowUp: v === true })} />
                        <Label htmlFor={`f-${s.studentId}`} className="text-xs font-normal text-muted-foreground">
                          需要顾问跟进
                        </Label>
                      </div>
                    </div>
                    {s.attendance?.feedbackJson && (
                      <div className="flex flex-wrap items-center gap-2 pl-[3.25rem] text-xs text-violet-800">
                        <Sparkles className="size-3.5" />
                        AI 整理：{s.attendance.feedbackJson.parentSummary}
                        {s.attendance.feedbackJson.needsAdminFollowUp && (
                          <StatusBadge tone="red">
                            <BellRing />
                            已提醒顾问
                          </StatusBadge>
                        )}
                      </div>
                    )}
                    {s.attendance?.llmStatus === 'failed' && s.attendance.feedbackRaw && <div className="pl-[3.25rem] text-xs text-muted-foreground">AI 整理失败，已保存原文</div>}
                    {s.attendance?.billing === 'owed' && <div className="pl-[3.25rem] text-xs text-red-600">课时已用完，本节记为欠课，已通知顾问</div>}
                  </li>
                );
              })}
            </ul>
          )}
          {submit.isError && <ErrorState error={submit.error} title="提交被拒绝" />}
        </CardContent>
        <CardFooter className="justify-end border-t">
          <Button disabled={submit.isPending || notStarted || r.session.status === 'cancelled' || r.students.length === 0} onClick={() => submit.mutate()}>
            {submit.isPending && <Spinner data-icon="inline-start" />}
            {submit.isPending ? '提交中，AI 整理反馈中…' : r.students.some((s) => s.attendance) ? '更新点名' : '提交点名'}
          </Button>
        </CardFooter>
      </Card>
    </>
  );
}
