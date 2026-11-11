'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { CustomerTab } from '@/lib/customers/source';

/**
 * 고객사 탭 — [요약 · 회사들(요약 표 순서)]. 경영관리 탭(ManagementTabs)과 같은 모양.
 * usePathname 을 쓰므로 client — 명단(이름·slug)은 서버 layout 이 넘긴다.
 */
export function CustomersTabs({ tabs }: { tabs: CustomerTab[] }) {
  const pathname = usePathname();
  const items = [
    // 요약은 정확 일치 — 접두로 보면 모든 회사 탭에서 요약도 켜진다.
    { label: '요약', href: '/customers', active: pathname === '/customers' },
    ...tabs.map((t) => {
      const href = `/customers/${t.slug}`;
      return { label: t.name_kr, href, active: pathname === href };
    }),
  ];

  return (
    <nav className="mt-3 flex flex-wrap items-center gap-1" aria-label="고객사">
      {items.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.active ? 'page' : undefined}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            tab.active
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
