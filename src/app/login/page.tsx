'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { Button, ErrorBox, Field, inputCls } from '@/components/ui';

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
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-6">
        <div>
          <h1 className="text-lg font-semibold">学生管理系统</h1>
          <p className="text-sm text-slate-500">登录后进入你的工作台</p>
        </div>
        <Field label="邮箱">
          <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        </Field>
        <Field label="密码" hint="演示账号的密码见 README">
          <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </Field>
        {error ? <ErrorBox error={error} /> : null}
        <Button type="submit" className="w-full" disabled={loading || !email || !password}>
          {loading ? '登录中…' : '登录'}
        </Button>
      </form>
    </div>
  );
}
