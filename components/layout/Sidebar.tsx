'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  BarChart2,
  ArrowLeftRight,
  Car,
  Factory,
  Cog,
  Info,
  FileText,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';

type NavChild = { label: string; href: string };
type NavItem = {
  label: string;
  href: string;
  Icon: LucideIcon;
  children?: readonly NavChild[];
};

export const NAV_ITEMS: readonly NavItem[] = [
  {
    label: '경영관리',
    href: '/management',
    Icon: Briefcase,
    children: [
      { label: '손익', href: '/management/pnl' },
      { label: '재고', href: '/management/inventory' },
      { label: '생산', href: '/management/production' },
    ],
  },
  { label: '비교', href: '/compare', Icon: ArrowLeftRight },
  { label: '관련회사', href: '/related-stocks', Icon: BarChart2 },
  { label: '국내자동차', href: '/domestic', Icon: Car },
  { label: '부품사 TOP100', href: '/parts-top100', Icon: Cog },
  { label: 'OEM', href: '/oem', Icon: Factory },
  { label: '보고서', href: '/reports', Icon: FileText },
  {
    label: '기타',
    href: '/etc',
    Icon: Info,
    children: [
      { label: '주가', href: '/etc/stock-prices' },
      { label: '환율', href: '/etc/fx' },
      { label: '원자재', href: '/etc/commodities' },
      { label: '운임', href: '/etc/shipping' },
      { label: '경제', href: '/etc/economy' },
    ],
  },
];

/** 모바일 Sheet 내 네비게이션 */
export function MobileNav({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5 p-3 pt-10">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + '/');
        return (
          <div key={item.href} className="flex flex-col">
            <Link
              href={item.href}
              onClick={onClose}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <item.Icon size={15} className="shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
            {item.children && (
              <div className="ml-3 mt-0.5 mb-0.5 flex flex-col gap-0.5 border-l border-border pl-2">
                {item.children.map((c) => {
                  const cActive = pathname === c.href;
                  return (
                    <Link
                      key={c.href}
                      href={c.href}
                      onClick={onClose}
                      className={cn(
                        'rounded-md px-2 py-1 text-xs transition-colors',
                        cActive
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                      )}
                    >
                      {c.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

/** 좌측 사이드바 (축소 가능 + nested 메뉴 지원) */
export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        'hidden md:flex shrink-0 border-r border-border bg-muted/40 flex-col transition-all duration-200',
        collapsed ? 'w-12' : 'w-44'
      )}
    >
      <div
        className={cn(
          'flex items-center border-b border-border h-11',
          collapsed ? 'justify-center' : 'px-4 justify-between'
        )}
      >
        {!collapsed && (
          <Link
            href="/related-stocks"
            className="text-sm font-semibold text-foreground truncate hover:text-primary transition-colors"
          >
            한세모빌리티 BI
          </Link>
        )}
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title={collapsed ? '메뉴 열기' : '메뉴 닫기'}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      <nav className="flex flex-col gap-0.5 p-1.5 flex-1">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          const expanded = !collapsed && !!item.children;
          return (
            <div key={item.href} className="flex flex-col">
              <Link
                href={item.href}
                title={item.label}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium transition-colors',
                  collapsed ? 'justify-center' : '',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <item.Icon size={15} className="shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
              {expanded && item.children && (
                <div className="ml-3 mt-0.5 mb-0.5 flex flex-col gap-0.5 border-l border-border pl-2">
                  {item.children.map((c) => {
                    const cActive = pathname === c.href;
                    return (
                      <Link
                        key={c.href}
                        href={c.href}
                        title={c.label}
                        className={cn(
                          'rounded-md px-2 py-1 text-xs transition-colors',
                          cActive
                            ? 'bg-primary/10 text-primary font-medium'
                            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                        )}
                      >
                        {c.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
