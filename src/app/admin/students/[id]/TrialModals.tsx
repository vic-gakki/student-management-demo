'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatMelbourne, melbourneDate, addDays } from '@/lib/time';
import { SUBJECT_OPTIONS } from '@/lib/labels';
import { Button, Empty, ErrorBox, Field, inputCls, Loading, Modal } from '@/components/ui';
import type { StudentDetail } from './types';

interface Slot {
  id: number;
  templateTitle: string;
  subject: string;
  teacherName: string;
  startsAt: string;
  capacity: number;
  booked: number;
}

/** 安排试听：选已有时段，或新建一个时段（系统检查老师是否有空） */
export function BookTrialModal({ student, open, onClose }: { student: StudentDetail; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [subject, setSubject] = useState(student.subjects.find((s) => s.status === 'inquiry')?.subject ?? student.subjects[0]?.subject ?? '数学');
  const [creating, setCreating] = useState(false);
  const slots = useQuery({ queryKey: ['trial-slots', subject], queryFn: () => api<Slot[]>(`/api/trial-slots?subject=${encodeURIComponent(subject)}`), enabled: open });
  const book = useMutation({
    mutationFn: (slotId: number) => api('/api/trials', { body: { studentId: student.id, slotId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['student', student.id] });
      qc.invalidateQueries({ queryKey: ['trial-slots'] });
      onClose();
    },
  });

  return (
    <Modal open={open} title={`为 ${student.name} 安排试听`} onClose={onClose} wide>
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          科目
          <select className={`${inputCls} w-28`} value={subject} onChange={(e) => setSubject(e.target.value)}>
            {SUBJECT_OPTIONS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <span className="text-xs text-slate-400">每个科目的试听内容固定；每个科目只能试听一次</span>
        </label>
        {book.isError && <ErrorBox error={book.error} />}
        {slots.isPending ? (
          <Loading />
        ) : slots.isError ? (
          <ErrorBox error={slots.error} onRetry={() => slots.refetch()} />
        ) : slots.data.length === 0 ? (
          <Empty>这个科目暂时没有可选的试听时段，可以新建一个</Empty>
        ) : (
          <ul className="divide-y divide-slate-100 rounded border border-slate-200">
            {slots.data.map((s) => {
              const full = s.booked >= s.capacity;
              return (
                <li key={s.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span>
                    {formatMelbourne(new Date(s.startsAt))} · {s.templateTitle} · {s.teacherName}
                    <span className="ml-2 text-xs text-slate-500">
                      {s.booked}/{s.capacity}
                    </span>
                  </span>
                  <Button size="sm" variant="secondary" disabled={full || book.isPending} onClick={() => book.mutate(s.id)}>
                    {full ? '已满' : '安排'}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {creating ? (
          <NewSlotForm subject={subject} onCreated={() => (setCreating(false), slots.refetch())} onCancel={() => setCreating(false)} />
        ) : (
          <Button variant="ghost" onClick={() => setCreating(true)}>
            + 新建试听时段
          </Button>
        )}
      </div>
    </Modal>
  );
}

function NewSlotForm({ subject, onCreated, onCancel }: { subject: string; onCreated: () => void; onCancel: () => void }) {
  const templates = useQuery({ queryKey: ['trial-templates'], queryFn: () => api<{ id: number; subject: string; title: string; durationMin: number }[]>('/api/trial-templates') });
  const teachers = useQuery({ queryKey: ['teachers'], queryFn: () => api<{ id: number; name: string }[]>('/api/teachers') });
  const [teacherId, setTeacherId] = useState<number | ''>('');
  const [date, setDate] = useState(addDays(melbourneDate(new Date()), 1));
  const [time, setTime] = useState('13:00');
  const [capacity, setCapacity] = useState(2);
  const tpl = templates.data?.find((t) => t.subject === subject);
  const create = useMutation({
    mutationFn: () => api('/api/trial-slots', { body: { templateId: tpl!.id, teacherId, date, time, capacity } }),
    onSuccess: onCreated,
  });
  return (
    <div className="space-y-3 rounded border border-slate-200 p-3">
      <div className="text-sm font-medium">新建试听时段 · {tpl ? `${tpl.title}（${tpl.durationMin} 分钟）` : subject}</div>
      <div className="grid grid-cols-4 gap-2">
        <Field label="老师">
          <select className={inputCls} value={teacherId} onChange={(e) => setTeacherId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">选择</option>
            {teachers.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="日期（墨尔本）">
          <input className={inputCls} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="开始时间">
          <input className={inputCls} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <Field label="人数上限">
          <input className={inputCls} type="number" min={1} max={6} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} />
        </Field>
      </div>
      {create.isError && <ErrorBox error={create.error} />}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          取消
        </Button>
        <Button disabled={!tpl || !teacherId || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? '检查老师时间…' : '创建'}
        </Button>
      </div>
    </div>
  );
}

/** 记录试听跟进结果 */
export function OutcomeModal({ studentId, trialId, open, onClose, onEnrolled }: { studentId: number; trialId: number | null; open: boolean; onClose: () => void; onEnrolled: () => void }) {
  const qc = useQueryClient();
  const [outcome, setOutcome] = useState<'enrolled' | 'thinking' | 'lost'>('enrolled');
  const [date, setDate] = useState(addDays(melbourneDate(new Date()), 3));
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api(`/api/trials/${trialId}/outcome`, {
        body: { outcome, nextFollowUpDate: outcome === 'thinking' ? date : undefined, lostReason: outcome === 'lost' ? reason : undefined },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['student', studentId] });
      onClose();
      if (outcome === 'enrolled') onEnrolled();
    },
  });
  return (
    <Modal open={open} title="记录试听跟进结果" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-2">
          {(
            [
              ['enrolled', '报名'],
              ['thinking', '考虑中'],
              ['lost', '放弃'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} onClick={() => setOutcome(k)} className={`rounded px-3 py-1.5 text-sm ring-1 ${outcome === k ? 'bg-sky-700 text-white ring-sky-700' : 'ring-slate-300'}`}>
              {label}
            </button>
          ))}
        </div>
        {outcome === 'enrolled' && <p className="text-sm text-slate-600">保存后会打开"录入课时包"，购买后才能排进正式班。</p>}
        {outcome === 'thinking' && (
          <Field label="下次跟进日期">
            <input className={inputCls} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        )}
        {outcome === 'lost' && (
          <Field label="放弃原因 *">
            <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如 价格、时间不合适" />
          </Field>
        )}
        {save.isError && <ErrorBox error={save.error} />}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button disabled={save.isPending || (outcome === 'lost' && !reason.trim())} onClick={() => save.mutate()}>
            保存
          </Button>
        </div>
      </div>
    </Modal>
  );
}
