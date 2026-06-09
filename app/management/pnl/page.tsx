import PnlDashboard from '@/components/management/pnl/PnlDashboard';
import { getCostStructure, getFixedVariable, getPreparedPnl } from '@/lib/pnl/source';

/** 손익 페이지 (server) — 서버에서 preparePnlData 호출 후 derived만 client 전달.
 *  raw 1000+ 행을 RSC payload로 보내지 않아 hydration 비용 감소. */
export default async function PnlPage() {
  const [prepared, costStructure, fixedVariable] = await Promise.all([
    getPreparedPnl(),
    getCostStructure(),
    getFixedVariable(),
  ]);
  return (
    <PnlDashboard prepared={prepared} costStructure={costStructure} fixedVariable={fixedVariable} />
  );
}
