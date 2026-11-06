import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Geist } from 'next/font/google';
import { cn } from '@/lib/utils';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';
import { Providers } from './providers';

// Geist 没有中文字形，中文回退到系统字体
const geist = Geist({
  subsets: ['latin'],
  variable: '--font-sans',
  fallback: ['PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', 'system-ui', 'sans-serif'],
});

export const metadata: Metadata = {
  title: '学生管理系统',
  description: '咨询、试听、排班、点名扣课时、续费',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" className={cn('font-sans', geist.variable)}>
      <body className="min-h-screen antialiased">
        <Providers>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster richColors position="top-center" />
        </Providers>
      </body>
    </html>
  );
}
