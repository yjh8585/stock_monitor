import StockPricesDashboard from '@/components/stock-prices/StockPricesDashboard';
import { getActiveStockCompanies } from '@/lib/stockPrices';
import type { StockCompany } from '@/lib/types';

export default async function StockPricesPage() {
  const companies = await getActiveStockCompanies();
  const koCollator = new Intl.Collator('ko', { sensitivity: 'base' });
  const byKorean = (a: StockCompany, b: StockCompany) => koCollator.compare(a.name_kr, b.name_kr);
  const krCompanies: StockCompany[] = companies.filter((c) => c.country === 'KR').sort(byKorean);
  const overseasCompanies: StockCompany[] = companies
    .filter((c) => c.country !== 'KR')
    .sort(byKorean);

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">주가 비교</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          국내·해외 종목 2개를 선택해 듀얼 Y축으로 비교 (5년 일봉, 종가 기준)
        </p>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <StockPricesDashboard krCompanies={krCompanies} overseasCompanies={overseasCompanies} />
      </div>
    </div>
  );
}
