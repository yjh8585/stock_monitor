import PnlDashboard from '@/components/management/pnl/PnlDashboard';
import { getCostStructure, getPnlEntries } from '@/lib/pnl/source';

/** 손익 페이지 (server) — pnl_entries 전체 select 후 클라이언트에서 집계.
 *  fetch + cache + mapping은 lib/pnl/source.ts에 격리. */
export default async function PnlPage() {
  const [data, costStructure] = await Promise.all([getPnlEntries(), getCostStructure()]);
  return <PnlDashboard data={data} costStructure={costStructure} />;
}
