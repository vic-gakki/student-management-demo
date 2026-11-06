// 业务状态徽章：颜色 + 文字双重编码，全站统一
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { balanceBadge, STUDENT_STATUS, type Tone } from '@/lib/labels';

const TONE_CLASS: Record<Tone, string> = {
  red: 'border-red-200 bg-red-50 text-red-700',
  orange: 'border-orange-200 bg-orange-50 text-orange-700',
  yellow: 'border-amber-200 bg-amber-50 text-amber-800',
  green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  blue: 'border-sky-200 bg-sky-50 text-sky-700',
  purple: 'border-violet-200 bg-violet-50 text-violet-700',
  gray: 'border-border bg-muted text-muted-foreground',
};

export function StatusBadge({ tone = 'gray', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <Badge variant="outline" className={cn('font-medium', TONE_CLASS[tone], className)}>
      {children}
    </Badge>
  );
}

export function StudentStatusBadge({ status }: { status: string }) {
  const s = STUDENT_STATUS[status];
  return <StatusBadge tone={s?.tone}>{s?.label ?? status}</StatusBadge>;
}

/** remaining/owed 不传时只显示标记（老师端不显示具体余额） */
export function BalanceBadge({ flag, remaining, owed }: { flag: string; remaining?: number; owed?: number }) {
  const b = balanceBadge(flag, remaining, owed);
  return <StatusBadge tone={b.tone}>{b.label}</StatusBadge>;
}

export function toneDot(tone: Tone) {
  return {
    red: 'bg-red-500',
    orange: 'bg-orange-500',
    yellow: 'bg-amber-500',
    green: 'bg-emerald-500',
    blue: 'bg-sky-500',
    purple: 'bg-violet-500',
    gray: 'bg-muted-foreground/40',
  }[tone];
}
