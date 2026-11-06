'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { WEEKDAY_LABELS } from '@/lib/time';
import { SUBJECT_OPTIONS } from '@/lib/labels';
import { Card, Empty, ErrorBox, inputCls, Loading } from '@/components/app-ui';

interface ClassRow {
  id: number;
  name: string;
  subject: string;
  level: string;
  teacherName: string;
  weekday: number;
  startTime: string;
  endTime: string;
  capacity: number;
  enrolled: number;
}

/** 班级周视图：按星期几分列，一眼看到每个班的人数 */
export default function ClassesPage() {
  const [subject, setSubject] = useState('');
  const q = useQuery({ queryKey: ['classes'], queryFn: () => api<ClassRow[]>('/api/classes') });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const rows = q.data.filter((c) => !subject || c.subject === subject);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">班级周视图</h1>
        <select className={`${inputCls} w-32`} value={subject} onChange={(e) => setSubject(e.target.value)}>
          <option value="">全部科目</option>
          {SUBJECT_OPTIONS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <span className="text-sm text-slate-500">共 {rows.length} 个班</span>
      </div>
      {rows.length === 0 ? (
        <Card>
          <Empty>没有符合条件的班级</Empty>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
          {[1, 2, 3, 4, 5, 6, 7].map((wd) => (
            <div key={wd}>
              <div className="mb-2 text-center text-sm font-medium text-slate-600">{WEEKDAY_LABELS[wd]}</div>
              <div className="space-y-2">
                {rows
                  .filter((c) => c.weekday === wd)
                  .map((c) => {
                    const full = c.enrolled >= c.capacity;
                    return (
                      <div key={c.id} className={`rounded border p-2 text-xs ${full ? 'border-orange-200 bg-orange-50' : 'border-slate-200 bg-white'}`}>
                        <div className="font-medium text-slate-800">{c.name}</div>
                        <div className="text-slate-500">
                          {c.startTime}-{c.endTime}
                        </div>
                        <div className="text-slate-500">{c.teacherName}</div>
                        <div className={full ? 'font-medium text-orange-700' : 'text-slate-600'}>
                          {c.enrolled}/{c.capacity}
                          {full && ' 已满'}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
