'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/**
 * 휴머노이드 탭 네비 — /oem/layout.tsx 와 같은 패턴.
 *
 * 「보고서」와 「증권사 리포트」는 원천이 다르다(사용자 결정 2026-08-24 · 계획서 결정 2):
 *   보고서       = 사내 게시판 posts 중 category='로봇'
 *   증권사 리포트 = 네이버 증권 리서치 수집분(research_reports)
 */
const HUMANOID_TABS = [
  { label: '기업', href: '/humanoid' },
  { label: '보고서', href: '/humanoid/reports' },
  { label: '증권사 리포트', href: '/humanoid/research' },
] as const;

export default function HumanoidLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">휴머노이드</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          국내외 휴머노이드 완성품·부품 기업 — 주가 장중 매시간 · 재무 분기 1회 갱신
        </p>
        <nav className="mt-3 flex items-center gap-1 overflow-x-auto">
          {HUMANOID_TABS.map((tab) => {
            // "기업" 탭은 /humanoid 정확히 일치할 때만 active (하위 경로는 다른 탭)
            const active =
              tab.href === '/humanoid'
                ? pathname === '/humanoid'
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
