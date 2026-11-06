'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ATTENDANCE_STATUS, balanceBadge, LEDGER_REASON, STUDENT_STATUS, TASK_TYPE, TRIAL_OUTCOME, TRIAL_STATUS } from '@/lib/labels';
import { formatMelbourne, WEEKDAY_LABELS } from '@/lib/time';
import { Badge, Button, Card, Empty, ErrorBox, inputCls, Loading } from '@/components/ui';
import { EnrollModal } from './EnrollModal';
import { BookTrialModal, OutcomeModal } from './TrialModals';
import { PurchaseModal, RefundModal } from './MoneyModals';
import type { StudentDetail } from './types';

export default function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number(use(params).id);
  const search = useSearchParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['student', id], queryFn: () => api<StudentDetail>(`/api/students/${id}`) });
  const [modal, setModal] = useState<null | 'enroll' | 'trial' | 'purchase' | 'refund' | 'outcome'>(null);
  const [outcomeTrial, setOutcomeTrial] = useState<number | null>(null);

  useEffect(() => {
    if (search.get('action') === 'purchase') setModal('purchase');
  }, [search]);

  const endEnrollment = useMutation({
    mutationFn: (enrollmentId: number) => api(`/api/enrollments/${enrollmentId}/end`, { body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['student', id] }),
  });
  const doneTask = useMutation({
    mutationFn: (taskId: number) => api(`/api/tasks/${taskId}/done`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['student', id] }),
  });

  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  const st = STUDENT_STATUS[s.status];
  const bal = balanceBadge(s.balanceFlag, s.remainingHours, s.owedHours);
  const close = () => setModal(null);

  return (
    <div className="space-y-4">
      <div className="text-sm">
        <Link href="/admin/students" className="text-slate-500 hover:underline">
          ← 学生列表
        </Link>
      </div>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{s.name}</h1>
              <span className="text-slate-500">{s.grade}</span>
              <Badge tone={st?.tone}>{st?.label}</Badge>
              <Badge tone={bal.tone}>{bal.label}</Badge>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              负责人：{s.ownerName}
              {s.guardians.map((g) => (
                <span key={g.id} className="ml-4">
                  家长：{g.name}（{g.relation}）{g.phone}
                </span>
              ))}
            </p>
            {s.notes && <p className="mt-1 text-sm text-slate-500">备注：{s.notes}</p>}
            {s.lostReason && <p className="mt-1 text-sm text-slate-500">流失原因：{s.lostReason}</p>}
          </div>
          {s.canEdit ? (
            <div className="flex gap-2">
              <Button onClick={() => setModal('purchase')}>录入续费</Button>
              <Button variant="danger" disabled={s.remainingHours <= 0} onClick={() => setModal('refund')}>
                退费
              </Button>
            </div>
          ) : (
            <Badge tone="gray">只读：只有负责人可以修改</Badge>
          )}
        </div>
      </Card>

      {s.tasks.length > 0 && (
        <Card title="待跟进">
          <ul className="space-y-2">
            {s.tasks.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  <Badge tone={new Date(t.dueAt) < new Date() ? 'red' : 'yellow'}>{TASK_TYPE[t.type]}</Badge> <span className="ml-1">{t.note}</span>
                  <span className="ml-2 text-xs text-slate-400">截止 {formatMelbourne(new Date(t.dueAt))}</span>
                </span>
                {s.canEdit && (
                  <Button size="sm" variant="ghost" onClick={() => doneTask.mutate(t.id)}>
                    标记完成
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card
          title="科目与在读班级"
          actions={
            s.canEdit && (
              <Button size="sm" onClick={() => setModal('enroll')}>
                + 加入班级
              </Button>
            )
          }
        >
          <div className="mb-3 flex flex-wrap gap-2 text-sm">
            {s.subjects.map((sub) => (
              <Badge key={sub.subject} tone={sub.status === 'active' ? 'green' : sub.status === 'stopped' ? 'gray' : 'blue'}>
                {sub.subject} · {{ inquiry: '咨询中', trial: '试听', active: '在读', stopped: '已停' }[sub.status]}
              </Badge>
            ))}
          </div>
          {s.enrollments.length === 0 ? (
            <Empty>还没有在读班级</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {s.enrollments.map((e) => (
                <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    <span className="font-medium">{e.className}</span> · {WEEKDAY_LABELS[e.weekday]} {e.startTime}-{e.endTime}
                    <span className="ml-2 text-xs text-slate-500">
                      {e.teacherName} · 从 {e.startDate}
                      {e.endDate && ` 到 ${e.endDate}`}
                    </span>
                  </span>
                  {s.canEdit && !e.endDate && (
                    <Button size="sm" variant="ghost" disabled={endEnrollment.isPending} onClick={() => confirm(`确认让 ${s.name} 退出 ${e.className}？余额不变。`) && endEnrollment.mutate(e.id)}>
                      退班
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {endEnrollment.isError && <ErrorBox error={endEnrollment.error} />}
          {!['enrolled', 'paused'].includes(s.status) && s.canEdit && <p className="mt-2 text-xs text-slate-500">购买课时包后才能排进正式班。</p>}
        </Card>

        <AvailabilityCard student={s} />
      </div>

      <Card
        title="试听"
        actions={
          s.canEdit && (
            <Button size="sm" variant="secondary" onClick={() => setModal('trial')}>
              安排试听
            </Button>
          )
        }
      >
        {s.trials.length === 0 ? (
          <Empty>还没有试听记录</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {s.trials.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <span className="font-medium">{t.title}</span> · {formatMelbourne(new Date(t.startsAt))} · {t.teacherName}
                  <span className="ml-2">
                    <Badge tone={t.status === 'attended' ? 'green' : t.status === 'scheduled' ? 'blue' : 'gray'}>{TRIAL_STATUS[t.status]}</Badge>{' '}
                    <Badge tone={t.outcome === 'pending' ? 'yellow' : t.outcome === 'lost' ? 'gray' : 'green'}>{TRIAL_OUTCOME[t.outcome]}</Badge>
                  </span>
                  {t.suggestedLevel && <span className="ml-2 text-xs text-slate-500">建议级别：{t.suggestedLevel}</span>}
                  {t.feedback && <span className="ml-2 text-xs text-slate-500">反馈：{t.feedback}</span>}
                </span>
                {s.canEdit && t.status !== 'scheduled' && t.status !== 'cancelled' && t.outcome !== 'enrolled' && t.outcome !== 'lost' && (
                  <Button size="sm" variant="ghost" onClick={() => (setOutcomeTrial(t.id), setModal('outcome'))}>
                    记录跟进结果
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="最近课堂反馈">
          {s.recentFeedback.length === 0 ? (
            <Empty>暂无老师反馈</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {s.recentFeedback.map((f, i) => (
                <li key={i}>
                  <div className="text-xs text-slate-400">
                    {formatMelbourne(new Date(f.startsAt))} · {f.className} · {ATTENDANCE_STATUS[f.status]}
                  </div>
                  {f.structured ? (
                    <div>
                      <Badge tone={f.structured.engagement === 'low' ? 'orange' : f.structured.engagement === 'high' ? 'green' : 'gray'}>
                        投入度 {{ high: '高', ok: '一般', low: '低' }[f.structured.engagement]}
                      </Badge>{' '}
                      {f.structured.parentSummary}
                    </div>
                  ) : (
                    <div className="text-slate-700">{f.raw}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="课时流水">
          {s.ledger.length === 0 ? (
            <Empty>暂无流水</Empty>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {s.ledger.map((l) => (
                  <tr key={l.id}>
                    <td className="py-1.5 text-xs text-slate-500">{formatMelbourne(new Date(l.createdAt))}</td>
                    <td className="py-1.5">{LEDGER_REASON[l.reason]}</td>
                    <td className={`py-1.5 text-right font-mono ${l.delta > 0 ? 'text-emerald-700' : 'text-slate-700'}`}>
                      {l.delta > 0 ? `+${l.delta}` : l.delta}
                    </td>
                    <td className="py-1.5 pl-3 text-xs text-slate-500">
                      {l.note}
                      {l.amountCents !== null && ` · 退款 $${(l.amountCents / 100).toFixed(2)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {modal === 'enroll' && <EnrollModal student={s} open onClose={close} />}
      {modal === 'trial' && <BookTrialModal student={s} open onClose={close} />}
      <PurchaseModal student={s} open={modal === 'purchase'} onClose={close} />
      <RefundModal student={s} open={modal === 'refund'} onClose={close} />
      <OutcomeModal studentId={s.id} trialId={outcomeTrial} open={modal === 'outcome'} onClose={close} onEnrolled={() => setModal('purchase')} />
    </div>
  );
}

function AvailabilityCard({ student }: { student: StudentDetail }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [slots, setSlots] = useState(student.availability);
  const save = useMutation({
    mutationFn: () => api(`/api/students/${student.id}/availability`, { method: 'PUT', body: { slots } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['student', student.id] });
      setEditing(false);
    },
  });
  return (
    <Card
      title="可用时间"
      actions={
        student.canEdit &&
        !editing && (
          <Button size="sm" variant="ghost" onClick={() => (setSlots(student.availability), setEditing(true))}>
            编辑
          </Button>
        )
      }
    >
      {!editing ? (
        student.availability.length === 0 ? (
          <Empty>未登记（排班时不做可用时间提示）</Empty>
        ) : (
          <div className="grid grid-cols-7 gap-1 text-center text-xs">
            {[1, 2, 3, 4, 5, 6, 7].map((wd) => {
              const hits = student.availability.filter((a) => a.weekday === wd);
              return (
                <div key={wd}>
                  <div className="mb-1 text-slate-500">{WEEKDAY_LABELS[wd]}</div>
                  {hits.length ? (
                    hits.map((a, i) => (
                      <div key={i} className="mb-1 rounded bg-sky-100 px-1 py-1 text-sky-800">
                        {a.fromTime}
                        <br />
                        {a.toTime}
                      </div>
                    ))
                  ) : (
                    <div className="rounded bg-slate-50 py-3 text-slate-300">—</div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : (
        <div className="space-y-2">
          {slots.map((a, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <select className={`${inputCls} w-20`} value={a.weekday} onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, weekday: Number(e.target.value) } : x)))}>
                {[1, 2, 3, 4, 5, 6, 7].map((wd) => (
                  <option key={wd} value={wd}>
                    {WEEKDAY_LABELS[wd]}
                  </option>
                ))}
              </select>
              <input className={`${inputCls} w-28`} type="time" value={a.fromTime} onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, fromTime: e.target.value } : x)))} />
              –
              <input className={`${inputCls} w-28`} type="time" value={a.toTime} onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, toTime: e.target.value } : x)))} />
              <Button size="sm" variant="ghost" onClick={() => setSlots(slots.filter((_, j) => j !== i))}>
                删除
              </Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setSlots([...slots, { weekday: 1, fromTime: '16:00', toTime: '19:00' }])}>
            + 添加时间段
          </Button>
          {save.isError && <ErrorBox error={save.error} />}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
              取消
            </Button>
            <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
              保存
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
