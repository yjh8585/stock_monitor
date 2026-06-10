import FinanceDashboard from '@/components/management/finance/FinanceDashboard';
import { getFinanceData } from '@/lib/finance/source';

/** 재무 페이지 (server) — finance_entries fetch 후 클라이언트에 전달. */
export default async function FinancePage() {
  const { rows } = await getFinanceData();
  return <FinanceDashboard rows={rows} />;
}
