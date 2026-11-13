'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const OEM_TABS = [
  { label: '전체', href: '/oem' },
  { label: '경쟁 분석', href: '/oem/competition' },
  { label: 'Stellantis USA', href: '/oem/stellantis-na' },
  { label: 'KG모빌리티', href: '/oem/kg-mobility' },
  { label: '현대차', href: '/oem/hyundai' },
  { label: '기아', href: '/oem/kia' },
  { label: '우즈베키스탄', href: '/oem/uzbekistan' },
  { label: '중국', href: '/oem/china' },
] as const;

/**
 * /oem 탭 네비. 「협력사」는 구매 전략(사외비)이라 역할 판정 결과(`showSuppliers`)를
 * server layout 이 넘겨 줄 때만 붙인다 — 탭을 숨길 뿐 경로는 `app/oem/suppliers/layout.tsx` 가 막는다.
 */
export function OemTabs({ showSuppliers }: { showSuppliers: boolean }) {
  const pathname = usePathname();
  const tabs = showSuppliers
    ? [...OEM_TABS, { label: '협력사', href: '/oem/suppliers' }]
    : OEM_TABS;

  return (
    <nav className="mt-3 flex items-center gap-1 overflow-x-auto">
      {tabs.map((tab) => {
        // "전체" 탭은 /oem 정확히 일치할 때만 active (하위 경로는 다른 탭)
        const active =
          tab.href === '/oem'
            ? pathname === '/oem'
            : pathname === tab.href || pathname.startsWith(tab.href + '/');
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap',
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
