'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, UserRoundX } from 'lucide-react';
import { api } from '@/lib/api';
import { WEEKDAY_LABELS } from '@/lib/time';
import { SUBJECT_OPTIONS } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { SessionsSheet } from './SessionsSheet';
import { LeaveDialog } from './LeaveDialog';

interface ClassRow {
  id: number;
  name: string;
  subject: string;
  level: string;
  teacherName: string;
  weekday: number;
  startTime: string;
  endTime: string;
  capacity: number;
  enrolled: number;
}

const SUBJECT_COLOR: Record<string, string> = {
  数学: 'border-l-indigo-500',
  英语: 'border-l-emerald-500',
  物理: 'border-l-amber-500',
  编程: 'border-l-sky-500',
};

/** 班级周视图：按星期几分列，一眼看到每个班的人数 */
export default function ClassesPage() {
  const [subject, setSubject] = useState('all');
  const [selected, setSelected] = useState<ClassRow | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const q = useQuery({ queryKey: ['classes'], queryFn: () => api<ClassRow[]>('/api/classes') });
  const rows = (q.data ?? []).filter((c) => subject === 'all' || c.subject === subject);

  return (
    <>
      <PageHeader
        title="班级周视图"
        description="每周固定开课的班级；点击班级可以逐节停课或安排代课"
        actions={
          <>
            {q.data && <span className="text-sm text-muted-foreground">共 {rows.length} 个班</span>}
            <Button variant="outline" onClick={() => setLeaveOpen(true)}>
              <UserRoundX data-icon="inline-start" />
              老师请假
            </Button>
            <Select value={subject} onValueChange={setSubject}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部科目</SelectItem>
                {SUBJECT_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      />
      {q.isPending ? (
        <LoadingState rows={6} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState title="没有符合条件的班级" icon={<CalendarDays />} />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
          {[1, 2, 3, 4, 5, 6, 7].map((wd) => {
            const day = rows.filter((c) => c.weekday === wd);
            return (
              <div key={wd} className="space-y-2">
                <div className="flex items-baseline justify-between px-1">
                  <span className="text-sm font-medium">{WEEKDAY_LABELS[wd]}</span>
                  <span className="text-xs text-muted-foreground">{day.length} 班</span>
                </div>
                {day.map((c) => {
                  const full = c.enrolled >= c.capacity;
                  const pct = Math.min(100, Math.round((c.enrolled / c.capacity) * 100));
                  return (
                    <Tooltip key={c.id}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => setSelected(c)}
                          className={cn('w-full space-y-1.5 rounded-lg border border-l-4 bg-card p-2.5 text-left text-xs shadow-xs transition hover:shadow-md', SUBJECT_COLOR[c.subject], full && 'bg-orange-50')}
                        >
                          <div className="font-medium leading-tight">{c.name}</div>
                          <div className="text-muted-foreground tabular-nums">
                            {c.startTime}-{c.endTime}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                              <div className={cn('h-full rounded-full', full ? 'bg-orange-500' : 'bg-primary/70')} style={{ width: `${pct}%` }} />
                            </div>
                            <span className={cn('tabular-nums', full ? 'font-medium text-orange-700' : 'text-muted-foreground')}>
                              {c.enrolled}/{c.capacity}
                            </span>
                          </div>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {c.teacherName} · {c.subject}
                        {c.level}
                        {full ? ' · 已满' : ` · 还剩 ${c.capacity - c.enrolled} 个位置`}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
      <SessionsSheet cls={selected} onClose={() => setSelected(null)} />
      <LeaveDialog open={leaveOpen} onOpenChange={setLeaveOpen} />
    </>
  );
}
