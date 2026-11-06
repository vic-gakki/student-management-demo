'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarX2, ChevronLeft, ChevronRight, Headphones } from 'lucide-react';
import { api } from '@/lib/api';
import { addDays, melbourneDate, melbourneTime, weekStart, WEEKDAY_LABELS } from '@/lib/time';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';

interface Item {
  kind: 'class' | 'trial';
  id: number;
  date: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: string;
  isSubstitute: boolean;
  studentCount: number;
  newCount: number;
  markedCount: number;
}
interface Week {
  weekStart: string;
  days: { date: string; items: Item[] }[];
}

/** 老师周课表：一周 7 列，点进去就是点名页 */
export default function TeacherWeek() {
  const today = melbourneDate(new Date());
  const [start, setStart] = useState(weekStart(today));
  const q = useQuery({ queryKey: ['teacher-week', start], queryFn: () => api<Week>(`/api/teacher/week?date=${start}`) });
  const total = q.data?.days.reduce((n, d) => n + d.items.filter((i) => i.status !== 'cancelled').length, 0) ?? 0;

  return (
    <>
      <PageHeader
        title="我的周课表"
        description={`${start} 至 ${addDays(start, 6)} · 墨尔本时间${q.data ? ` · 共 ${total} 节` : ''}`}
        actions={
          <div className="flex items-center gap-1">
            <Button size="icon-sm" variant="outline" aria-label="上一周" onClick={() => setStart(addDays(start, -7))}>
              <ChevronLeft />
            </Button>
            <Button size="sm" variant={start === weekStart(today) ? 'secondary' : 'outline'} onClick={() => setStart(weekStart(today))}>
              本周
            </Button>
            <Button size="icon-sm" variant="outline" aria-label="下一周" onClick={() => setStart(addDays(start, 7))}>
              <ChevronRight />
            </Button>
          </div>
        }
      />
      {q.isPending ? (
        <LoadingState rows={5} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : total === 0 && q.data.days.every((d) => d.items.length === 0) ? (
        <Card>
          <CardContent>
            <EmptyState title="这周没有课" icon={<CalendarX2 />} />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
          {q.data.days.map((d, i) => {
            const isToday = d.date === today;
            return (
              <div key={d.date} className="space-y-2">
                <div className={cn('rounded-lg px-2 py-1.5 text-center', isToday ? 'bg-primary text-primary-foreground' : 'bg-card ring-1 ring-foreground/10')}>
                  <div className="text-sm font-medium">{WEEKDAY_LABELS[i + 1]}</div>
                  <div className={cn('text-xs', isToday ? 'opacity-80' : 'text-muted-foreground')}>{d.date.slice(5)}</div>
                </div>
                {d.items.length === 0 && <div className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">无课</div>}
                {d.items.map((it) => {
                  const cancelled = it.status === 'cancelled';
                  const started = new Date(it.startsAt) <= new Date();
                  const marked = it.markedCount >= it.studentCount && it.studentCount > 0;
                  const href = it.kind === 'class' ? `/teacher/sessions/${it.id}` : `/teacher/trials/${it.id}`;
                  return (
                    <Link
                      key={`${it.kind}-${it.id}`}
                      href={href}
                      className={cn(
                        'block space-y-1 rounded-lg border border-l-4 bg-card p-2.5 text-xs shadow-xs transition hover:shadow-md',
                        it.kind === 'trial' ? 'border-l-violet-500 bg-violet-50/50' : 'border-l-primary',
                        cancelled && 'border-l-muted-foreground/40 bg-muted/60 opacity-70',
                      )}
                    >
                      <div className="font-mono tabular-nums text-muted-foreground">
                        {melbourneTime(new Date(it.startsAt))}–{melbourneTime(new Date(it.endsAt))}
                      </div>
                      <div className={cn('font-medium leading-tight', cancelled && 'line-through')}>{it.title.replace('试听 · ', '')}</div>
                      <div className="flex flex-wrap gap-1">
                        {it.kind === 'trial' && (
                          <StatusBadge tone="purple">
                            <Headphones />
                            试听
                          </StatusBadge>
                        )}
                        {it.isSubstitute && <StatusBadge tone="blue">代课</StatusBadge>}
                        {cancelled ? (
                          <StatusBadge tone="gray">已停课</StatusBadge>
                        ) : marked ? (
                          <StatusBadge tone="green">已点名</StatusBadge>
                        ) : started ? (
                          <StatusBadge tone="orange">待点名</StatusBadge>
                        ) : null}
                      </div>
                      <div className="text-muted-foreground">
                        {it.studentCount} 人{it.kind === 'class' && it.newCount > 0 && ` · 新生 ${it.newCount}`}
                      </div>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
