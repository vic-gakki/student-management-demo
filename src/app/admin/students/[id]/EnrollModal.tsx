'use client';

// "加入班级"弹窗：上方 AI 排班助手，下方完整候选列表。
// 两处的"确认"都调用同一个 POST /api/enrollments，服务端会再检查一遍全部规则。
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { WEEKDAY_LABELS } from '@/lib/time';
import { SUBJECT_OPTIONS } from '@/lib/labels';
import { Badge, Button, Empty, ErrorBox, inputCls, Loading, Modal } from '@/components/app-ui';
import type { ClassOption, StudentDetail, Suggestion } from './types';

export function EnrollModal({ student, open, onClose }: { student: StudentDetail; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const defaultSubject = student.subjects.find((s) => s.status !== 'active' && s.status !== 'stopped')?.subject ?? student.subjects[0]?.subject ?? '数学';
  const [subject, setSubject] = useState(defaultSubject);
  const [transferFrom, setTransferFrom] = useState<number | ''>('');
  const [request, setRequest] = useState('');
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);

  const options = useQuery({
    queryKey: ['class-options', student.id, subject, transferFrom],
    queryFn: () => api<ClassOption[]>(`/api/students/${student.id}/class-options?subject=${encodeURIComponent(subject)}${transferFrom ? `&transferFrom=${transferFrom}` : ''}`),
    enabled: open,
  });

  const ask = useMutation({
    mutationFn: () => api<Suggestion>(`/api/students/${student.id}/schedule-suggestions`, { body: { request, subject } }),
    onSuccess: setSuggestion,
  });

  const enroll = useMutation({
    mutationFn: (v: { classId: number; suggestionId?: number }) =>
      api(`/api/enrollments`, { body: { studentId: student.id, classId: v.classId, suggestionId: v.suggestionId, transferFromClassId: transferFrom || undefined } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['student', student.id] });
      qc.invalidateQueries({ queryKey: ['class-options'] });
      setSuggestion(null);
      onClose();
    },
  });

  const sameSubject = student.enrollments.filter((e) => e.subject === subject);

  return (
    <Modal open={open} title={`为 ${student.name} 加入班级`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            科目
            <select className={`${inputCls} w-28`} value={subject} onChange={(e) => (setSubject(e.target.value), setSuggestion(null))}>
              {SUBJECT_OPTIONS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          {sameSubject.length > 0 && (
            <label className="flex items-center gap-2">
              转班（从）
              <select className={`${inputCls} w-48`} value={transferFrom} onChange={(e) => setTransferFrom(e.target.value ? Number(e.target.value) : '')}>
                <option value="">不转班，新增</option>
                {sameSubject.map((e) => (
                  <option key={e.classId} value={e.classId}>
                    {e.className} {WEEKDAY_LABELS[e.weekday]} {e.startTime}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <section className="rounded-md border border-violet-200 bg-violet-50/50 p-3">
          <div className="mb-2 text-sm font-medium text-violet-900">✨ AI 排班助手</div>
          <div className="flex gap-2">
            <input
              className={inputCls}
              placeholder="例如：避开周末，最好和数学同一天 / 最好和王小明一个班"
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && request.trim() && !ask.isPending && ask.mutate()}
            />
            <Button onClick={() => ask.mutate()} disabled={!request.trim() || ask.isPending}>
              {ask.isPending ? '思考中…' : '问 AI'}
            </Button>
          </div>
          <p className="mt-1 text-xs text-slate-500">AI 只给建议：冲突、人数、余额由系统规则判断，确认后才会写入。</p>
          {ask.isPending && <Loading text="AI 正在查询学生信息和候选班级…" />}
          {ask.isError && <ErrorBox error={ask.error} />}
          {suggestion?.status === 'failed' && (
            <div className="mt-2 rounded bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
              {suggestion.error ?? 'AI 建议暂不可用'}，请从下方候选列表手动选择。
            </div>
          )}
          {suggestion?.status === 'ready' && (
            <div className="mt-3 space-y-2">
              {suggestion.summary && <p className="text-sm text-slate-700">{suggestion.summary}</p>}
              {suggestion.proposals.map((p, i) => (
                <div key={p.classId} className="flex items-start justify-between gap-3 rounded border border-violet-200 bg-white p-2.5">
                  <div className="text-sm">
                    <div className="font-medium">
                      {['①', '②'][i]} {p.option.name} · {WEEKDAY_LABELS[p.option.weekday]} {p.option.startTime}-{p.option.endTime}
                      <span className="ml-2 text-xs text-slate-500">
                        {p.option.teacherName} · {p.option.enrolled}/{p.option.capacity}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {p.reasons.map((r) => (
                        <Badge key={r} tone="green">
                          ✓ {r}
                        </Badge>
                      ))}
                      {p.unmetPreferences.map((r) => (
                        <Badge key={r} tone="orange">
                          ✗ {r}
                        </Badge>
                      ))}
                      {p.option.warnings.map((w) => (
                        <Badge key={w.code} tone="yellow">
                          {w.message}
                        </Badge>
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

        {enroll.isError && <ErrorBox error={enroll.error} />}

        <section>
          <div className="mb-2 text-sm font-medium">全部候选（{subject}）</div>
          {options.isPending ? (
            <Loading />
          ) : options.isError ? (
            <ErrorBox error={options.error} onRetry={() => options.refetch()} />
          ) : options.data.length === 0 ? (
            <Empty>这个科目暂时没有开放的班级</Empty>
          ) : (
            <ul className="divide-y divide-slate-100 rounded border border-slate-200">
              {options.data.map((o) => (
                <li key={o.classId} className={`flex items-center justify-between gap-3 px-3 py-2 text-sm ${o.ok ? '' : 'bg-slate-50 text-slate-500'}`}>
                  <div>
                    <span className="mr-1">{o.ok ? '✅' : '⛔'}</span>
                    <span className="font-medium">{o.name}</span> · {WEEKDAY_LABELS[o.weekday]} {o.startTime}-{o.endTime}
                    <span className="ml-2 text-xs text-slate-500">
                      {o.teacherName} · {o.enrolled}/{o.capacity} · 从 {o.startDate}
                    </span>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {o.reasons.map((r) => (
                        <Badge key={r.message} tone="red">
                          {r.message}
                        </Badge>
                      ))}
                      {o.warnings.map((w) => (
                        <Badge key={w.code} tone="yellow">
                          {w.message}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  {o.ok && (
                    <Button size="sm" variant="secondary" disabled={enroll.isPending} onClick={() => enroll.mutate({ classId: o.classId })}>
                      {transferFrom ? '转入' : '加入'}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}
