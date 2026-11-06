'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { api } from '@/lib/api';

export function AppShell({ user, nav, children }: { user: { name: string; role: string }; nav: { href: string; label: string }[]; children: ReactNode }) {
  const pathname = usePathname();
  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.href = '/login';
  };
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-2.5">
          <span className="font-semibold text-slate-800">学生管理</span>
          <nav className="flex gap-1 text-sm">
            {nav.map((n) => {
              const active = n.href === pathname || (n.href !== '/admin' && n.href !== '/teacher' && pathname.startsWith(n.href));
              return (
                <Link key={n.href} href={n.href} className={`rounded px-2.5 py-1 ${active ? 'bg-sky-50 font-medium text-sky-800' : 'text-slate-600 hover:bg-slate-50'}`}>
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-slate-600">
            <span>
              {user.name} · {user.role === 'admin' ? '课程顾问' : '老师'}
            </span>
            <button className="text-slate-400 hover:text-slate-700" onClick={logout}>
              退出
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-5">{children}</main>
    </div>
  );
}
