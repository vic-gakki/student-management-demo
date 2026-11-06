'use client';

// 老师请假：一段时间内的课批量停课或批量代课，逐节显示结果
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { addDays, isoWeekday, melbourneDate, WEEKDAY_LABELS } from '@/lib/time';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ErrorState } from '@/components/states';

interface LeaveResult {
  sessionId: number;
  className: string;
  date: string;
  startTime: string;
  ok: boolean;
  message?: string;
}

export function LeaveDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const today = melbourneDate(new Date());
  const teachers = useQuery({ queryKey: ['teachers'], queryFn: () => api<{ id: number; name: string }[]>('/api/teachers'), enabled: open });
  const [teacherId, setTeacherId] = useState('');
  const [from, setFrom] = useState(addDays(today, 1));
  const [to, setTo] = useState(addDays(today, 7));
  const [action, setAction] = useState<'substitute' | 'cancel'>('substitute');
  const [subId, setSubId] = useState('');
  const [reason, setReason] = useState('');
  const run = useMutation({
    mutationFn: () =>
      api<LeaveResult[]>('/api/teacher-leave', {
        body: { teacherId: Number(teacherId), from, to, action, substituteTeacherId: action === 'substitute' ? Number(subId) : undefined, reason: reason || undefined },
      }),
    onSuccess: (r) => {
      const ok = r.filter((x) => x.ok).length;
      if (r.length === 0) toast.info('这段时间这位老师没有需要处理的课');
      else if (ok === r.length) toast.success(`已处理 ${ok} 节课`);
      else toast.warning(`成功 ${ok} 节，失败 ${r.length - ok} 节，请逐节处理失败的课`);
      qc.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
  const close = (v: boolean) => {
    if (!v) run.reset();
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>老师请假</DialogTitle>
          <DialogDescription>把这位老师一段时间内自己的课批量停课，或交给同一位老师代课。每节课单独检查，有冲突的课会单独列出。</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>请假老师</FieldLabel>
            <Select value={teacherId} onValueChange={setTeacherId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="选择老师" />
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
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="leave-from">开始日期</FieldLabel>
              <Input id="leave-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="leave-to">结束日期</FieldLabel>
              <Input id="leave-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
          <Field>
            <FieldLabel>处理方式</FieldLabel>
            <ToggleGroup type="single" variant="outline" value={action} onValueChange={(v) => v && setAction(v as typeof action)} className="justify-start">
              <ToggleGroupItem value="substitute" className="px-4">
                安排代课
              </ToggleGroupItem>
              <ToggleGroupItem value="cancel" className="px-4">
                全部停课
              </ToggleGroupItem>
            </ToggleGroup>
            <FieldDescription>{action === 'cancel' ? '停课的课不扣学生课时。' : '代课老师在每节课的时间都要有空，没空的那节会失败。'}</FieldDescription>
          </Field>
          {action === 'substitute' ? (
            <Field>
              <FieldLabel>代课老师</FieldLabel>
              <Select value={subId} onValueChange={setSubId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择代课老师" />
                </SelectTrigger>
                <SelectContent>
                  {teachers.data
                    ?.filter((t) => String(t.id) !== teacherId)
                    .map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <Field>
              <FieldLabel htmlFor="leave-reason">停课原因</FieldLabel>
              <Input id="leave-reason" placeholder="默认：老师请假" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
          {run.isError && <ErrorState error={run.error} title="处理失败" />}
          {run.data && run.data.length > 0 && (
            <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border text-sm">
              {run.data.map((r) => (
                <li key={r.sessionId} className="flex items-start gap-2 px-3 py-2">
                  {r.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <CircleX className="mt-0.5 size-4 shrink-0 text-red-600" />}
                  <div>
                    <div>
                      {r.date} {WEEKDAY_LABELS[isoWeekday(r.date)]} {r.startTime} · {r.className}
                    </div>
                    {r.message && <div className="text-xs text-red-600">{r.message}</div>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            关闭
          </Button>
          <Button disabled={run.isPending || !teacherId || from > to || (action === 'substitute' && !subId)} onClick={() => run.mutate()}>
            {run.isPending && <Spinner data-icon="inline-start" />}
            {action === 'cancel' ? '批量停课' : '批量代课'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
