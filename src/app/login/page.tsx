'use client';

import { useState } from 'react';
import { CalendarCheck, GraduationCap, ShieldCheck, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { ErrorState } from '@/components/states';

const HIGHLIGHTS = [
  { icon: CalendarCheck, title: '排班不冲突', text: '时间冲突、班级满员、课时不足，提交时由服务端拦截' },
  { icon: ShieldCheck, title: '课时可对账', text: '每一次扣课、续费、退费都留有流水，只追加不修改' },
  { icon: Sparkles, title: 'AI 只给建议', text: '排班建议和课后反馈整理由 AI 完成，确认后才写入' },
];

export default function LoginPage() {
  const [email, setEmail] = useState('admin1@school.test');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { user } = await api<{ user: { role: string } }>('/api/auth/login', { body: { email, password } });
      window.location.href = user.role === 'admin' ? '/admin' : '/teacher';
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <div className="flex size-9 items-center justify-center rounded-lg bg-white/15">
            <GraduationCap className="size-5" />
          </div>
          学生管理系统
        </div>
        <div className="space-y-6">
          <h2 className="text-3xl font-semibold leading-tight">
            从咨询试听开始，
            <br />
            把每一个学生好好管起来
          </h2>
          <ul className="space-y-4">
            {HIGHLIGHTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3">
                <Icon className="mt-0.5 size-5 shrink-0 opacity-90" />
                <div>
                  <div className="font-medium">{title}</div>
                  <div className="text-sm opacity-80">{text}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm opacity-70">业务时间统一按墨尔本时区</p>
      </div>

      <div className="flex items-center justify-center bg-muted/40 p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-xl">登录</CardTitle>
            <CardDescription>课程顾问进入工作台，老师进入今日课程</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="email">邮箱</FieldLabel>
                  <Input id="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="password">密码</FieldLabel>
                  <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
                  <FieldDescription>演示账号的密码见 README</FieldDescription>
                </Field>
                {error ? <ErrorState error={error} title="登录失败" /> : null}
                <Button type="submit" size="lg" className="w-full" disabled={loading || !email || !password}>
                  {loading && <Spinner data-icon="inline-start" />}
                  {loading ? '登录中…' : '登录'}
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
