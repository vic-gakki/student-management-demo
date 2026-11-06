import type { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import { requirePageRole } from '@/server/session';

export const dynamic = 'force-dynamic';

export default async function TeacherLayout({ children }: { children: ReactNode }) {
  const actor = await requirePageRole('teacher');
  return (
    <AppShell user={actor} nav={[{ href: '/teacher', label: '今日课程' }]}>
      {children}
    </AppShell>
  );
}
