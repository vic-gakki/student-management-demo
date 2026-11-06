'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Headphones } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { addDays, formatMelbourne, melbourneDate } from '@/lib/time';
import { SUBJECT_OPTIONS } from '@/lib/labels';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
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

function SubjectSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
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
  );
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
      toast.success('已安排试听');
      qc.invalidateQueries({ queryKey: ['student', student.id] });
      qc.invalidateQueries({ queryKey: ['trial-slots'] });
      onClose();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>安排试听 · {student.name}</DialogTitle>
          <DialogDescription>试听用独立时段和每科固定内容，不占正式班名额；每个科目只能试听一次。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm">
            科目
            <SubjectSelect value={subject} onChange={setSubject} />
          </div>
          {book.isError && <ErrorState error={book.error} title="安排失败" />}
          {slots.isPending ? (
            <LoadingState rows={3} />
          ) : slots.isError ? (
            <ErrorState error={slots.error} onRetry={() => slots.refetch()} />
          ) : slots.data.length === 0 ? (
            <EmptyState title="暂时没有可选的试听时段" description="可以新建一个时段" icon={<Headphones />} />
          ) : (
            <ul className="divide-y rounded-lg border">
              {slots.data.map((s) => {
                const full = s.booked >= s.capacity;
                return (
                  <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                    <div>
                      <div className="font-medium">{formatMelbourne(new Date(s.startsAt))}</div>
                      <div className="text-xs text-muted-foreground">
                        {s.templateTitle} · {s.teacherName} · 已约 {s.booked}/{s.capacity}
                      </div>
                    </div>
                    <Button size="sm" variant={full ? 'outline' : 'default'} disabled={full || book.isPending} onClick={() => book.mutate(s.id)}>
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
            <Button variant="outline" onClick={() => setCreating(true)}>
              <CalendarPlus data-icon="inline-start" />
              新建试听时段
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function NewSlotForm({ subject, onCreated, onCancel }: { subject: string; onCreated: () => void; onCancel: () => void }) {
  const templates = useQuery({ queryKey: ['trial-templates'], queryFn: () => api<{ id: number; subject: string; title: string; durationMin: number }[]>('/api/trial-templates') });
  const teachers = useQuery({ queryKey: ['teachers'], queryFn: () => api<{ id: number; name: string }[]>('/api/teachers') });
  const [teacherId, setTeacherId] = useState('');
  const [date, setDate] = useState(addDays(melbourneDate(new Date()), 1));
  const [time, setTime] = useState('13:00');
  const [capacity, setCapacity] = useState(2);
  const tpl = templates.data?.find((t) => t.subject === subject);
  const create = useMutation({
    mutationFn: () => api('/api/trial-slots', { body: { templateId: tpl!.id, teacherId: Number(teacherId), date, time, capacity } }),
    onSuccess: () => {
      toast.success('试听时段已创建');
      onCreated();
    },
  });
  return (
    <div className="space-y-4 rounded-lg border bg-muted/40 p-4">
      <div className="text-sm font-medium">新建试听时段 · {tpl ? `${tpl.title}（${tpl.durationMin} 分钟）` : subject}</div>
      <FieldGroup className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Field>
          <FieldLabel>老师</FieldLabel>
          <Select value={teacherId} onValueChange={setTeacherId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="选择" />
            </SelectTrigger>
            <SelectContent>
              {teachers.data?.map((t) => (
                <SelectItem key={t.id} value={String(t.id)}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="slot-date">日期</FieldLabel>
          <Input id="slot-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="slot-time">开始时间</FieldLabel>
          <Input id="slot-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="slot-cap">人数上限</FieldLabel>
          <Input id="slot-cap" type="number" min={1} max={6} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} />
        </Field>
      </FieldGroup>
      <p className="text-xs text-muted-foreground">日期时间按墨尔本本地时间；系统会检查老师在这段时间有没有正式课、代课或其他试听。</p>
      {create.isError && <ErrorState error={create.error} title="创建失败" />}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button disabled={!tpl || !teacherId || create.isPending} onClick={() => create.mutate()}>
          {create.isPending && <Spinner data-icon="inline-start" />}
          创建
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
      toast.success('已记录跟进结果');
      qc.invalidateQueries({ queryKey: ['student', studentId] });
      onClose();
      if (outcome === 'enrolled') onEnrolled();
    },
  });
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>记录试听跟进结果</DialogTitle>
          <DialogDescription>保存后会关闭这节试听的跟进待办。</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <ToggleGroup type="single" variant="outline" value={outcome} onValueChange={(v) => v && setOutcome(v as typeof outcome)} className="justify-start">
            <ToggleGroupItem value="enrolled" className="px-4">
              报名
            </ToggleGroupItem>
            <ToggleGroupItem value="thinking" className="px-4">
              考虑中
            </ToggleGroupItem>
            <ToggleGroupItem value="lost" className="px-4">
              放弃
            </ToggleGroupItem>
          </ToggleGroup>
          {outcome === 'enrolled' && <FieldDescription>保存后会打开"录入续费"，购买课时包后才能排进正式班。</FieldDescription>}
          {outcome === 'thinking' && (
            <Field>
              <FieldLabel htmlFor="next">下次跟进日期</FieldLabel>
              <Input id="next" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          )}
          {outcome === 'lost' && (
            <Field>
              <FieldLabel htmlFor="lost">放弃原因 *</FieldLabel>
              <Input id="lost" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如 价格、时间不合适" />
            </Field>
          )}
          {save.isError && <ErrorState error={save.error} title="保存失败" />}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button disabled={save.isPending || (outcome === 'lost' && !reason.trim())} onClick={() => save.mutate()}>
            {save.isPending && <Spinner data-icon="inline-start" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
