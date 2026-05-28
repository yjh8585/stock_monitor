'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/** 모든 인증 사용자에게 노출되는 탭. */
const BASE_TABS = [
  { label: '손익', href: '/management/pnl' },
  { label: '계획', href: '/management/plan' },
  { label: '재고', href: '/management/inventory' },
  { label: '생산', href: '/management/production' },
  { label: '인원', href: '/management/personnel' },
] as const;

/** 관리자에게만 노출되는 탭. */
const ADMIN_TABS = [{ label: '회사', href: '/management/companies' }] as const;

/**
 * 경영관리 탭 네비게이션. isAdmin이 true일 때만 "회사" 탭이 추가된다.
 * usePathname을 쓰므로 client component로 격리 — server인 ManagementLayout에서 prop 전달.
 */
export function ManagementTabs({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const tabs = isAdmin ? [...BASE_TABS, ...ADMIN_TABS] : BASE_TABS;

  return (
    <nav className="mt-3 flex items-center gap-1">
      {tabs.map((tab) => {
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
  );
}
