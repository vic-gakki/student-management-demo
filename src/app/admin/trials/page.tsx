'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarPlus, ChevronLeft, ChevronRight, Headphones, UserRound } from 'lucide-react';
import { api } from '@/lib/api';
import { addDays, isoWeekday, melbourneDate, weekStart, WEEKDAY_LABELS } from '@/lib/time';
import { SUBJECT_OPTIONS, TRIAL_OUTCOME, TRIAL_STATUS } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { NewSlotForm } from '../students/[id]/TrialModals';

interface Slot {
  id: number;
  date: string;
  startTime: string;
  endTime: string;
  startsAt: string;
  subject: string;
  title: string;
  teacherName: string;
  capacity: number;
  booked: number;
  students: { trialLessonId: number; studentId: number; name: string; status: string; outcome: string; isMine: boolean }[];
}

const WEEKS = 2;

/** 试听安排：未来两周的全部试听时段，按天分组；可以直接新建时段 */
export default function TrialsPage() {
  const today = melbourneDate(new Date());
  const [start, setStart] = useState(weekStart(today));
  const [subject, setSubject] = useState('all');
  const [creating, setCreating] = useState(false);
  const [newSubject, setNewSubject] = useState('数学');
  const end = addDays(start, WEEKS * 7 - 1);
  const q = useQuery({
    queryKey: ['trial-schedule', start, subject],
    queryFn: () => api<Slot[]>(`/api/trial-schedule?from=${start}&to=${end}${subject === 'all' ? '' : `&subject=${encodeURIComponent(subject)}`}`),
  });
  const days = q.data ? [...new Set(q.data.map((s) => s.date))] : [];
  const open = q.data?.filter((s) => s.booked < s.capacity && new Date(s.startsAt) > new Date()).length ?? 0;

  return (
    <>
      <PageHeader
        title="试听安排"
        description={`${start} 至 ${end}${q.data ? ` · ${q.data.length} 个时段，其中 ${open} 个还能约` : ''} · 给学生安排试听请到学生详情页`}
        actions={
          <>
            <Select value={subject} onValueChange={setSubject}>
              <SelectTrigger className="w-28">
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
            <Button onClick={() => setCreating(true)}>
              <CalendarPlus data-icon="inline-start" />
              新建试听时段
            </Button>
          </>
        }
      />

      {q.isPending ? (
        <LoadingState rows={6} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState title="这两周没有试听时段" description="点右上角新建一个" icon={<Headphones />} />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {days.map((date) => (
            <section key={date} className="space-y-2">
              <h2 className={cn('text-sm font-medium', date === today && 'text-primary')}>
                {date} {WEEKDAY_LABELS[isoWeekday(date)]}
                {date === today && ' · 今天'}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {q.data
                  .filter((s) => s.date === date)
                  .map((s) => {
                    const past = new Date(s.startsAt) <= new Date();
                    const full = s.booked >= s.capacity;
                    return (
                      <Card key={s.id} size="sm" className={cn(past && 'opacity-70')}>
                        <CardContent className="space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="font-mono text-xs tabular-nums text-muted-foreground">
                                {s.startTime}–{s.endTime}
                              </div>
                              <div className="font-medium">{s.title}</div>
                              <div className="text-xs text-muted-foreground">{s.teacherName}</div>
                            </div>
                            {past ? <StatusBadge tone="gray">已开始</StatusBadge> : full ? <StatusBadge tone="orange">已满</StatusBadge> : <StatusBadge tone="green">可约</StatusBadge>}
                          </div>
                          <div className="flex items-center gap-1.5 text-xs">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                              <div className={cn('h-full rounded-full', full ? 'bg-orange-500' : 'bg-violet-500')} style={{ width: `${Math.min(100, (s.booked / s.capacity) * 100)}%` }} />
                            </div>
                            <span className="tabular-nums text-muted-foreground">
                              {s.booked}/{s.capacity}
                            </span>
                          </div>
                          {s.students.length > 0 && (
                            <ul className="space-y-1 border-t pt-2 text-sm">
                              {s.students.map((st) => (
                                <li key={st.trialLessonId} className="flex items-center justify-between gap-2">
                                  <Link href={`/admin/students/${st.studentId}`} className="inline-flex items-center gap-1 hover:text-primary">
                                    <UserRound className="size-3.5 text-muted-foreground" />
                                    {st.name}
                                    {!st.isMine && <span className="text-xs text-muted-foreground">（他人）</span>}
                                  </Link>
                                  <span className="flex gap-1">
                                    <StatusBadge tone={st.status === 'attended' ? 'green' : st.status === 'scheduled' ? 'blue' : 'gray'}>{TRIAL_STATUS[st.status]}</StatusBadge>
                                    {st.status !== 'scheduled' && (
                                      <StatusBadge tone={st.outcome === 'pending' ? 'yellow' : 'gray'}>{TRIAL_OUTCOME[st.outcome]}</StatusBadge>
                                    )}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
              </div>
            </section>
          ))}
        </div>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>新建试听时段</DialogTitle>
            <DialogDescription>系统会检查老师在这个时间有没有正式课、代课或其他试听。</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 text-sm">
            科目
            <Select value={newSubject} onValueChange={setNewSubject}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUBJECT_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <NewSlotForm
            key={newSubject}
            subject={newSubject}
            onCancel={() => setCreating(false)}
            onCreated={() => {
              setCreating(false);
              q.refetch();
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
