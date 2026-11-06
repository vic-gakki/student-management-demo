'use client';

// "加入班级"弹窗：上方 AI 排班助手，下方完整候选列表。
// 两处的"确认"都调用同一个 POST /api/enrollments，服务端会再检查一遍全部规则。
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, CircleCheck, Sparkles, TriangleAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { WEEKDAY_LABELS } from '@/lib/time';
import { SUBJECT_OPTIONS } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { StatusBadge } from '@/components/status';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import type { ClassOption, StudentDetail, Suggestion } from './types';

function classTime(o: Pick<ClassOption, 'weekday' | 'startTime' | 'endTime'>) {
  return `${WEEKDAY_LABELS[o.weekday]} ${o.startTime}-${o.endTime}`;
}

export function EnrollModal({ student, open, onClose }: { student: StudentDetail; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const defaultSubject = student.subjects.find((s) => s.status !== 'active' && s.status !== 'stopped')?.subject ?? student.subjects[0]?.subject ?? '数学';
  const [subject, setSubject] = useState(defaultSubject);
  const [transferFrom, setTransferFrom] = useState('none');
  const [request, setRequest] = useState('');
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const transferId = transferFrom === 'none' ? undefined : Number(transferFrom);

  const options = useQuery({
    queryKey: ['class-options', student.id, subject, transferId],
    queryFn: () => api<ClassOption[]>(`/api/students/${student.id}/class-options?subject=${encodeURIComponent(subject)}${transferId ? `&transferFrom=${transferId}` : ''}`),
    enabled: open,
  });

  const ask = useMutation({
    mutationFn: () => api<Suggestion>(`/api/students/${student.id}/schedule-suggestions`, { body: { request, subject } }),
    onSuccess: setSuggestion,
  });

  const enroll = useMutation({
    mutationFn: (v: { classId: number; suggestionId?: number }) =>
      api(`/api/enrollments`, { body: { studentId: student.id, classId: v.classId, suggestionId: v.suggestionId, transferFromClassId: transferId } }),
    onSuccess: () => {
      toast.success(transferId ? '已转班' : '已加入班级');
      qc.invalidateQueries({ queryKey: ['student', student.id] });
      qc.invalidateQueries({ queryKey: ['class-options'] });
      setSuggestion(null);
      onClose();
    },
  });

  const sameSubject = student.enrollments.filter((e) => e.subject === subject);
  const okCount = options.data?.filter((o) => o.ok).length ?? 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>为 {student.name} 加入班级</DialogTitle>
          <DialogDescription>冲突、人数、余额由系统规则判断；确认后才会写入。</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">科目</span>
          <Select value={subject} onValueChange={(v) => (setSubject(v), setSuggestion(null), setTransferFrom('none'))}>
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
          {sameSubject.length > 0 && (
            <>
              <span className="text-muted-foreground">转班（从）</span>
              <Select value={transferFrom} onValueChange={setTransferFrom}>
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不转班，新增</SelectItem>
                  {sameSubject.map((e) => (
                    <SelectItem key={e.classId} value={String(e.classId)}>
                      {e.className} {classTime(e)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
        </div>

        <section className="space-y-3 rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-indigo-50/40 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-violet-900">
            <Sparkles className="size-4" />
            AI 排班助手
          </div>
          <div className="flex gap-2">
            <Input
              className="bg-background"
              placeholder="例如：避开周末，最好和数学同一天 / 最好和王小明一个班"
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && request.trim() && !ask.isPending && ask.mutate()}
            />
            <Button onClick={() => ask.mutate()} disabled={!request.trim() || ask.isPending} className="shrink-0">
              {ask.isPending ? <Spinner data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}
              {ask.isPending ? '思考中…' : '问 AI'}
            </Button>
          </div>
          {ask.isPending && <p className="text-xs text-violet-700">AI 正在查询学生信息和候选班级…</p>}
          {ask.isError && <ErrorState error={ask.error} title="请求失败" />}
          {suggestion?.status === 'failed' && (
            <Alert className="border-amber-200 bg-amber-50 text-amber-900">
              <TriangleAlert />
              <AlertDescription className="text-amber-800">{suggestion.error ?? 'AI 建议暂不可用'}，请从下方候选列表手动选择。</AlertDescription>
            </Alert>
          )}
          {suggestion?.status === 'ready' && (
            <div className="space-y-2">
              {suggestion.summary && <p className="text-sm text-violet-900">{suggestion.summary}</p>}
              {suggestion.proposals.map((p, i) => (
                <div key={p.classId} className="flex items-start justify-between gap-3 rounded-lg border bg-background p-3">
                  <div className="space-y-1.5 text-sm">
                    <div className="flex items-center gap-2 font-medium">
                      <span className="flex size-5 items-center justify-center rounded-full bg-violet-600 text-xs text-white">{i + 1}</span>
                      {p.option.name} · {classTime(p.option)}
                      <span className="text-xs font-normal text-muted-foreground">
                        {p.option.teacherName} · {p.option.enrolled}/{p.option.capacity}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {p.reasons.map((r) => (
                        <StatusBadge key={r} tone="green">
                          <Check />
                          {r}
                        </StatusBadge>
                      ))}
                      {p.unmetPreferences.map((r) => (
                        <StatusBadge key={r} tone="orange">
                          <X />
                          {r}
                        </StatusBadge>
                      ))}
                      {p.option.warnings.map((w) => (
                        <StatusBadge key={w.code} tone="yellow">
                          {w.message}
                        </StatusBadge>
                      ))}
                    </div>
                  </div>
                  <Button size="sm" disabled={enroll.isPending} onClick={() => enroll.mutate({ classId: p.classId, suggestionId: suggestion.suggestionId })}>
                    确认
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>

        {enroll.isError && <ErrorState error={enroll.error} title="排班被拒绝" />}

        <Separator />
        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <div className="text-sm font-medium">全部候选（{subject}）</div>
            {options.data && (
              <div className="text-xs text-muted-foreground">
                可报 {okCount} / 共 {options.data.length}
              </div>
            )}
          </div>
          {options.isPending ? (
            <LoadingState rows={4} />
          ) : options.isError ? (
            <ErrorState error={options.error} onRetry={() => options.refetch()} />
          ) : options.data.length === 0 ? (
            <EmptyState title="这个科目暂时没有开放的班级" />
          ) : (
            <ul className="divide-y rounded-lg border">
              {options.data.map((o) => (
                <li key={o.classId} className={cn('flex items-center justify-between gap-3 px-3 py-2.5 text-sm', !o.ok && 'bg-muted/50')}>
                  <div className="flex items-start gap-2">
                    {o.ok ? <CircleCheck className="mt-0.5 size-4 text-emerald-600" /> : <Ban className="mt-0.5 size-4 text-muted-foreground" />}
                    <div className={cn(!o.ok && 'text-muted-foreground')}>
                      <div>
                        <span className="font-medium">{o.name}</span> · {classTime(o)}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {o.teacherName} · {o.enrolled}/{o.capacity} · 从 {o.startDate}
                        </span>
                      </div>
                      {(o.reasons.length > 0 || o.warnings.length > 0) && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {o.reasons.map((r) => (
                            <StatusBadge key={r.message} tone="red">
                              {r.message}
                            </StatusBadge>
                          ))}
                          {o.warnings.map((w) => (
                            <StatusBadge key={w.code} tone="yellow">
                              {w.message}
                            </StatusBadge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {o.ok && (
                    <Button size="sm" variant="outline" disabled={enroll.isPending} onClick={() => enroll.mutate({ classId: o.classId })}>
                      {transferId ? '转入' : '加入'}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
