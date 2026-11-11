import { redirect } from 'next/navigation';
import { CustomersTabs } from '@/components/customers/CustomersTabs';
import { getCurrentUser } from '@/lib/auth/get-current-user';
import { canAccess } from '@/lib/auth/permissions';
import { getCustomerTabs } from '@/lib/customers/source';

/**
 * /customers 트리 공통 레이아웃 — 제목 + 탭(요약 · 회사들). 경영관리 layout 과 같은 꼴.
 * 명단이 사외비라 탭을 읽기 전에 권한부터 본다(페이지들도 각자 한 번 더 막는다).
 */
export default async function CustomersLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user || !canAccess('/customers', user.role)) redirect('/');
  const tabs = await getCustomerTabs();

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">고객사</h1>
        <p className="text-xs text-muted-foreground mt-0.5">상장 고객사 · 사외비</p>
        <CustomersTabs tabs={tabs} />
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
