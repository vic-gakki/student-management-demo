'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Lock, Plus, Search, Users } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { STUDENT_STATUS, SUBJECT_OPTIONS } from '@/lib/labels';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { PageHeader } from '@/components/page-header';
import { BalanceBadge, StudentStatusBadge } from '@/components/status';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';

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
  const [status, setStatus] = useState('all');
  const [showNew, setShowNew] = useState(useSearchParams().get('new') === '1');
  const list = useQuery({
    queryKey: ['students', scope, q, status],
    queryFn: () => api<Row[]>(`/api/students?scope=${scope}&q=${encodeURIComponent(q)}&status=${status === 'all' ? '' : status}`),
  });

  return (
    <>
      <PageHeader
        title="学生"
        description="所有顾问都能查看全部学生，只有负责人可以修改"
        actions={
          <Button onClick={() => setShowNew(true)}>
            <Plus data-icon="inline-start" />
            新建咨询
          </Button>
        }
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Tabs value={scope} onValueChange={(v) => setScope(v as 'mine' | 'all')}>
              <TabsList>
                <TabsTrigger value="mine">我的</TabsTrigger>
                <TabsTrigger value="all">全部</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative w-full max-w-56">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8" placeholder="搜索姓名" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                {Object.entries(STUDENT_STATUS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {list.data && <span className="ml-auto text-sm text-muted-foreground">共 {list.data.length} 人</span>}
          </div>

          {list.isPending ? (
            <LoadingState rows={8} />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : list.data.length === 0 ? (
            <EmptyState title="没有符合条件的学生" description="换个筛选条件，或者新建一个咨询" icon={<Users />} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>学生</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>课时</TableHead>
                  <TableHead>负责人</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link href={`/admin/students/${r.id}`} className="flex items-center gap-3 hover:text-primary">
                        <Avatar className="size-8">
                          <AvatarFallback className="bg-primary/10 text-xs text-primary">{r.name.slice(0, 1)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-medium">{r.name}</div>
                          <div className="text-xs text-muted-foreground">{r.grade}</div>
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StudentStatusBadge status={r.status} />
                    </TableCell>
                    <TableCell>
                      {r.status === 'enrolled' || r.status === 'paused' ? (
                        <BalanceBadge flag={r.balanceFlag} remaining={r.remainingHours} owed={r.owedHours} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        {r.ownerName}
                        {!r.canEdit && <Lock className="size-3" aria-label="只读" />}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <NewInquiry open={showNew} onOpenChange={setShowNew} />
    </>
  );
}

function NewInquiry({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', grade: '', guardianName: '', phone: '', relation: '妈妈', notes: '' });
  const [subjects, setSubjects] = useState<string[]>([]);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
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
    onSuccess: (st) => {
      toast.success('已登记咨询，下一步可以安排试听');
      router.push(`/admin/students/${st.id}`);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新建咨询</DialogTitle>
          <DialogDescription>登记人就是这个学生的负责顾问。咨询超过 3 天没安排试听会出现在工作台。</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <FieldGroup>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="name">学生姓名 *</FieldLabel>
                <Input id="name" value={form.name} onChange={set('name')} />
              </Field>
              <Field>
                <FieldLabel htmlFor="grade">年级</FieldLabel>
                <Input id="grade" value={form.grade} onChange={set('grade')} placeholder="如 五年级" />
              </Field>
              <Field>
                <FieldLabel htmlFor="guardian">家长姓名 *</FieldLabel>
                <Input id="guardian" value={form.guardianName} onChange={set('guardianName')} />
              </Field>
              <Field>
                <FieldLabel>关系</FieldLabel>
                <Select value={form.relation} onValueChange={(v) => setForm({ ...form, relation: v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['妈妈', '爸爸', '其他'].map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field className="col-span-2">
                <FieldLabel htmlFor="phone">家长电话</FieldLabel>
                <Input id="phone" value={form.phone} onChange={set('phone')} />
              </Field>
            </div>
            <Field>
              <FieldLabel>想学的科目 *</FieldLabel>
              <ToggleGroup type="multiple" variant="outline" value={subjects} onValueChange={setSubjects} className="justify-start">
                {SUBJECT_OPTIONS.map((s) => (
                  <ToggleGroupItem key={s} value={s} className="px-3">
                    {s}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>
            <Field>
              <FieldLabel htmlFor="notes">备注</FieldLabel>
              <Textarea id="notes" rows={2} value={form.notes} onChange={set('notes')} />
              <FieldDescription>家长原话、时间偏好等；AI 排班助手会参考（作为数据，不作为指令）</FieldDescription>
            </Field>
            {create.isError && <ErrorState error={create.error} title="登记失败" />}
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={create.isPending || !form.name || !form.guardianName || subjects.length === 0}>
              {create.isPending && <Spinner data-icon="inline-start" />}
              登记
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
