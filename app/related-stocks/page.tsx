import StockTable from '@/components/related-stocks/StockTable';
import { getRelatedStocksData } from '@/lib/related-stocks/source';

/** 관련회사 페이지 (server) — fetch + cache + mapping은 lib/related-stocks/source.ts에 격리. */
export default async function RelatedStocksPage() {
  const { rows, rates } = await getRelatedStocksData();

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">관련회사</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          자동차 산업 주요 기업 {rows.length}개사 실적·주가 · 주가 장중 매시간 · 재무 분기 1회 갱신
        </p>
      </div>
      <div className="flex-1 overflow-auto">
        <StockTable rows={rows} rates={rates} />
      </div>
    </div>
  );
}
