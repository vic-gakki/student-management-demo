'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { ErrorState } from '@/components/states';
import type { StudentDetail } from './types';

export function PurchaseModal({ student, open, onClose }: { student: StudentDetail; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [hours, setHours] = useState(20);
  const [price, setPrice] = useState(900);
  const [method, setMethod] = useState('转账');
  const [ref, setRef] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api<{ settledOwed: number }>(`/api/students/${student.id}/packages`, {
        body: { hours, priceCents: Math.round(price * 100), paymentMethod: method, paymentRef: ref },
      }),
    onSuccess: (r) => {
      toast.success(r.settledOwed > 0 ? `已录入 ${hours} 节，并补扣了 ${r.settledOwed} 节欠课` : `已录入 ${hours} 节`);
      qc.invalidateQueries({ queryKey: ['student', student.id] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setRef('');
      onClose();
    },
  });
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>录入续费</DialogTitle>
          <DialogDescription>{student.name} · 家长线下付款后由负责顾问录入</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <FieldGroup>
            {student.owedHours > 0 && (
              <Alert className="border-red-200 bg-red-50 text-red-800">
                <AlertTriangle />
                <AlertTitle>当前欠 {student.owedHours} 节</AlertTitle>
                <AlertDescription className="text-red-700">录入后会在同一事务里先补扣欠课。</AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="hours">课时数</FieldLabel>
                <Input id="hours" type="number" min={1} value={hours} onChange={(e) => setHours(Number(e.target.value))} />
              </Field>
              <Field>
                <FieldLabel htmlFor="price">金额（澳元）</FieldLabel>
                <Input id="price" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(Number(e.target.value))} />
              </Field>
              <Field>
                <FieldLabel>付款方式</FieldLabel>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['转账', '刷卡', '现金'].map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="ref">付款凭证号 *</FieldLabel>
                <Input id="ref" value={ref} onChange={(e) => setRef(e.target.value)} />
                <FieldDescription>同一凭证号不能重复录入</FieldDescription>
              </Field>
            </div>
            {save.isError && <ErrorState error={save.error} title="录入失败" />}
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={save.isPending || !ref.trim() || hours <= 0}>
              {save.isPending && <Spinner data-icon="inline-start" />}
              确认录入
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RefundModal({ student, open, onClose }: { student: StudentDetail; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => api<{ refundedHours: number; amountCents: number }>(`/api/students/${student.id}/refunds`, { body: { reason } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['student', student.id] }),
  });
  const close = () => {
    save.reset();
    setReason('');
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>退费</DialogTitle>
          <DialogDescription>{student.name} · 剩余 {student.remainingHours} 节</DialogDescription>
        </DialogHeader>
        {save.isSuccess ? (
          <>
            <Alert className="border-emerald-200 bg-emerald-50 text-emerald-800">
              <CheckCircle2 />
              <AlertTitle>已退 {save.data.refundedHours} 节</AlertTitle>
              <AlertDescription className="text-emerald-700">
                应退金额 <b>${(save.data.amountCents / 100).toFixed(2)}</b>（按课时包单价计算）
              </AlertDescription>
            </Alert>
            <DialogFooter>
              <Button onClick={close}>完成</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <FieldGroup>
              <p className="text-sm text-muted-foreground">
                剩余课时将全部退回，金额 = 剩余课时 × 课时包单价（从最近购买的课时包往前算）。历史流水不会改动。
              </p>
              <Field>
                <FieldLabel htmlFor="reason">退费原因 *</FieldLabel>
                <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              {save.isError && <ErrorState error={save.error} title="退费失败" />}
            </FieldGroup>
            <DialogFooter>
              <Button variant="outline" onClick={close}>
                取消
              </Button>
              <Button variant="destructive" disabled={!reason.trim() || save.isPending} onClick={() => save.mutate()}>
                {save.isPending && <Spinner data-icon="inline-start" />}
                确认退费
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
