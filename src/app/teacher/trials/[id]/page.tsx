'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BookOpenCheck, Headphones, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { formatMelbourne } from '@/lib/time';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { StatusBadge } from '@/components/status';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';

interface TrialRoster {
  slot: { id: number; startsAt: string; endsAt: string };
  template: { title: string; outline: string; subject: string };
  lessons: { trialLessonId: number; name: string; grade: string | null; status: string; feedback: string | null; suggestedLevel: string | null }[];
}

/** 试听点名：到课/缺席、反馈、建议级别；提交后系统给负责顾问生成 2 天内跟进待办 */
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
      toast.success('试听点名已提交', { description: '系统已提醒负责顾问在 2 天内跟进' });
      qc.invalidateQueries({ queryKey: ['trial-slot', id] });
      qc.invalidateQueries({ queryKey: ['teacher-day'] });
    },
  });

  if (q.isPending) return <LoadingState rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data;
  const notStarted = new Date(r.slot.startsAt) > new Date();
  const set = (k: number, patch: Partial<(typeof marks)[number]>) => setMarks({ ...marks, [k]: { ...marks[k], ...patch } });

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
          <CardTitle className="flex items-center gap-2 text-lg">
            <Headphones className="size-5 text-violet-600" />
            {r.template.title}
          </CardTitle>
          <CardDescription>
            {formatMelbourne(new Date(r.slot.startsAt))} · {r.lessons.length} 名试听学生
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Alert className="border-violet-200 bg-violet-50 text-violet-900">
            <BookOpenCheck />
            <AlertTitle>固定试听内容</AlertTitle>
            <AlertDescription className="text-violet-800">{r.template.outline}</AlertDescription>
          </Alert>
          {notStarted && (
            <Alert className="border-amber-200 bg-amber-50 text-amber-900">
              <TriangleAlert />
              <AlertDescription className="text-amber-800">试听还没开始，开始后才能点名。</AlertDescription>
            </Alert>
          )}
          {r.lessons.length === 0 ? (
            <EmptyState title="这个时段还没有试听学生" icon={<Headphones />} />
          ) : (
            <ul className="divide-y rounded-lg border">
              {r.lessons.map((l) => {
                const m = marks[l.trialLessonId];
                if (!m) return null;
                return (
                  <li key={l.trialLessonId} className="flex flex-wrap items-center gap-3 p-3">
                    <div className="flex w-40 items-center gap-2.5">
                      <Avatar className="size-8">
                        <AvatarFallback className="bg-violet-100 text-xs text-violet-700">{l.name.slice(0, 1)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="font-medium">
                          {l.name} <span className="text-xs font-normal text-muted-foreground">{l.grade}</span>
                        </div>
                        {l.status !== 'scheduled' && <StatusBadge tone="green">已提交</StatusBadge>}
                      </div>
                    </div>
                    <ToggleGroup type="single" variant="outline" size="sm" value={m.status} onValueChange={(v) => v && set(l.trialLessonId, { status: v as 'attended' | 'no_show' })}>
                      <ToggleGroupItem value="attended" className={cn('px-3', 'data-[state=on]:bg-emerald-600 data-[state=on]:text-white')}>
                        已到
                      </ToggleGroupItem>
                      <ToggleGroupItem value="no_show" className={cn('px-3', 'data-[state=on]:bg-red-600 data-[state=on]:text-white')}>
                        缺席
                      </ToggleGroupItem>
                    </ToggleGroup>
                    <Input className="w-28" placeholder="建议级别" value={m.suggestedLevel} onChange={(e) => set(l.trialLessonId, { suggestedLevel: e.target.value })} />
                    <Input className="min-w-48 flex-1" placeholder="试听反馈" value={m.feedback} onChange={(e) => set(l.trialLessonId, { feedback: e.target.value })} />
                  </li>
                );
              })}
            </ul>
          )}
          {submit.isError && <ErrorState error={submit.error} title="提交被拒绝" />}
        </CardContent>
        <CardFooter className="justify-end border-t">
          <Button disabled={submit.isPending || notStarted || r.lessons.length === 0} onClick={() => submit.mutate()}>
            {submit.isPending && <Spinner data-icon="inline-start" />}
            提交试听点名
          </Button>
        </CardFooter>
      </Card>
    </>
  );
}
