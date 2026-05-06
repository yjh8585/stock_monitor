'use client';

import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';

/** 팝업 경로에서는 사이드바를 숨기는 레이아웃 래퍼 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPopup = pathname.startsWith('/stock-popup');

  if (isPopup) {
    return <div className="h-full overflow-hidden">{children}</div>;
  }

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
