import ChinaDashboard from '@/components/oem-companies/china/ChinaDashboard';
import { ymLabel } from '@/components/oem/helpers';
import { getChinaData } from '@/lib/oem-companies/china/source';

/**
 * OEM 「중국」 탭 — MarkLines 중국 전용 통계(승용 생산 · 차급 · 수출).
 * 헤더·탭 네비는 app/oem/layout.tsx. 경위·결정 = docs/plans/2026-10-29-oem-china-tab.md
 */
export default async function OemChinaPage() {
  const data = await getChinaData();

  if (!data) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm font-medium">데이터 수집 대기 중</p>
          <p className="mt-1 text-xs text-muted-foreground">
            scripts/sync_oem_china_excel.py --backfill 로 첫 적재를 하면 표시됩니다.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="px-6 py-2 border-b border-border bg-muted/30">
        <p className="text-xs text-muted-foreground">
          MarkLines 중국 통계 · 승용(세단·SUV·MPV·미니밴) · {ymLabel(data.firstYm)}~
          {ymLabel(data.periods.anchorYm)} · 묶음 = 중국 모회사(합작사는 중국 측) · 주 1회(월) 갱신
        </p>
      </div>
      <ChinaDashboard data={data} />
    </>
  );
}
