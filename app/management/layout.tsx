import { redirect } from 'next/navigation';

import { ManagementTabs } from '@/components/management/management-tabs';
import { getCurrentUser } from '@/lib/auth/get-current-user';

/**
 * /management 트리 공통 레이아웃 (server component).
 * - 상단 헤더(제목 + 데이터 갱신 주기 안내)
 * - 탭 네비게이션은 ManagementTabs(client) — 역할별 접근 가능 탭만 노출.
 *
 * proxy.ts가 인증을 강제하므로 user는 정상 흐름에선 null 아님.
 * 방어적으로 null 검사 후 /login으로 redirect (race condition 등 엣지케이스).
 */
export default async function ManagementLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">경영관리</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          자체 손익·재고·생산 데이터 · 매월 1회 갱신
        </p>
        <ManagementTabs role={user.role} />
      </div>
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
