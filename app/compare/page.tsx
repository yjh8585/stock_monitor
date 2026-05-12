import CompareDashboard from '@/components/compare/CompareDashboard';
import { getCompareCompanies, getCompareFinancials } from '@/lib/compareData';

export default async function ComparePage() {
  const companies = await getCompareCompanies();
  const rowsByCompanyId = await getCompareFinancials(companies.map((c) => c.id));

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">재무 비교</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          한세모빌리티(기준) + 비교 대상 최대 2개사 · 매출/이익률/회전율 등 10개 지표 연도별 비교
        </p>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <CompareDashboard companies={companies} rowsByCompanyId={rowsByCompanyId} />
      </div>
    </div>
  );
}
