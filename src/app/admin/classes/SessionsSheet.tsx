'use client';

// 某个班未来几周的课次：逐节停课 / 恢复 / 指定代课
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CalendarX2, RotateCcw, UserRoundCog, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { addDays, isoWeekday, melbourneDate, WEEKDAY_LABELS } from '@/lib/time';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { StatusBadge } from '@/components/status';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';

export interface SessionView {
  id: number;
  classId: number;
  className: string;
  date: string;
  startTime: string;
  endTime: string;
  startsAt: string;
  status: 'scheduled' | 'cancelled' | 'done';
  note: string | null;
  teacherId: number;
  teacherName: string;
  substituteTeacherId: number | null;
  substituteName: string | null;
  markedCount: number;
}

const WEEKS = 6;

export function SessionsSheet({ cls, onClose }: { cls: { id: number; name: string; teacherName: string } | null; onClose: () => void }) {
  const qc = useQueryClient();
  const today = melbourneDate(new Date());
  const to = addDays(today, WEEKS * 7 - 1);
  const q = useQuery({
    queryKey: ['sessions', cls?.id, today],
    queryFn: () => api<SessionView[]>(`/api/sessions?classId=${cls!.id}&from=${today}&to=${to}`),
    enabled: !!cls,
  });
  const teachers = useQuery({ queryKey: ['teachers'], queryFn: () => api<{ id: number; name: string }[]>('/api/teachers'), enabled: !!cls });
  const [editing, setEditing] = useState<{ id: number; mode: 'cancel' | 'sub' } | null>(null);
  const [reason, setReason] = useState('');
  const [subId, setSubId] = useState('');

  const done = (msg: string) => {
    toast.success(msg);
    setEditing(null);
    setReason('');
    setSubId('');
    qc.invalidateQueries({ queryKey: ['sessions'] });
  };
  const fail = (e: Error) => toast.error(e.message);
  const cancel = useMutation({ mutationFn: (id: number) => api(`/api/sessions/${id}/cancel`, { body: { reason } }), onSuccess: () => done('已停课，这节课不扣课时'), onError: fail });
  const restore = useMutation({ mutationFn: (id: number) => api(`/api/sessions/${id}/restore`, { method: 'POST' }), onSuccess: () => done('已恢复上课'), onError: fail });
  const substitute = useMutation({
    mutationFn: (v: { id: number; teacherId: number | null }) => api(`/api/sessions/${v.id}/substitute`, { method: 'PUT', body: { teacherId: v.teacherId } }),
    onSuccess: (_, v) => done(v.teacherId ? '已指定代课老师' : '已取消代课'),
    onError: fail,
  });
  const busy = cancel.isPending || restore.isPending || substitute.isPending;

  return (
    <Sheet open={!!cls} onOpenChange={(v) => !v && (setEditing(null), onClose())}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{cls?.name} · 课次调整</SheetTitle>
          <SheetDescription>
            未来 {WEEKS} 周 · 原老师 {cls?.teacherName}。只能调整还没开始、也没有点名记录的课。
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-2 px-4 pb-6">
          {q.isPending ? (
            <LoadingState rows={6} />
          ) : q.isError ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : q.data.length === 0 ? (
            <EmptyState title="未来几周没有课次" icon={<CalendarX2 />} />
          ) : (
            q.data.map((s) => {
              const cancelled = s.status === 'cancelled';
              const locked = new Date(s.startsAt) <= new Date() || s.markedCount > 0;
              const isEditing = editing?.id === s.id;
              return (
                <div key={s.id} className={cn('space-y-2 rounded-lg border p-3 text-sm', cancelled && 'bg-muted/60')}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className={cn('font-medium', cancelled && 'text-muted-foreground line-through')}>
                        {s.date} {WEEKDAY_LABELS[isoWeekday(s.date)]} {s.startTime}-{s.endTime}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {cancelled && <StatusBadge tone="gray">已停课{s.note ? `：${s.note}` : ''}</StatusBadge>}
                        {s.substituteName && <StatusBadge tone="blue">代课：{s.substituteName}</StatusBadge>}
                        {s.markedCount > 0 && <StatusBadge tone="green">已点名</StatusBadge>}
                      </div>
                    </div>
                    {!locked && !isEditing && (
                      <div className="flex gap-1">
                        {cancelled ? (
                          <Button size="xs" variant="outline" disabled={busy} onClick={() => restore.mutate(s.id)}>
                            <RotateCcw data-icon="inline-start" />
                            恢复
                          </Button>
                        ) : (
                          <>
                            {s.substituteTeacherId ? (
                              <Button size="xs" variant="ghost" disabled={busy} onClick={() => substitute.mutate({ id: s.id, teacherId: null })}>
                                <X data-icon="inline-start" />
                                取消代课
                              </Button>
                            ) : (
                              <Button size="xs" variant="outline" disabled={busy} onClick={() => setEditing({ id: s.id, mode: 'sub' })}>
                                <UserRoundCog data-icon="inline-start" />
                                代课
                              </Button>
                            )}
                            <Button size="xs" variant="destructive" disabled={busy} onClick={() => setEditing({ id: s.id, mode: 'cancel' })}>
                              <Ban data-icon="inline-start" />
                              停课
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  {isEditing && editing.mode === 'cancel' && (
                    <div className="flex gap-2">
                      <Input placeholder="停课原因（选填）" value={reason} onChange={(e) => setReason(e.target.value)} />
                      <Button size="sm" variant="destructive" disabled={busy} onClick={() => cancel.mutate(s.id)}>
                        确认停课
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                        取消
                      </Button>
                    </div>
                  )}
                  {isEditing && editing.mode === 'sub' && (
                    <div className="flex gap-2">
                      <Select value={subId} onValueChange={setSubId}>
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="选择代课老师" />
                        </SelectTrigger>
                        <SelectContent>
                          {teachers.data
                            ?.filter((t) => t.id !== s.teacherId)
                            .map((t) => (
                              <SelectItem key={t.id} value={String(t.id)}>
                                {t.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <Button size="sm" disabled={busy || !subId} onClick={() => substitute.mutate({ id: s.id, teacherId: Number(subId) })}>
                        确认
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                        取消
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
