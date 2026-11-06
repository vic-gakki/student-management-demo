'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BellRing, BookOpen, Check, Clock, CreditCard, Headphones, Lock, MessageSquareText, Pencil, Phone, Plus, ReceiptText, Trash2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { ATTENDANCE_STATUS, LEDGER_REASON, TASK_TYPE, TRIAL_OUTCOME, TRIAL_STATUS } from '@/lib/labels';
import { formatMelbourne, WEEKDAY_LABELS } from '@/lib/time';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BalanceBadge, StatusBadge, StudentStatusBadge } from '@/components/status';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { EnrollModal } from './EnrollModal';
import { BookTrialModal, OutcomeModal } from './TrialModals';
import { PurchaseModal, RefundModal } from './MoneyModals';
import type { StudentDetail } from './types';

const SUBJECT_STATUS: Record<string, { label: string; tone: 'green' | 'gray' | 'blue' | 'purple' }> = {
  inquiry: { label: '咨询中', tone: 'blue' },
  trial: { label: '试听', tone: 'purple' },
  active: { label: '在读', tone: 'green' },
  stopped: { label: '已停', tone: 'gray' },
};

export default function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number(use(params).id);
  const search = useSearchParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['student', id], queryFn: () => api<StudentDetail>(`/api/students/${id}`) });
  const [modal, setModal] = useState<null | 'enroll' | 'trial' | 'purchase' | 'refund' | 'outcome'>(null);
  const [outcomeTrial, setOutcomeTrial] = useState<number | null>(null);

  // 从工作台跳转过来时直接打开对应弹窗
  useEffect(() => {
    const a = search.get('action');
    if (a === 'purchase' || a === 'trial') setModal(a);
  }, [search]);
  useEffect(() => {
    if (search.get('action') !== 'outcome' || !q.data) return;
    const t = q.data.trials.find((x) => x.status !== 'scheduled' && x.status !== 'cancelled' && x.outcome !== 'enrolled' && x.outcome !== 'lost');
    if (t) {
      setOutcomeTrial(t.id);
      setModal(t.status === 'no_show' ? 'trial' : 'outcome');
    }
  }, [search, q.data]);

  const endEnrollment = useMutation({
    mutationFn: (enrollmentId: number) => api(`/api/enrollments/${enrollmentId}/end`, { body: {} }),
    onSuccess: () => {
      toast.success('已退班，余额不变');
      qc.invalidateQueries({ queryKey: ['student', id] });
    },
    onError: (e) => toast.error(e.message),
  });
  const doneTask = useMutation({
    mutationFn: (taskId: number) => api(`/api/tasks/${taskId}/done`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('已标记完成');
      qc.invalidateQueries({ queryKey: ['student', id] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (q.isPending) return <LoadingState rows={8} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  const close = () => setModal(null);
  const canEnroll = ['enrolled', 'paused'].includes(s.status);

  return (
    <>
      <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
        <Link href="/admin/students">
          <ArrowLeft data-icon="inline-start" />
          学生列表
        </Link>
      </Button>

      <Card>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <Avatar className="size-14">
                <AvatarFallback className="bg-primary/10 text-lg text-primary">{s.name.slice(0, 1)}</AvatarFallback>
              </Avatar>
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight">{s.name}</h1>
                  <span className="text-muted-foreground">{s.grade}</span>
                  <StudentStatusBadge status={s.status} />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span>负责人：{s.ownerName}</span>
                  {s.guardians.map((g) => (
                    <span key={g.id} className="inline-flex items-center gap-1">
                      <Phone className="size-3.5" />
                      {g.name}（{g.relation}）{g.phone}
                    </span>
                  ))}
                </div>
                {s.notes && <p className="text-sm text-muted-foreground">备注：{s.notes}</p>}
                {s.lostReason && <p className="text-sm text-muted-foreground">流失原因：{s.lostReason}</p>}
              </div>
            </div>
            {s.canEdit ? (
              <div className="flex gap-2">
                <Button onClick={() => setModal('purchase')}>
                  <CreditCard data-icon="inline-start" />
                  录入续费
                </Button>
                <Button variant="destructive" disabled={s.remainingHours <= 0} onClick={() => setModal('refund')}>
                  <Undo2 data-icon="inline-start" />
                  退费
                </Button>
              </div>
            ) : (
              <StatusBadge tone="gray">
                <Lock />
                只读：只有负责人可以修改
              </StatusBadge>
            )}
          </div>
          <Separator />
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">剩余课时</div>
              <div className={cn('text-2xl font-semibold tabular-nums', s.remainingHours <= 3 && 'text-orange-600', s.remainingHours === 0 && 'text-red-600')}>
                {s.remainingHours}
                <span className="ml-1 text-sm font-normal text-muted-foreground">节</span>
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">欠课</div>
              <div className={cn('text-2xl font-semibold tabular-nums', s.owedHours > 0 && 'text-red-600')}>
                {s.owedHours}
                <span className="ml-1 text-sm font-normal text-muted-foreground">节</span>
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">课时状态</div>
              <div className="pt-1.5">
                <BalanceBadge flag={s.balanceFlag} remaining={s.remainingHours} owed={s.owedHours} />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {s.tasks.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-900">
              <BellRing className="size-4" />
              待跟进（{s.tasks.length}）
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {s.tasks.map((t) => {
                const overdue = new Date(t.dueAt) < new Date();
                return (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={overdue ? 'red' : 'yellow'}>{TASK_TYPE[t.type]}</StatusBadge>
                      {t.note}
                      <span className={cn('text-xs', overdue ? 'text-red-600' : 'text-muted-foreground')}>截止 {formatMelbourne(new Date(t.dueAt))}</span>
                    </span>
                    {s.canEdit && (
                      <Button size="xs" variant="outline" onClick={() => doneTask.mutate(t.id)}>
                        <Check data-icon="inline-start" />
                        完成
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="size-4 text-primary" />
                科目与在读班级
              </CardTitle>
              <CardDescription className="flex flex-wrap gap-1 pt-1">
                {s.subjects.map((sub) => (
                  <StatusBadge key={sub.subject} tone={SUBJECT_STATUS[sub.status]?.tone}>
                    {sub.subject} · {SUBJECT_STATUS[sub.status]?.label}
                  </StatusBadge>
                ))}
              </CardDescription>
              {s.canEdit && (
                <CardAction>
                  <Button size="sm" onClick={() => setModal('enroll')} disabled={!canEnroll}>
                    <Plus data-icon="inline-start" />
                    加入班级
                  </Button>
                </CardAction>
              )}
            </CardHeader>
            <CardContent>
              {!canEnroll && s.canEdit && <p className="mb-3 text-sm text-muted-foreground">购买课时包后才能排进正式班。</p>}
              {s.enrollments.length === 0 ? (
                <EmptyState title="还没有在读班级" />
              ) : (
                <ul className="divide-y rounded-lg border">
                  {s.enrollments.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                      <div>
                        <div className="font-medium">
                          {e.className} <span className="font-normal text-muted-foreground">· {WEEKDAY_LABELS[e.weekday]} {e.startTime}-{e.endTime}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {e.teacherName} · 从 {e.startDate}
                          {e.endDate && ` 到 ${e.endDate}`}
                        </div>
                      </div>
                      {s.canEdit && !e.endDate && (
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={endEnrollment.isPending}
                          onClick={() => confirm(`确认让 ${s.name} 退出 ${e.className}？余额不变。`) && endEnrollment.mutate(e.id)}
                        >
                          退班
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Headphones className="size-4 text-violet-600" />
                试听
              </CardTitle>
              <CardDescription>独立试听时段，每科固定内容</CardDescription>
              {s.canEdit && (
                <CardAction>
                  <Button size="sm" variant="outline" onClick={() => setModal('trial')}>
                    安排试听
                  </Button>
                </CardAction>
              )}
            </CardHeader>
            <CardContent>
              {s.trials.length === 0 ? (
                <EmptyState title="还没有试听记录" icon={<Headphones />} />
              ) : (
                <ul className="divide-y rounded-lg border">
                  {s.trials.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-sm">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{t.title}</span>
                          <StatusBadge tone={t.status === 'attended' ? 'green' : t.status === 'scheduled' ? 'blue' : 'gray'}>{TRIAL_STATUS[t.status]}</StatusBadge>
                          <StatusBadge tone={t.outcome === 'pending' ? 'yellow' : t.outcome === 'lost' ? 'gray' : 'green'}>{TRIAL_OUTCOME[t.outcome]}</StatusBadge>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatMelbourne(new Date(t.startsAt))} · {t.teacherName}
                          {t.suggestedLevel && ` · 建议级别：${t.suggestedLevel}`}
                          {t.feedback && ` · 反馈：${t.feedback}`}
                        </div>
                      </div>
                      {s.canEdit && t.status !== 'scheduled' && t.status !== 'cancelled' && t.outcome !== 'enrolled' && t.outcome !== 'lost' && (
                        <Button size="xs" variant="outline" onClick={() => (setOutcomeTrial(t.id), setModal('outcome'))}>
                          记录跟进结果
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ReceiptText className="size-4 text-primary" />
                课时流水
              </CardTitle>
              <CardDescription>只追加不修改；改点名时写补偿流水</CardDescription>
            </CardHeader>
            <CardContent>
              {s.ledger.length === 0 ? (
                <EmptyState title="暂无流水" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>时间</TableHead>
                      <TableHead>类型</TableHead>
                      <TableHead className="text-right">课时</TableHead>
                      <TableHead>备注</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {s.ledger.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="text-xs text-muted-foreground">{formatMelbourne(new Date(l.createdAt))}</TableCell>
                        <TableCell>{LEDGER_REASON[l.reason]}</TableCell>
                        <TableCell className={cn('text-right font-mono tabular-nums', l.delta > 0 ? 'text-emerald-700' : 'text-foreground')}>
                          {l.delta > 0 ? `+${l.delta}` : l.delta}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {l.note}
                          {l.amountCents !== null && ` · 退款 $${(l.amountCents / 100).toFixed(2)}`}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <AvailabilityCard student={s} />
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquareText className="size-4 text-primary" />
                最近课堂反馈
              </CardTitle>
            </CardHeader>
            <CardContent>
              {s.recentFeedback.length === 0 ? (
                <EmptyState title="暂无老师反馈" icon={<MessageSquareText />} />
              ) : (
                <ul className="space-y-3 text-sm">
                  {s.recentFeedback.map((f, i) => (
                    <li key={i} className="space-y-1">
                      <div className="text-xs text-muted-foreground">
                        {formatMelbourne(new Date(f.startsAt))} · {f.className} · {ATTENDANCE_STATUS[f.status]}
                      </div>
                      {f.structured ? (
                        <div className="space-y-1">
                          <StatusBadge tone={f.structured.engagement === 'low' ? 'orange' : f.structured.engagement === 'high' ? 'green' : 'gray'}>
                            投入度 {{ high: '高', ok: '一般', low: '低' }[f.structured.engagement]}
                          </StatusBadge>
                          <p>{f.structured.parentSummary}</p>
                        </div>
                      ) : (
                        <p>{f.raw}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {modal === 'enroll' && <EnrollModal student={s} open onClose={close} />}
      {modal === 'trial' && <BookTrialModal student={s} open onClose={close} />}
      <PurchaseModal student={s} open={modal === 'purchase'} onClose={close} />
      <RefundModal student={s} open={modal === 'refund'} onClose={close} />
      <OutcomeModal studentId={s.id} trialId={outcomeTrial} open={modal === 'outcome'} onClose={close} onEnrolled={() => setModal('purchase')} />
    </>
  );
}

function AvailabilityCard({ student }: { student: StudentDetail }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [slots, setSlots] = useState(student.availability);
  const save = useMutation({
    mutationFn: () => api(`/api/students/${student.id}/availability`, { method: 'PUT', body: { slots } }),
    onSuccess: () => {
      toast.success('可用时间已保存');
      qc.invalidateQueries({ queryKey: ['student', student.id] });
      setEditing(false);
    },
  });
  const update = (i: number, patch: Partial<(typeof slots)[number]>) => setSlots(slots.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="size-4 text-primary" />
          可用时间
        </CardTitle>
        <CardDescription>排班时只做提示，不硬性拦截</CardDescription>
        {student.canEdit && !editing && (
          <CardAction>
            <Button size="xs" variant="ghost" onClick={() => (setSlots(student.availability), setEditing(true))}>
              <Pencil data-icon="inline-start" />
              编辑
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {!editing ? (
          <div className="grid grid-cols-7 gap-1 text-center text-xs">
            {[1, 2, 3, 4, 5, 6, 7].map((wd) => {
              const hits = student.availability.filter((a) => a.weekday === wd);
              return (
                <div key={wd} className="space-y-1">
                  <div className="text-muted-foreground">{WEEKDAY_LABELS[wd].slice(1)}</div>
                  {hits.length ? (
                    hits.map((a, i) => (
                      <div key={i} className="rounded-md bg-primary/10 px-0.5 py-1.5 leading-tight text-primary">
                        {a.fromTime}
                        <br />
                        {a.toTime}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-md bg-muted py-3 text-muted-foreground/50">—</div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-2">
            {slots.map((a, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <Select value={String(a.weekday)} onValueChange={(v) => update(i, { weekday: Number(v) })}>
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 6, 7].map((wd) => (
                      <SelectItem key={wd} value={String(wd)}>
                        {WEEKDAY_LABELS[wd]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input type="time" className="w-24" value={a.fromTime} onChange={(e) => update(i, { fromTime: e.target.value })} />
                <span className="text-muted-foreground">–</span>
                <Input type="time" className="w-24" value={a.toTime} onChange={(e) => update(i, { toTime: e.target.value })} />
                <Button size="icon-sm" variant="ghost" aria-label="删除" onClick={() => setSlots(slots.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setSlots([...slots, { weekday: 1, fromTime: '16:00', toTime: '19:00' }])}>
              <Plus data-icon="inline-start" />
              添加时间段
            </Button>
            {save.isError && <ErrorState error={save.error} title="保存失败" />}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
                取消
              </Button>
              <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
                保存
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
