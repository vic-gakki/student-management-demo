'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, BellRing, CalendarPlus, Check, ChevronRight, CreditCard, Headphones, Plus, Sparkles, UserPlus, Users, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { TASK_TYPE } from '@/lib/labels';
import { formatMelbourne, WEEKDAY_LABELS } from '@/lib/time';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/page-header';
import { BalanceBadge, StatusBadge } from '@/components/status';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';

interface Dashboard {
  myStudentCount: number;
  followUps: { key: string; taskId: number | null; studentId: number; studentName: string; type: string; note: string | null; dueAt: string; overdue: boolean }[];
  lowBalance: { studentId: number; studentName: string; remainingHours: number; owedHours: number; flag: string }[];
  newThisWeek: { studentId: number; studentName: string; className: string; weekday: number; startTime: string; startDate: string }[];
}

function Stat({ icon: Icon, label, value, hint, tone }: { icon: typeof Users; label: string; value: number; hint: string; tone?: string }) {
  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-3">
        <div className={`flex size-10 items-center justify-center rounded-lg ${tone ?? 'bg-primary/10 text-primary'}`}>
          <Icon className="size-5" />
        </div>
        <div>
          <div className="text-2xl font-semibold tabular-nums">{value}</div>
          <div className="text-xs text-muted-foreground">
            {label} · {hint}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Workbench() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/api/dashboard') });
  const done = useMutation({
    mutationFn: (taskId: number) => api(`/api/tasks/${taskId}/done`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('已标记完成');
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader
        title="工作台"
        description="今天需要处理的学生都在这里"
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/admin/trials">
                <Headphones data-icon="inline-start" />
                试听安排
              </Link>
            </Button>
            <Button asChild>
              <Link href="/admin/students?new=1">
                <Plus data-icon="inline-start" />
                新建咨询
              </Link>
            </Button>
          </>
        }
      />
      {q.isPending ? (
        <LoadingState rows={6} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat icon={Users} label="我负责的学生" value={q.data.myStudentCount} hint="在读与跟进中" />
            <Stat icon={BellRing} label="需跟进" value={q.data.followUps.length} hint={`逾期 ${q.data.followUps.filter((f) => f.overdue).length}`} tone="bg-amber-50 text-amber-700" />
            <Stat icon={Wallet} label="课时快用完" value={q.data.lowBalance.length} hint={`欠课 ${q.data.lowBalance.filter((l) => l.flag === 'owed').length}`} tone="bg-red-50 text-red-700" />
            <Stat icon={UserPlus} label="本周新入班" value={q.data.newThisWeek.length} hint="提醒老师关注" tone="bg-emerald-50 text-emerald-700" />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlarmClock className="size-4 text-amber-600" />
                  需跟进
                </CardTitle>
                <CardDescription>试听后跟进、欠课续费、老师反馈</CardDescription>
              </CardHeader>
              <CardContent className="px-2">
                {q.data.followUps.length === 0 ? (
                  <EmptyState title="没有待跟进的学生" icon={<Check />} />
                ) : (
                  <ul className="space-y-1">
                    {q.data.followUps.map((f) => (
                      <li key={f.key} className="group rounded-lg px-2 py-2 hover:bg-muted/60">
                        <div className="flex items-center justify-between gap-2">
                          <Link href={`/admin/students/${f.studentId}`} className="font-medium hover:text-primary">
                            {f.studentName}
                          </Link>
                          <StatusBadge tone={f.type === 'teacher_flag' ? 'purple' : f.overdue ? 'red' : 'yellow'}>
                            {f.type === 'teacher_flag' && <Sparkles />}
                            {TASK_TYPE[f.type] ?? f.type}
                          </StatusBadge>
                        </div>
                        {f.note && <p className="mt-1 text-sm text-muted-foreground">{f.note}</p>}
                        <div className="mt-1 flex items-center justify-between">
                          <span className={`text-xs ${f.overdue ? 'text-red-600' : 'text-muted-foreground'}`}>
                            {f.overdue ? '已逾期 · ' : '截止 '}
                            {formatMelbourne(new Date(f.dueAt))}
                          </span>
                          <span className="flex gap-1">
                            {(f.type === 'inquiry_no_trial' || f.type === 'trial_follow_up') && (
                              <Button size="xs" variant="outline" asChild>
                                <Link href={`/admin/students/${f.studentId}?action=${f.type === 'inquiry_no_trial' ? 'trial' : 'outcome'}`}>
                                  {f.type === 'inquiry_no_trial' ? <CalendarPlus data-icon="inline-start" /> : <Headphones data-icon="inline-start" />}
                                  {f.type === 'inquiry_no_trial' ? '安排试听' : '处理'}
                                </Link>
                              </Button>
                            )}
                            {f.taskId && (
                              <Button size="xs" variant="ghost" disabled={done.isPending} onClick={() => done.mutate(f.taskId!)}>
                                <Check data-icon="inline-start" />
                                完成
                              </Button>
                            )}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wallet className="size-4 text-red-600" />
                  课时快用完
                </CardTitle>
                <CardDescription>剩余 ≤ 3 节或已欠课</CardDescription>
              </CardHeader>
              <CardContent className="px-2">
                {q.data.lowBalance.length === 0 ? (
                  <EmptyState title="没有课时不足的学生" icon={<Check />} />
                ) : (
                  <ul className="space-y-1">
                    {q.data.lowBalance.map((l) => (
                      <li key={l.studentId} className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 hover:bg-muted/60">
                        <Link href={`/admin/students/${l.studentId}`} className="font-medium hover:text-primary">
                          {l.studentName}
                        </Link>
                        <div className="flex items-center gap-1">
                          <BalanceBadge flag={l.flag} remaining={l.remainingHours} owed={l.owedHours} />
                          <Button size="xs" variant="ghost" asChild>
                            <Link href={`/admin/students/${l.studentId}?action=purchase`}>
                              <CreditCard data-icon="inline-start" />
                              续费
                            </Link>
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserPlus className="size-4 text-emerald-600" />
                  本周新入班
                </CardTitle>
                <CardDescription>老师名单上会显示"新生"标记</CardDescription>
                <CardAction>
                  <Button size="xs" variant="ghost" asChild>
                    <Link href="/admin/students">
                      全部学生
                      <ChevronRight data-icon="inline-end" />
                    </Link>
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="px-2">
                {q.data.newThisWeek.length === 0 ? (
                  <EmptyState title="本周没有新入班的学生" />
                ) : (
                  <ul className="space-y-1">
                    {q.data.newThisWeek.map((n) => (
                      <li key={`${n.studentId}-${n.className}`} className="rounded-lg px-2 py-2 hover:bg-muted/60">
                        <Link href={`/admin/students/${n.studentId}`} className="font-medium hover:text-primary">
                          {n.studentName}
                        </Link>
                        <p className="text-sm text-muted-foreground">
                          {n.className} · {WEEKDAY_LABELS[n.weekday]} {n.startTime}
                        </p>
                        <p className="text-xs text-muted-foreground">从 {n.startDate} 开始</p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
