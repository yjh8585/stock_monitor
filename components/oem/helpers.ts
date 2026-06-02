import type {
  OemRankRow,
  OemSalesGroupCountryMonth,
  OemSalesGroupMonth,
  OemSalesGroupPtMonth,
} from '@/lib/types';

/** 판매량 단위: 백만대(M) / 만대 / 대 자동 변환 */
export function fmtUnits(n: number | null): string {
  if (n == null) return '—';
  if (n >= 10_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return n.toLocaleString('ko-KR');
}

/** 천 단위 콤마 (Tooltip 정확 표기용) */
export function fmtFull(n: number | null): string {
  if (n == null) return '—';
  return n.toLocaleString('ko-KR');
}

/** OEM 그룹/Maker 이름을 차트 라벨용으로 단축.
 *  - 첫 '(' 이전까지 잘라낸다 (괄호 안 풀네임 제거)
 *  - 그 후 슬래시('/')로 나뉘면 첫 토큰만 사용
 *  - 예: 'SAIC (Shanghai...)' → 'SAIC', 'Changan/Chana(...)' → 'Changan'
 *  - 모델명에는 슬래시(예: 'Ram P/U')가 의미있어 사용 금지
 */
export function shortenOemName(name: string): string {
  if (!name) return name;
  const beforeParen = name.split('(')[0].trim();
  const firstToken = beforeParen.split('/')[0].trim();
  return firstToken || name;
}

/** YYYYMM → 연도 */
export function ymYear(ym: number): number {
  return Math.floor(ym / 100);
}

/** YYYYMM → 월 */
export function ymMonth(ym: number): number {
  return ym % 100;
}

/** YYYYMM → "2025.03" 형식 */
export function ymLabel(ym: number): string {
  return `${ymYear(ym)}.${String(ymMonth(ym)).padStart(2, '0')}`;
}

/** rows에서 group별 [start..end] 월 구간 합계 dict */
export function sumByGroup(
  rows: OemSalesGroupMonth[],
  ymStart: number,
  ymEnd: number
): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (r.year_month < ymStart || r.year_month > ymEnd) continue;
    m.set(r.oem_group, (m.get(r.oem_group) ?? 0) + r.sales);
  }
  return m;
}

/** 순위 계산: cur/prev Map → OemRankRow[] (cur 기준 정렬) */
export function buildRanking(
  cur: Map<string, number>,
  prev: Map<string, number>,
  topN: number
): OemRankRow[] {
  const sortedCur = [...cur.entries()].sort((a, b) => b[1] - a[1]);
  const sortedPrev = [...prev.entries()].sort((a, b) => b[1] - a[1]);
  const prevRankMap = new Map(sortedPrev.map(([g], i) => [g, i + 1]));

  return sortedCur.slice(0, topN).map(([oem_group, sales], i) => {
    const sales_prev = prev.get(oem_group) ?? 0;
    const rank = i + 1;
    const rank_prev = prevRankMap.get(oem_group);
    return {
      rank,
      oem_group,
      sales,
      sales_prev,
      yoy: sales_prev > 0 ? ((sales - sales_prev) / sales_prev) * 100 : null,
      rank_prev,
      rank_change: rank_prev != null ? rank_prev - rank : null, // 양수=상승
    };
  });
}

/** 연도별 합계 dict (group별) */
export function annualByGroup(rows: OemSalesGroupMonth[]): Map<string, Map<number, number>> {
  const m = new Map<string, Map<number, number>>();
  for (const r of rows) {
    const yr = ymYear(r.year_month);
    if (!m.has(r.oem_group)) m.set(r.oem_group, new Map());
    const inner = m.get(r.oem_group)!;
    inner.set(yr, (inner.get(yr) ?? 0) + r.sales);
  }
  return m;
}

/** 월별 합계 (전체 시장 단일 라인) */
export function totalByMonth(rows: OemSalesGroupMonth[]): { ym: number; sales: number }[] {
  const m = new Map<number, number>();
  for (const r of rows) m.set(r.year_month, (m.get(r.year_month) ?? 0) + r.sales);
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([ym, sales]) => ({ ym, sales }));
}

/** 특정 연도 PowerTrain별 합계 (group×pt 행에서) */
export function ptSumByGroup(
  rows: OemSalesGroupPtMonth[],
  ymStart: number,
  ymEnd: number
): Map<string, Map<string, number>> {
  // group → pt → sales
  const m = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (r.year_month < ymStart || r.year_month > ymEnd) continue;
    if (!m.has(r.oem_group)) m.set(r.oem_group, new Map());
    const inner = m.get(r.oem_group)!;
    inner.set(r.powertrain, (inner.get(r.powertrain) ?? 0) + r.sales);
  }
  return m;
}

/** Country별 합계 (group×country 행에서) */
export function sumByCountry(
  rows: OemSalesGroupCountryMonth[],
  ymStart: number,
  ymEnd: number
): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (r.year_month < ymStart || r.year_month > ymEnd) continue;
    m.set(r.country, (m.get(r.country) ?? 0) + r.sales);
  }
  return m;
}

/** 2026 YTD: 2026년 데이터가 채워진 마지막 월 */
export function findLatestYm(rows: OemSalesGroupMonth[], year: number): number | null {
  let max = 0;
  for (const r of rows) {
    if (ymYear(r.year_month) === year && r.year_month > max) max = r.year_month;
  }
  return max || null;
}

// 색 팔레트는 도메인 중립 위치로 이동(2026-06-02). 하위호환 위해 re-export.
// docs/chart-guide.md §6 제안 4.
export { OEM_COLORS, PT_COLORS, PT_ORDER } from '@/components/charts/palette';
