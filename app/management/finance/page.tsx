import FinanceDashboard from '@/components/management/finance/FinanceDashboard';
import { getFinanceData, getLoanData } from '@/lib/finance/source';

/** 재무 페이지 (server) — finance_entries + loan_entries fetch 후 클라이언트에 전달. */
export default async function FinancePage() {
  const [{ rows }, { rows: loanRows }] = await Promise.all([getFinanceData(), getLoanData()]);
  return <FinanceDashboard rows={rows} loanRows={loanRows} />;
}
