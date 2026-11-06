'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { balanceBadge, STUDENT_STATUS, SUBJECT_OPTIONS } from '@/lib/labels';
import { Badge, Button, Card, Empty, ErrorBox, Field, inputCls, Loading, Modal } from '@/components/app-ui';

interface Row {
  id: number;
  name: string;
  grade: string | null;
  status: string;
  ownerName: string;
  canEdit: boolean;
  remainingHours: number;
  owedHours: number;
  balanceFlag: string;
}

export default function StudentsPage() {
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [showNew, setShowNew] = useState(false);
  const list = useQuery({
    queryKey: ['students', scope, q, status],
    queryFn: () => api<Row[]>(`/api/students?scope=${scope}&q=${encodeURIComponent(q)}&status=${status}`),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">学生</h1>
        <div className="flex rounded ring-1 ring-slate-300">
          {(['mine', 'all'] as const).map((s) => (
            <button key={s} onClick={() => setScope(s)} className={`px-3 py-1 text-sm ${scope === s ? 'bg-sky-700 text-white' : 'bg-white text-slate-600'}`}>
              {s === 'mine' ? '我的' : '全部'}
            </button>
          ))}
        </div>
        <input className={`${inputCls} max-w-48`} placeholder="搜索姓名" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={`${inputCls} max-w-32`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">全部状态</option>
          {Object.entries(STUDENT_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <Button className="ml-auto" onClick={() => setShowNew(true)}>
          + 新建咨询
        </Button>
      </div>

      <Card>
        {list.isPending ? (
          <Loading />
        ) : list.isError ? (
          <ErrorBox error={list.error} onRetry={() => list.refetch()} />
        ) : list.data.length === 0 ? (
          <Empty>没有符合条件的学生</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="pb-2">姓名</th>
                <th className="pb-2">年级</th>
                <th className="pb-2">状态</th>
                <th className="pb-2">课时</th>
                <th className="pb-2">负责人</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.data.map((r) => {
                const st = STUDENT_STATUS[r.status];
                const b = balanceBadge(r.balanceFlag, r.remainingHours, r.owedHours);
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="py-2">
                      <Link href={`/admin/students/${r.id}`} className="font-medium text-sky-800 hover:underline">
                        {r.name}
                      </Link>
                    </td>
                    <td className="py-2 text-slate-600">{r.grade}</td>
                    <td className="py-2">
                      <Badge tone={st?.tone}>{st?.label ?? r.status}</Badge>
                    </td>
                    <td className="py-2">{r.status === 'enrolled' || r.status === 'paused' ? <Badge tone={b.tone}>{b.label}</Badge> : <span className="text-slate-300">—</span>}</td>
                    <td className="py-2 text-slate-600">
                      {r.ownerName}
                      {!r.canEdit && <span className="ml-1 text-xs text-slate-400">（只读）</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      <NewInquiry open={showNew} onClose={() => setShowNew(false)} />
    </div>
  );
}

function NewInquiry({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', grade: '', guardianName: '', phone: '', relation: '妈妈', notes: '' });
  const [subjects, setSubjects] = useState<string[]>([]);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  const create = useMutation({
    mutationFn: () =>
      api<{ id: number }>('/api/students', {
        body: {
          name: form.name,
          grade: form.grade || undefined,
          notes: form.notes || undefined,
          guardian: { name: form.guardianName, phone: form.phone || undefined, relation: form.relation },
          subjects: subjects.map((s) => ({ subject: s })),
        },
      }),
    onSuccess: (st) => router.push(`/admin/students/${st.id}`),
  });
  return (
    <Modal open={open} title="新建咨询" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="学生姓名 *">
            <input className={inputCls} value={form.name} onChange={set('name')} />
          </Field>
          <Field label="年级">
            <input className={inputCls} value={form.grade} onChange={set('grade')} placeholder="如 五年级" />
          </Field>
          <Field label="家长姓名 *">
            <input className={inputCls} value={form.guardianName} onChange={set('guardianName')} />
          </Field>
          <Field label="关系">
            <select className={inputCls} value={form.relation} onChange={set('relation')}>
              <option>妈妈</option>
              <option>爸爸</option>
              <option>其他</option>
            </select>
          </Field>
          <Field label="家长电话">
            <input className={inputCls} value={form.phone} onChange={set('phone')} />
          </Field>
        </div>
        <Field label="想学的科目 *">
          <div className="flex flex-wrap gap-2">
            {SUBJECT_OPTIONS.map((s) => (
              <label key={s} className={`cursor-pointer rounded px-2.5 py-1 text-sm ring-1 ${subjects.includes(s) ? 'bg-sky-50 text-sky-800 ring-sky-400' : 'ring-slate-300'}`}>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={subjects.includes(s)}
                  onChange={(e) => setSubjects(e.target.checked ? [...subjects, s] : subjects.filter((x) => x !== s))}
                />
                {s}
              </label>
            ))}
          </div>
        </Field>
        <Field label="备注" hint="家长原话、时间偏好等；排班时 AI 助手会参考（作为数据，不作为指令）">
          <textarea className={inputCls} rows={2} value={form.notes} onChange={set('notes')} />
        </Field>
        {create.isError && <ErrorBox error={create.error} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" disabled={create.isPending || !form.name || !form.guardianName || subjects.length === 0}>
            {create.isPending ? '保存中…' : '登记'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
