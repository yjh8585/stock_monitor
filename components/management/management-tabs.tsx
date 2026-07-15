'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { canAccess } from '@/lib/auth/permissions';
import type { Role } from '@/lib/auth/roles';

/** 경영관리 전체 탭. 역할별 접근 가능 여부는 canAccess로 필터링한다. */
const ALL_TABS = [
  { label: '손익', href: '/management/pnl' },
  { label: '계획', href: '/management/plan' },
  { label: '스텔란티스', href: '/management/stellantis' },
  { label: '재고', href: '/management/inventory' },
  { label: '생산', href: '/management/production' },
  { label: '인원', href: '/management/personnel' },
  { label: '재무', href: '/management/finance' },
  { label: '조직도', href: '/management/org-chart' },
  { label: '자료 업로드', href: '/management/upload' },
  { label: '회사', href: '/management/companies' },
] as const;

/**
 * 경영관리 탭 네비게이션.
 * usePathname을 쓰므로 client component로 격리 — server인 ManagementLayout에서 role 전달.
 * 탭 노출은 canAccess(role)로 결정: 회사 탭은 admin만, hmobility는 재고·생산·인원만.
 */
export function ManagementTabs({ role }: { role: Role }) {
  const pathname = usePathname();
  const tabs = ALL_TABS.filter((tab) => canAccess(tab.href, role));

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
