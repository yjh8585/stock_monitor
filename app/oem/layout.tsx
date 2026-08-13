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
] as const;

export default function OemLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">OEM</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          전체 시장(MarkLines) + 회사별 IR 차종 판매 · 매월 갱신
        </p>
        <nav className="mt-3 flex items-center gap-1 overflow-x-auto">
          {OEM_TABS.map((tab) => {
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
      </div>
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
