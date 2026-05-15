/**
 * 손익 데이터 집계 헬퍼 (순수 함수).
 *
 * - `pnl_entries` 행을 클라이언트에서 GROUP BY / SUM
 * - 별도 연간 데이터는 DB에 없으므로 월별 → 연간 derive
 * - useMemo와 함께 사용 가능 (입력 불변 시 동일 결과)
 */

import type { AggregatedRow, Basis, DimensionKey, MetricKey, PnlEntry } from './types';
import { METRIC_ORDER } from './types';

/** 부동소수 누적 오차를 잘라내는 헬퍼 (백만원 단위, 소수 4자리까지 의미 있음) */
const ROUND_DECIMALS = 4;
function round(n: number): number {
  const f = 10 ** ROUND_DECIMALS;
  return Math.round(n * f) / f;
}

/** 빈 집계 행 한 개 생성 */
function emptyRow(key: string, dims: Record<DimensionKey, string>): AggregatedRow {
  return {
    key,
    dims,
    revenue: 0,
    material_cost: 0,
    labor_cost: 0,
    expense: 0,
    sga: 0,
    rnd: 0,
    op_income: 0,
  };
}

/** basis 필터 */
export function filterByBasis(entries: readonly PnlEntry[], basis: Basis): PnlEntry[] {
  return entries.filter((e) => e.basis === basis);
}

/**
 * 표시할 연도 라벨 정렬.
 *
 * 표시 정책 (사용자 확정):
 * - 연결: '2023' | '2024' | '2025(E)' | '2026' | '2026(P)' — DB year_label 그대로
 * - 별도: '2023' | '2024' | '2025' — DB엔 월별만 있으므로 period_year → 4자리 라벨
 *
 * 입력 entries는 (a) raw 월별 행 또는 (b) deriveStandaloneAnnual로 변환된 연간 행 어느 쪽이든
 * 받을 수 있도록 두 경우 모두 처리한다. 별도 연간 derive 결과는 year_label도 String(period_year)로
 * 채워져 있으므로 사실상 동일 로직.
 */
export function getDisplayYearLabels(entries: readonly PnlEntry[], basis: Basis): string[] {
  const labels = new Set<string>();
  for (const e of entries) {
    if (e.basis !== basis) continue;
    if (basis === 'consolidated') {
      // 연결: 연간 행(period_month=0)만 라벨에 사용 — DB에 이미 적재됨
      if (e.period_month !== 0) continue;
      labels.add(e.year_label);
    } else {
      // 별도: period_year 기준 4자리 라벨. 월별/연간 어느 입력이든 동일하게 동작.
      const y = e.period_year;
      if (y >= 2023 && y <= 2025) labels.add(String(y));
    }
  }
  if (basis === 'consolidated') {
    // 연결: 2023~2026만 (라벨 앞 4글자 기준)
    return Array.from(labels)
      .filter((lbl) => {
        const y = parseInt(lbl.slice(0, 4), 10);
        return y >= 2023 && y <= 2026;
      })
      .sort();
  }
  return Array.from(labels).sort();
}

/**
 * 별도 월별 → 연간 합계 derive.
 *
 * DB에는 별도 연간(period_month=0) 행이 없으므로, 같은 (basis, period_year, sil, division,
 * factory, product, customer)로 월별 행을 합산해 period_month=0 행으로 변환한다.
 *
 * 입력은 전체 별도 월별 (period_month 1~12) 행이고, 출력은 (period_year, dims) 별 1행씩.
 * year_label은 period_year 4자리 문자열.
 */
export function deriveStandaloneAnnual(monthly: readonly PnlEntry[]): PnlEntry[] {
  const groups = new Map<string, PnlEntry>();
  for (const r of monthly) {
    if (r.basis !== 'standalone') continue;
    if (r.period_month < 1 || r.period_month > 12) continue;
    const key = [r.period_year, r.sil, r.division, r.factory, r.product, r.customer].join('|');
    const existing = groups.get(key);
    if (existing) {
      existing.revenue = sumNullable(existing.revenue, r.revenue);
      existing.material_cost = sumNullable(existing.material_cost, r.material_cost);
      existing.labor_cost = sumNullable(existing.labor_cost, r.labor_cost);
      existing.expense = sumNullable(existing.expense, r.expense);
      existing.sga = sumNullable(existing.sga, r.sga);
      existing.rnd = sumNullable(existing.rnd, r.rnd);
      existing.op_income = sumNullable(existing.op_income, r.op_income);
    } else {
      groups.set(key, {
        basis: 'standalone',
        year_label: String(r.period_year),
        period_year: r.period_year,
        period_month: 0,
        is_plan: false,
        is_estimate: false,
        sil: r.sil,
        division: r.division,
        factory: r.factory,
        product: r.product,
        customer: r.customer,
        revenue: r.revenue,
        material_cost: r.material_cost,
        labor_cost: r.labor_cost,
        expense: r.expense,
        sga: r.sga,
        rnd: r.rnd,
        op_income: r.op_income,
      });
    }
  }
  // 부동소수 정리
  for (const row of groups.values()) {
    row.revenue = roundNullable(row.revenue);
    row.material_cost = roundNullable(row.material_cost);
    row.labor_cost = roundNullable(row.labor_cost);
    row.expense = roundNullable(row.expense);
    row.sga = roundNullable(row.sga);
    row.rnd = roundNullable(row.rnd);
    row.op_income = roundNullable(row.op_income);
  }
  return Array.from(groups.values());
}

function sumNullable(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

function roundNullable(n: number | null): number | null {
  return n == null ? null : round(n);
}

/**
 * 연도 라벨로 필터 (basis별 연간 행).
 * - 연결: DB의 연간 행 (period_month=0)에서 year_label === target
 * - 별도: deriveStandaloneAnnual 결과에서 period_year === parseInt(label)
 */
export function entriesForYear(
  annualEntries: readonly PnlEntry[],
  basis: Basis,
  yearLabel: string
): PnlEntry[] {
  if (basis === 'consolidated') {
    return annualEntries.filter(
      (e) => e.basis === 'consolidated' && e.period_month === 0 && e.year_label === yearLabel
    );
  }
  // 별도 — derive된 결과는 period_year로 매칭
  const y = parseInt(yearLabel, 10);
  return annualEntries.filter(
    (e) => e.basis === 'standalone' && e.period_month === 0 && e.period_year === y
  );
}

/**
 * dims 기준 GROUP BY + SUM. 빈 dims면 단일 합계 행 1개 반환.
 */
export function aggregateBy(
  entries: readonly PnlEntry[],
  dims: readonly DimensionKey[]
): AggregatedRow[] {
  const groups = new Map<string, AggregatedRow>();
  for (const e of entries) {
    const dimValues = {
      sil: e.sil,
      division: e.division,
      factory: e.factory,
      product: e.product,
      customer: e.customer,
    };
    const key = dims.length === 0 ? '__total__' : dims.map((d) => dimValues[d]).join(' | ');
    let row = groups.get(key);
    if (!row) {
      row = emptyRow(key, dimValues);
      groups.set(key, row);
    }
    row.revenue += e.revenue ?? 0;
    row.material_cost += e.material_cost ?? 0;
    row.labor_cost += e.labor_cost ?? 0;
    row.expense += e.expense ?? 0;
    row.sga += e.sga ?? 0;
    row.rnd += e.rnd ?? 0;
    row.op_income += e.op_income ?? 0;
  }
  // 부동소수 정리
  for (const row of groups.values()) {
    for (const m of METRIC_ORDER) {
      row[m] = round(row[m]);
    }
  }
  return Array.from(groups.values());
}

/**
 * dim 차원의 unique 값 정렬된 배열 (빈 문자열 제외).
 *
 * basis 필터 후 연간 행만 대상으로 한다.
 */
export function getUniqueValues(
  entries: readonly PnlEntry[],
  dim: DimensionKey,
  basis: Basis
): string[] {
  const values = new Set<string>();
  for (const e of entries) {
    if (e.basis !== basis) continue;
    const v = e[dim];
    if (typeof v === 'string' && v.length > 0) values.add(v);
  }
  return Array.from(values).sort((a, b) => a.localeCompare(b, 'ko'));
}

/**
 * 매출 대비 %를 계산. 매출이 0이면 null.
 */
export function ratioOfRevenue(value: number, revenue: number): number | null {
  if (!revenue) return null;
  return (value / revenue) * 100;
}

/** 단일 metric 값을 가져온다 (타입 안전) */
export function getMetric(row: AggregatedRow, metric: MetricKey): number {
  return row[metric];
}

/**
 * 월별 entries를 1~12월로 GROUP BY + SUM (선택 연도, basis, dims 필터링).
 *
 * 반환: 12개 원소 배열 (월별 0 채움). 데이터 없으면 0.
 */
export function aggregateMonthly(
  entries: readonly PnlEntry[],
  basis: Basis,
  year: number,
  filter?: (e: PnlEntry) => boolean
): AggregatedRow[] {
  const months: AggregatedRow[] = [];
  for (let m = 1; m <= 12; m += 1) {
    const monthEntries = entries.filter((e) => {
      if (e.basis !== basis) return false;
      if (e.period_year !== year) return false;
      if (e.period_month !== m) return false;
      if (filter && !filter(e)) return false;
      return true;
    });
    const dims: Record<DimensionKey, string> = {
      sil: '',
      division: '',
      factory: '',
      product: '',
      customer: '',
    };
    const row: AggregatedRow = {
      key: String(m),
      dims,
      revenue: 0,
      material_cost: 0,
      labor_cost: 0,
      expense: 0,
      sga: 0,
      rnd: 0,
      op_income: 0,
    };
    for (const e of monthEntries) {
      row.revenue += e.revenue ?? 0;
      row.material_cost += e.material_cost ?? 0;
      row.labor_cost += e.labor_cost ?? 0;
      row.expense += e.expense ?? 0;
      row.sga += e.sga ?? 0;
      row.rnd += e.rnd ?? 0;
      row.op_income += e.op_income ?? 0;
    }
    for (const mk of METRIC_ORDER) {
      row[mk] = round(row[mk]);
    }
    months.push(row);
  }
  return months;
}

/**
 * 월별 entries를 1~12월로 GROUP BY 하되 dims 차원도 합산.
 *
 * 반환: month → (dimKey → AggregatedRow). 동일 (month, dimKey) 조합 합산.
 */
export function aggregateMonthlyByDim(
  entries: readonly PnlEntry[],
  basis: Basis,
  year: number,
  dims: readonly DimensionKey[]
): Map<number, AggregatedRow[]> {
  const result = new Map<number, AggregatedRow[]>();
  for (let m = 1; m <= 12; m += 1) {
    const monthEntries = entries.filter(
      (e) => e.basis === basis && e.period_year === year && e.period_month === m
    );
    const agg = aggregateBy(monthEntries, dims);
    result.set(m, agg);
  }
  return result;
}

/**
 * 연도 라벨 후보 (월별 데이터 기준).
 *
 * - 연결 월별: 2025, 2026
 * - 별도 월별: 2022~2025
 */
export function getMonthlyYears(entries: readonly PnlEntry[], basis: Basis): number[] {
  const years = new Set<number>();
  for (const e of entries) {
    if (e.basis !== basis) continue;
    if (e.period_month < 1 || e.period_month > 12) continue;
    years.add(e.period_year);
  }
  return Array.from(years).sort((a, b) => a - b);
}

/**
 * 매출총이익 derived (백만원). null 안전.
 */
export function grossProfitOf(row: AggregatedRow): number {
  return row.revenue - row.material_cost - row.labor_cost - row.expense;
}

/**
 * 영업이익률 (%). 매출 0이면 null.
 */
export function opMarginOf(row: AggregatedRow): number | null {
  if (!row.revenue) return null;
  return (row.op_income / row.revenue) * 100;
}
