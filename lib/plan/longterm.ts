/**
 * 중장기 매출 전망(longterm_revenue_plan) 타입 + 순수 빌더.
 *
 * 계획 페이지 차트 1번 전용. fetch/캐시는 lib/plan/source.ts가 담당하고
 * 여기는 순수 계산만 둔다(단위 테스트 대상).
 *
 * 단위: DB(`value_mwon`)는 엑셀 원본 그대로 **백만원**, 화면 표시는 **억원**이다.
 * 환산은 buildLongtermPoints()가 `÷100`으로 수행한다(재무 탭 `value_mwon / 100`과 동일 규칙).
 *
 * 엑셀 'N/A'는 value_mwon = null로 적재되며, 전부 null인 계열은 activeSeries()에서 탈락해
 * 막대·범례에 나타나지 않는다(0으로 그리면 '전망 0원'이라는 거짓 사실을 표시하게 되므로).
 */

/** 계열 3종 — DB CHECK ↔ sync 적재값 ↔ UI 라벨을 한글 그대로 일치시킨다. 표시 순서이기도 하다. */
export const LONGTERM_SERIES = ['수주 Volume', '고객 EDI 100%', '한세 전망'] as const;
export type LongtermSeries = (typeof LONGTERM_SERIES)[number];

/** longterm_revenue_plan 테이블 row */
export interface LongtermRow {
  basis_year: number;
  basis_quarter: number;
  series: LongtermSeries;
  period_year: number;
  value_mwon: number | null;
  fx_note: string | null;
}

/** 드롭다운 옵션 */
export interface LongtermBasis {
  /** 드롭다운 value 겸 표시 라벨 ('2026.2Q') */
  key: string;
  year: number;
  quarter: number;
}

/** 막대 그룹 1개(= 전망 연도 1개). 계열명이 그대로 recharts dataKey가 된다. 값 단위 **억원**. */
export type LongtermPoint = { year: number } & Partial<Record<LongtermSeries, number | null>>;

/** 백만원 → 억원. 소수 2자리에서 반올림(부동소수 잔재 제거). */
function toEok(mwon: number | null): number | null {
  return mwon == null ? null : Math.round((mwon / 100) * 100) / 100;
}

/** (연도, 분기) → 드롭다운 키. */
export function basisKey(year: number, quarter: number): string {
  return `${year}.${quarter}Q`;
}

/** 드롭다운 목록 — 중복 제거 + 최신 기준 우선(연도 desc, 분기 desc). */
export function listBases(rows: readonly LongtermRow[]): LongtermBasis[] {
  const seen = new Map<string, LongtermBasis>();
  for (const r of rows) {
    const key = basisKey(r.basis_year, r.basis_quarter);
    if (!seen.has(key)) seen.set(key, { key, year: r.basis_year, quarter: r.basis_quarter });
  }
  return [...seen.values()].sort((a, b) => b.year - a.year || b.quarter - a.quarter);
}

/** 해당 기준에서 값이 하나라도 있는 계열만 LONGTERM_SERIES 순서로. */
export function activeSeries(rows: readonly LongtermRow[], basis: string): LongtermSeries[] {
  const has = new Set<LongtermSeries>();
  for (const r of rows) {
    if (basisKey(r.basis_year, r.basis_quarter) !== basis) continue;
    if (r.value_mwon != null) has.add(r.series);
  }
  return LONGTERM_SERIES.filter((s) => has.has(s));
}

/** 해당 기준의 연도별 포인트 — 연도 오름차순, **백만원→억원 환산**. 값 없는 계열은 null 유지. */
export function buildLongtermPoints(rows: readonly LongtermRow[], basis: string): LongtermPoint[] {
  const byYear = new Map<number, LongtermPoint>();
  for (const r of rows) {
    if (basisKey(r.basis_year, r.basis_quarter) !== basis) continue;
    let p = byYear.get(r.period_year);
    if (!p) {
      p = { year: r.period_year };
      byYear.set(r.period_year, p);
    }
    p[r.series] = toEok(r.value_mwon);
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}

/** 해당 기준의 환율 기준 문구(엑셀 원문). 없으면 null. */
export function fxNote(rows: readonly LongtermRow[], basis: string): string | null {
  for (const r of rows) {
    if (basisKey(r.basis_year, r.basis_quarter) !== basis) continue;
    if (r.fx_note) return r.fx_note;
  }
  return null;
}
