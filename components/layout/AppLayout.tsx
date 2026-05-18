'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import Sidebar, { MobileNav } from './Sidebar';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import type { CurrentUser } from '@/lib/auth/get-current-user';

/** 팝업/로그인 경로에서는 사이드바를 숨기는 레이아웃 래퍼 */
export default function AppLayout({
  user,
  children,
}: {
  user: CurrentUser | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isPopup = pathname.startsWith('/stock-popup');
  const isLogin = pathname.startsWith('/login');

  if (isPopup || isLogin) {
    return <div className="h-full overflow-hidden">{children}</div>;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 모바일 전용 상단바 */}
      <div className="md:hidden flex items-center h-11 px-3 border-b border-border shrink-0">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger
            render={
              <button
                aria-label="메뉴 열기"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <Menu size={18} />
              </button>
            }
          />
          <SheetContent side="left" className="p-0 w-56 sm:max-w-56">
            <MobileNav user={user} onClose={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
        <Link
          href="/related-stocks"
          className="ml-3 text-sm font-semibold hover:text-primary transition-colors"
        >
          한세모빌리티 BI
        </Link>
      </div>
      {/* 데스크톱: 사이드바 + 메인 가로 배치 */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar user={user} />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
