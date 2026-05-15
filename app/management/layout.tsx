'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/** 경영관리 탭 정의 */
const MANAGEMENT_TABS = [
  { label: '손익', href: '/management/pnl' },
  { label: '재고', href: '/management/inventory' },
  { label: '생산', href: '/management/production' },
] as const;

/**
 * /management 트리 공통 레이아웃.
 * - 상단 헤더(제목 + 데이터 갱신 주기 안내)
 * - 손익/재고/생산 3개 탭 네비게이션
 */
export default function ManagementLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">경영관리</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          자체 손익·재고·생산 데이터 · 매월 1회 갱신
        </p>
        <nav className="mt-3 flex items-center gap-1">
          {MANAGEMENT_TABS.map((tab) => {
            const active = pathname === tab.href || pathname.startsWith(tab.href + '/');
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
