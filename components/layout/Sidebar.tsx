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
  Building2,
  Info,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

const NAV_ITEMS = [
  { label: '관련주식', href: '/related-stocks', Icon: BarChart2 },
  { label: '비교', href: '/compare', Icon: ArrowLeftRight },
  { label: '국내자동차', href: '/domestic', Icon: Car },
  { label: 'OEM', href: '/oem', Icon: Factory },
  { label: '부품사 TOP100', href: '/parts-top100', Icon: Cog },
  { label: '한세그룹', href: '/hanse', Icon: Building2 },
  { label: '기타정보', href: '/etc', Icon: Info },
] as const;

/** 좌측 7개 탭 사이드바 (축소 가능) */
export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        'shrink-0 border-r border-border bg-muted/40 flex flex-col transition-all duration-200',
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
          <span className="text-sm font-semibold text-foreground truncate">Stock Monitor</span>
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
        {NAV_ITEMS.map(({ label, href, Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              title={label}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium transition-colors',
                collapsed ? 'justify-center' : '',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <Icon size={15} className="shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
