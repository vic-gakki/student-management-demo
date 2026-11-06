'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarX2, ChevronLeft, ChevronRight, Clock, Headphones, Sparkles, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { addDays, isoWeekday, melbourneDate, melbourneTime, WEEKDAY_LABELS } from '@/lib/time';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';

interface Item {
  kind: 'class' | 'trial';
  id: number;
  title: string;
  subject: string;
  startsAt: string;
  endsAt: string;
  status: string;
  isSubstitute: boolean;
  note: string | null;
  studentCount: number;
  newCount: number;
  markedCount: number;
}

export default function TeacherToday() {
  const today = melbourneDate(new Date());
  const [date, setDate] = useState(today);
  const q = useQuery({ queryKey: ['teacher-day', date], queryFn: () => api<Item[]>(`/api/teacher/today?date=${date}`) });
  const pending = q.data?.filter((it) => new Date(it.startsAt) <= new Date() && it.markedCount < it.studentCount).length ?? 0;

  return (
    <>
      <PageHeader
        title={date === today ? '今日课程' : '课程'}
        description={`${date} ${WEEKDAY_LABELS[isoWeekday(date)]} · 墨尔本时间${date === today && pending > 0 ? ` · ${pending} 节待点名` : ''}`}
        actions={
          <div className="flex items-center gap-1">
            <Button size="icon-sm" variant="outline" aria-label="前一天" onClick={() => setDate(addDays(date, -1))}>
              <ChevronLeft />
            </Button>
            <Button size="sm" variant={date === today ? 'secondary' : 'outline'} onClick={() => setDate(today)}>
              今天
            </Button>
            <Button size="icon-sm" variant="outline" aria-label="后一天" onClick={() => setDate(addDays(date, 1))}>
              <ChevronRight />
            </Button>
          </div>
        }
      />
      {q.isPending ? (
        <LoadingState rows={3} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState title="这天没有课" description="切换日期查看其他天的课程" icon={<CalendarX2 />} />
          </CardContent>
        </Card>
      ) : (
        <ol className="relative space-y-3 border-l pl-6">
          {q.data.map((it) => {
            const started = new Date(it.startsAt) <= new Date();
            const marked = it.markedCount >= it.studentCount && it.studentCount > 0;
            const href = it.kind === 'class' ? `/teacher/sessions/${it.id}` : `/teacher/trials/${it.id}`;
            return (
              <li key={`${it.kind}-${it.id}`} className="relative">
                <span
                  className={cn(
                    'absolute top-5 -left-[31px] size-3 rounded-full border-2 border-background',
                    marked ? 'bg-emerald-500' : started ? 'bg-orange-500' : 'bg-muted-foreground/40',
                  )}
                />
                <Link href={href} className="block">
                  <Card className={cn('transition hover:shadow-md hover:ring-primary/40', it.kind === 'trial' && 'bg-violet-50/40')}>
                    <CardContent className="flex flex-wrap items-center gap-4">
                      <div className="flex w-28 items-center gap-1.5 font-mono text-sm tabular-nums">
                        <Clock className="size-4 text-muted-foreground" />
                        {melbourneTime(new Date(it.startsAt))}–{melbourneTime(new Date(it.endsAt))}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{it.title}</span>
                          {it.kind === 'trial' && (
                            <StatusBadge tone="purple">
                              <Headphones />
                              试听
                            </StatusBadge>
                          )}
                          {it.isSubstitute && <StatusBadge tone="blue">代课</StatusBadge>}
                          {it.status === 'cancelled' && <StatusBadge tone="gray">已停课{it.note ? `：${it.note}` : ''}</StatusBadge>}
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Users className="size-3.5" />
                            {it.studentCount} 人
                          </span>
                          {it.kind === 'class' && it.newCount > 0 && (
                            <span className="inline-flex items-center gap-1 text-amber-700">
                              <Sparkles className="size-3.5" />
                              新生 {it.newCount}
                            </span>
                          )}
                        </div>
                      </div>
                      {marked ? <StatusBadge tone="green">已点名</StatusBadge> : started ? <StatusBadge tone="orange">待点名</StatusBadge> : <StatusBadge tone="gray">未开始</StatusBadge>}
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </CardContent>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
