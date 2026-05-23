import DomesticTable from '@/components/domestic/DomesticTable';
import { getDomesticData } from '@/lib/domestic/source';

/** 국내자동차 페이지 (server) — fetch + cache + mapping은 lib/domestic/source.ts에 격리. */
export default async function DomesticPage() {
  const { rows, rates } = await getDomesticData();

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">국내자동차</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          국내 자동차 부품사 {rows.length}개사 (매출액 기준) · 주가 장중 매시간 · 재무 분기 1회 갱신
        </p>
      </div>
      <div className="flex-1 overflow-auto">
        <DomesticTable rows={rows} rates={rates} enableRankCutoff />
      </div>
    </div>
  );
}
