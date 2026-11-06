'use client';

// 加载 / 空 / 错误三态，所有页面统一使用
import type { ReactNode } from 'react';
import { AlertCircle, Inbox, RotateCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';

export function LoadingState({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={className ?? 'space-y-3 py-2'} aria-busy="true" aria-label="加载中">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ title, description, icon, children }: { title: string; description?: string; icon?: ReactNode; children?: ReactNode }) {
  return (
    <Empty className="py-8">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon ?? <Inbox />}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {children}
    </Empty>
  );
}

export function ErrorState({ error, onRetry, title = '出错了' }: { error: unknown; onRetry?: () => void; title?: string }) {
  const msg = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string })?.code;
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle className="flex items-center gap-2">
        {title}
        {code && code !== 'INTERNAL' && <span className="font-mono text-xs opacity-70">{code}</span>}
      </AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <span>{msg}</span>
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RotateCw data-icon="inline-start" />
            重试
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
