import OrgChartViewer from '@/components/management/org-chart/OrgChartViewer';
import { getOrgCharts } from '@/lib/org-chart/source';

/** 조직도 페이지 (server) — org_charts 메타 fetch 후 클라이언트에 전달. */
export default async function OrgChartPage() {
  const charts = await getOrgCharts();
  return <OrgChartViewer charts={charts} />;
}
