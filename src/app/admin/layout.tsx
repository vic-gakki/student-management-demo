import type { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import { requirePageRole } from '@/server/session';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const actor = await requirePageRole('admin');
  return (
    <AppShell
      user={actor}
      nav={[
        { href: '/admin', label: '工作台' },
        { href: '/admin/students', label: '学生' },
        { href: '/admin/classes', label: '班级' },
      ]}
    >
      {children}
    </AppShell>
  );
}
