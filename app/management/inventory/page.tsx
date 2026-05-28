import InventoryDashboard from '@/components/management/inventory/InventoryDashboard';
import { getInventoryData } from '@/lib/inventory/source';

/** 재고 페이지 (server) — inventory_entries fetch 후 클라이언트에 전달. */
export default async function InventoryPage() {
  const { rows } = await getInventoryData();
  return <InventoryDashboard rows={rows} />;
}
