'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button, ErrorBox, Field, inputCls, Modal } from '@/components/app-ui';
import type { StudentDetail } from './types';

export function PurchaseModal({ student, open, onClose }: { student: StudentDetail; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [hours, setHours] = useState(20);
  const [price, setPrice] = useState(900);
  const [method, setMethod] = useState('转账');
  const [ref, setRef] = useState('');
  const save = useMutation({
    mutationFn: () => api<{ settledOwed: number }>(`/api/students/${student.id}/packages`, { body: { hours, priceCents: Math.round(price * 100), paymentMethod: method, paymentRef: ref } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['student', student.id] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setRef('');
      onClose();
    },
  });
  return (
    <Modal open={open} title={`录入续费 · ${student.name}`} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {student.owedHours > 0 && (
          <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">当前欠 {student.owedHours} 节，录入后会先补扣欠课。</p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="课时数">
            <input className={inputCls} type="number" min={1} value={hours} onChange={(e) => setHours(Number(e.target.value))} />
          </Field>
          <Field label="金额（澳元）">
            <input className={inputCls} type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(Number(e.target.value))} />
          </Field>
          <Field label="付款方式">
            <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value)}>
              <option>转账</option>
              <option>刷卡</option>
              <option>现金</option>
            </select>
          </Field>
          <Field label="付款凭证号 *" hint="同一凭证号不能重复录入">
            <input className={inputCls} value={ref} onChange={(e) => setRef(e.target.value)} />
          </Field>
        </div>
        {save.isError && <ErrorBox error={save.error} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" disabled={save.isPending || !ref.trim() || hours <= 0}>
            {save.isPending ? '保存中…' : '确认录入'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function RefundModal({ student, open, onClose }: { student: StudentDetail; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => api<{ refundedHours: number; amountCents: number }>(`/api/students/${student.id}/refunds`, { body: { reason } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['student', student.id] }),
  });
  return (
    <Modal open={open} title={`退费 · ${student.name}`} onClose={() => (save.reset(), onClose())}>
      {save.isSuccess ? (
        <div className="space-y-3 text-sm">
          <p>
            已退 {save.data.refundedHours} 节，应退金额 <b>${(save.data.amountCents / 100).toFixed(2)}</b>（按课时包单价计算）。
          </p>
          <div className="flex justify-end">
            <Button onClick={() => (save.reset(), onClose())}>完成</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            剩余 {student.remainingHours} 节将全部退回，金额 = 剩余课时 × 课时包单价（从最近购买的课时包往前算）。历史流水不会改动。
          </p>
          <Field label="退费原因 *">
            <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {save.isError && <ErrorBox error={save.error} />}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button variant="danger" disabled={!reason.trim() || save.isPending} onClick={() => save.mutate()}>
              确认退费
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
