import PlanDashboard from '@/components/management/plan/PlanDashboard';
import { getPlanData } from '@/lib/plan/source';

/** 계획 페이지 (server) — getPlanData()로 사외비 pnl_plan + 중장기 전망 + 실적 + 환율 fetch 후 클라이언트 전달. */
export default async function PlanPage() {
  const { plan, prepared, usdKrw, longterm } = await getPlanData();
  return <PlanDashboard rows={plan} prepared={prepared} usdKrw={usdKrw} longterm={longterm} />;
}
