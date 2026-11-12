// 현대차 탭(/oem/hyundai)과 고객사 상세(/customers/[slug] 「지역·차종·점유율」)가 같은 인자로 부품을 그리도록 모은 인자 빚기.
// 원래 app/oem/hyundai/page.tsx 안에 있던 것 — page 파일은 다른 곳에서 import 할 수 없어 옮겼다(2026-11-12 · 결정 C1).
import type { FactoryOption } from '@/components/oem-companies/common/CompanyTopModelsTable';
import type { HyundaiPageData } from '@/lib/oem-companies/hyundai/source';

/** IR 정합성 요약 문구 — IR Regions 통합 차트 footer. */
export function buildIrFooterText(
  latestYear: string | null,
  latestIr: number,
  latestDb: number,
  latestDiff: number,
  latestPct: number | null
): string {
  const base =
    '연간(ir-summary, 9 region 도매 합) ↔ 분기(ir-quarterly, IR PDF p.5~6 region 분기 도매)를 토글로 비교. 단위: 연간=대, 분기=천대. 2021-2022는 8 region(러시아 포함).';
  if (latestYear == null) return base;
  const fmt = (n: number) => n.toLocaleString('ko-KR');
  const pct = latestPct == null ? '' : ` (${latestPct >= 0 ? '+' : ''}${latestPct.toFixed(3)}%)`;
  const match =
    Math.abs(latestDiff) < 1000
      ? '거의 일치'
      : `${latestDiff >= 0 ? '+' : ''}${fmt(latestDiff)}대${pct}`;
  return `${base} · 정합성(연간): ${latestYear}년 IR ${fmt(latestIr)}대 vs DB ${fmt(latestDb)}대 — ${match}`;
}

/** IR Regions 차트 footer — 데이터의 정합성 칸으로 buildIrFooterText 를 부른다. */
export function irFooterOf(data: HyundaiPageData): string {
  return buildIrFooterText(
    data.irComparison.latestYear,
    data.irComparison.latestIrTotal,
    data.irComparison.latestDbTotal,
    data.irComparison.latestDiff,
    data.irComparison.latestDiffPct
  );
}

/** CompanyTopModelsTable 의 factoryOptions 형식으로 변환 (#7 region 분기 포함). */
export function factoryOptionsOf(data: HyundaiPageData): Record<string, FactoryOption> {
  const factoryOptions: Record<string, FactoryOption> = {};
  for (const [code, entry] of Object.entries(data.topModels.factories)) {
    factoryOptions[code] = entry.regions
      ? { result: entry.result, regions: entry.regions }
      : entry.result;
  }
  return factoryOptions;
}
