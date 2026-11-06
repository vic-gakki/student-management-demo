'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { addDays, melbourneDate, melbourneTime, WEEKDAY_LABELS, isoWeekday } from '@/lib/time';
import { Badge, Button, Card, Empty, ErrorBox, Loading } from '@/components/ui';

interface Item {
  kind: 'class' | 'trial';
  id: number;
  title: string;
  subject: string;
  startsAt: string;
  endsAt: string;
  status: string;
  isSubstitute: boolean;
  studentCount: number;
  newCount: number;
  markedCount: number;
}

export default function TeacherToday() {
  const today = melbourneDate(new Date());
  const [date, setDate] = useState(today);
  const q = useQuery({ queryKey: ['teacher-day', date], queryFn: () => api<Item[]>(`/api/teacher/today?date=${date}`) });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">{date === today ? '今日课程' : '课程'}</h1>
        <span className="text-sm text-slate-500">
          {date} {WEEKDAY_LABELS[isoWeekday(date)]}（墨尔本时间）
        </span>
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="secondary" onClick={() => setDate(addDays(date, -1))}>
            前一天
          </Button>
          {date !== today && (
            <Button size="sm" variant="secondary" onClick={() => setDate(today)}>
              今天
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => setDate(addDays(date, 1))}>
            后一天
          </Button>
        </div>
      </div>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <Card>
          <Empty>这天没有课</Empty>
        </Card>
      ) : (
        <div className="space-y-2">
          {q.data.map((it) => {
            const started = new Date(it.startsAt) <= new Date();
            const href = it.kind === 'class' ? `/teacher/sessions/${it.id}` : `/teacher/trials/${it.id}`;
            return (
              <Link key={`${it.kind}-${it.id}`} href={href} className="block">
                <Card className="transition hover:border-sky-300">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="w-28 font-mono text-sm text-slate-700">
                      {melbourneTime(new Date(it.startsAt))}–{melbourneTime(new Date(it.endsAt))}
                    </div>
                    <div className="font-medium">{it.title}</div>
                    {it.kind === 'trial' && <Badge tone="purple">🎧 试听</Badge>}
                    {it.isSubstitute && <Badge tone="blue">代课</Badge>}
                    {it.status === 'cancelled' && <Badge tone="gray">已停课</Badge>}
                    <span className="text-sm text-slate-500">{it.studentCount} 人</span>
                    {it.kind === 'class' && it.newCount > 0 && <Badge tone="yellow">🆕 新生 {it.newCount}</Badge>}
                    <span className="ml-auto text-sm">
                      {it.markedCount >= it.studentCount && it.studentCount > 0 ? (
                        <Badge tone="green">已点名</Badge>
                      ) : started ? (
                        <Badge tone="orange">待点名</Badge>
                      ) : (
                        <Badge tone="gray">未开始</Badge>
                      )}
                    </span>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
