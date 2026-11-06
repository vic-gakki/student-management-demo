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
        { href: '/admin', label: '工作台', icon: 'dashboard' },
        { href: '/admin/students', label: '学生', icon: 'students' },
        { href: '/admin/classes', label: '班级周视图', icon: 'classes' },
        { href: '/admin/trials', label: '试听安排', icon: 'trials' },
      ]}
    >
      {children}
    </AppShell>
  );
}
