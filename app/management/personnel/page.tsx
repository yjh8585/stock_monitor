import PersonnelDashboard from '@/components/management/personnel/PersonnelDashboard';
import { getPersonnelData } from '@/lib/personnel/source';

/** 인원 페이지 (server) — personnel_entries fetch 후 클라이언트에 전달. */
export default async function PersonnelPage() {
  const { rows } = await getPersonnelData();
  return <PersonnelDashboard rows={rows} />;
}
