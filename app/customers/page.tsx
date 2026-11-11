import { redirect } from 'next/navigation';
import CustomersOverviewTable from '@/components/customers/CustomersOverviewTable';
import { getCurrentUser } from '@/lib/auth/get-current-user';
import { canAccess } from '@/lib/auth/permissions';
import { todaySeoul } from '@/lib/currentYear';
import { getCustomersOverview } from '@/lib/customers/source';

/** 고객사 요약 페이지 — 상장 고객사별 우리 매출 비중·주가·최근 분기 실적(사외비). */
export default async function CustomersPage() {
  // proxy.ts 가 먼저 막지만, 사외비 조회 전에 페이지에서도 한 번 더 막는다(app/hansae 와 같은 패턴).
  const user = await getCurrentUser();
  if (!user || !canAccess('/customers', user.role)) redirect('/');
  const { rows, windowLabel } = await getCustomersOverview();
  // 제목·탭은 app/customers/layout.tsx 가 그린다.
  return (
    <div className="h-full overflow-auto p-4 space-y-2">
      <p className="text-xs text-muted-foreground">
        우리 매출 비중(손익 연결 최근 12개월) · 주가 · 최근 분기 실적 · 가이던스 변경 · 다음 실적 ·
        회사 이름을 누르면 상세로 이동
      </p>
      <CustomersOverviewTable rows={rows} windowLabel={windowLabel} today={todaySeoul()} />
    </div>
  );
}
