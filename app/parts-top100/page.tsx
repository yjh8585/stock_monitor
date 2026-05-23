import DomesticTable from '@/components/domestic/DomesticTable';
import { getPartsTop100Data } from '@/lib/parts-top100/source';

/** 부품사 Top100 페이지 (server) — fetch + cache + mapping은 lib/parts-top100/source.ts에 격리. */
export default async function PartsTop100Page() {
  const { rows, rates } = await getPartsTop100Data();

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">부품사 Top100</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          글로벌 자동차 부품사 Top100 — 매출액 기준 (Berylls 2025) · {rows.length}개사 · 주가 장중
          매시간 · 재무 분기 1회 갱신
        </p>
      </div>
      <div className="flex-1 overflow-auto">
        <DomesticTable rows={rows} rates={rates} groupLabel="국가" />
      </div>
    </div>
  );
}
