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
 * - 별도: '2023' | '2024' | '2025' | '2026' — DB엔 월별만 있으므로 period_year → 4자리 라벨 (2026 YTD 포함)
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
      if (y >= 2023 && y <= 2026) labels.add(String(y));
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
 * 월별 → 연간 합계 derive (basis별 generic).
 *
 * 같은 (basis, period_year, sil, division, factory, product, customer)로 월별 행을 합산해
 * period_month=0 행으로 변환한다. (선택) `yearFilter`로 특정 연도만 대상.
 *
 * - 별도(standalone): DB에 연간 행이 없어 전체 연도에 대해 derive
 * - 연결(consolidated): 2026 YTD처럼 연간 행이 없는 특정 연도만 derive (P/E 계획·추정 외 실적 누적)
 *
 * year_label은 period_year 4자리 문자열. is_plan/is_estimate는 false.
 */
export function deriveAnnualFromMonthly(
  monthly: readonly PnlEntry[],
  basis: Basis,
  yearFilter?: (year: number) => boolean
): PnlEntry[] {
  const groups = new Map<string, PnlEntry>();
  for (const r of monthly) {
    if (r.basis !== basis) continue;
    if (r.period_month < 1 || r.period_month > 12) continue;
    if (yearFilter && !yearFilter(r.period_year)) continue;
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
        basis,
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

/** 별도 월별 → 연간 derive (전체 연도). 기존 호출자 호환용 wrapper. */
export function deriveStandaloneAnnual(monthly: readonly PnlEntry[]): PnlEntry[] {
  return deriveAnnualFromMonthly(monthly, 'standalone');
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
 * dim 차원의 unique 값을, 지정한 연도(yearLabel)의 매출 desc 기준으로 정렬해 반환.
 *
 * - 해당 연도에 매출이 없는 값(다른 연도에만 존재)은 0으로 간주되어 뒤로 밀린다.
 * - 매출 동률은 한국어 가나다순으로 정렬.
 * - basis 필터 + period_month=0(연간) 필터를 거친 후 처리.
 */
export function getUniqueValuesByRevenue(
  entries: readonly PnlEntry[],
  dim: DimensionKey,
  basis: Basis,
  yearLabel: string
): string[] {
  // 모든 unique 값 수집 (대상 연도에 없는 값도 표시)
  const allValues = new Set<string>();
  for (const e of entries) {
    if (e.basis !== basis) continue;
    if (e.period_month !== 0) continue;
    const v = e[dim];
    if (typeof v === 'string' && v.length > 0) allValues.add(v);
  }
  // 지정 연도 매출 합산
  const latest = entriesForYear(entries, basis, yearLabel);
  const agg = aggregateBy(latest, [dim]);
  const revByDim = new Map<string, number>();
  for (const r of agg) {
    const v = r.dims[dim];
    if (typeof v === 'string' && v.length > 0) revByDim.set(v, r.revenue);
  }
  const result = Array.from(allValues);
  result.sort((a, b) => {
    const ra = revByDim.get(a) ?? 0;
    const rb = revByDim.get(b) ?? 0;
    if (rb !== ra) return rb - ra;
    return a.localeCompare(b, 'ko');
  });
  return result;
}

/**
 * 진행 중 연도(YTD) 판정 — 특정 연도의 monthly 데이터에서 가장 큰 period_month를 반환.
 *
 * - 0: 해당 연도 월별 데이터 없음
 * - 12: 연간 완료 (1~12월 전부 적재)
 * - 1~11: YTD (1~N월 누적까지만 적재됨)
 *
 * 7·9번 차트에서 기준 연도가 YTD면 비교 연도도 동일 월수까지 잘라 비교한다.
 */
export function ytdMonthsOfYear(monthly: readonly PnlEntry[], basis: Basis, year: number): number {
  let maxM = 0;
  for (const e of monthly) {
    if (e.basis !== basis) continue;
    if (e.period_year !== year) continue;
    if (e.period_month < 1 || e.period_month > 12) continue;
    if (e.period_month > maxM) maxM = e.period_month;
  }
  return maxM;
}

/**
 * 연간 또는 YTD 누적 행 반환.
 *
 * - ytdMonths가 1~11이면 monthly에서 해당 연도 1~ytdMonths월 행만 반환 → aggregateBy로 합산하면 YTD 누적.
 * - 그 외(0 또는 12 이상)는 entriesForYear와 동일.
 */
export function entriesForYearOrYtd(
  annualEntries: readonly PnlEntry[],
  monthly: readonly PnlEntry[],
  basis: Basis,
  yearLabel: string,
  ytdMonths: number
): PnlEntry[] {
  if (ytdMonths >= 1 && ytdMonths <= 11) {
    const m = yearLabel.match(/(\d{4})/);
    if (!m) return [];
    const y = parseInt(m[1], 10);
    return monthly.filter(
      (e) =>
        e.basis === basis &&
        e.period_year === y &&
        e.period_month >= 1 &&
        e.period_month <= ytdMonths
    );
  }
  return entriesForYear(annualEntries, basis, yearLabel);
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
 * - 별도 월별: 2022~2026
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

/**
 * YoY 비교 차트(MarginScatter / YoyProductCustomer)의 1~5단계 공통 준비물.
 *
 * 두 차트의 useMemo 5개가 글자 단위로 동일했던 패턴을 한 함수에 집약한다.
 * 6단계(차원별 aggregateBy) 이후는 차트마다 차원·매핑이 달라 호출자가 직접 수행.
 *
 * 정책 (기존 코드와 동일):
 * - 2023(_)으로 시작하는 라벨은 yearLabels에서 제외 (2022가 없어 yoy=0)
 * - baseYearLabel이 yearLabels에 없으면 최신 연도로 fallback
 * - effCompare는 effBase의 4자리 prefix - 1로 매칭 ('2025(E)' → '2024')
 * - 기준이 YTD(period_month=1..11만 적재된 진행 중 연도)이면 비교도 동일 월수까지 잘라 비교
 */
export interface YoYView {
  yearLabels: string[];
  effBase: string;
  effCompare: string;
  ytdMonths: number;
  baseEntries: PnlEntry[];
  compareEntries: PnlEntry[];
}

export function prepareYoYView(
  annual: readonly PnlEntry[],
  monthly: readonly PnlEntry[],
  basis: Basis,
  baseYearLabel: string
): YoYView {
  // 1) yearLabels — '2023(_)' prefix 제외 (2022 데이터 없어 yoy=0)
  const yearLabels = getDisplayYearLabels(annual, basis).filter((y) => !y.startsWith('2023'));

  // 2) effBase — baseYearLabel이 yearLabels에 있으면 그대로, 아니면 최신 연도 fallback
  const defaultBase = yearLabels[yearLabels.length - 1] ?? '';
  const effBase = baseYearLabel && yearLabels.includes(baseYearLabel) ? baseYearLabel : defaultBase;

  // 3) effCompare — effBase의 4자리 prefix - 1로 직전 연도 매칭
  //    annual 전체에서 찾아야 함 ('2023 제외' 정책은 yearLabels 표시용일 뿐 비교 데이터는 살아있음).
  //    '2025(E)' 같은 suffix를 처리하기 위해 prefix 매칭.
  let effCompare = effBase;
  if (effBase) {
    const m = effBase.match(/(\d{4})/);
    if (m) {
      const prev = String(parseInt(m[1], 10) - 1);
      const allLabels = getDisplayYearLabels(annual, basis);
      effCompare = allLabels.find((y) => y.startsWith(prev)) ?? effBase;
    }
  }

  // 4) ytdMonths — 기준 연도의 monthly 최대 월 (1~11이면 진행 중)
  const baseYearMatch = effBase.match(/(\d{4})/);
  const baseYearNum = baseYearMatch ? parseInt(baseYearMatch[1], 10) : 0;
  const ytdMonths = baseYearNum ? ytdMonthsOfYear(monthly, basis, baseYearNum) : 0;

  // 5) base/compare entries — YTD면 monthly 1~ytdMonths월, 아니면 annual
  const baseEntries = effBase
    ? entriesForYearOrYtd(annual, monthly, basis, effBase, ytdMonths)
    : [];
  const compareEntries = effCompare
    ? entriesForYearOrYtd(annual, monthly, basis, effCompare, ytdMonths)
    : [];

  return { yearLabels, effBase, effCompare, ytdMonths, baseEntries, compareEntries };
}

/**
 * 손익 페이지(PnlDashboard) 진입 시 1회 수행하는 raw → derived 변환 묶음.
 *
 * 기존 컴포넌트의 useMemo 3개(annualEntries / annualByBasis / monthlyByBasis)가
 * 한 함수 호출로 정리된다. 클라이언트 상태(basis 토글 등)에 무관한 순수 변환만 담당.
 *
 * 정책 (기존 PnlDashboard 로직과 동일):
 * - 연결 연간: DB의 period_month=0 행을 그대로 사용. 단 '2026(P)' 계획값은 표시에서 제외 (사용자 요구).
 * - 연결 2026 YTD: monthly 1~N월을 합산해 period_month=0 행으로 derive (year_label='2026').
 * - 별도 연간: 전체 연도 월별 → 연간 derive (DB에 별도 연간 행이 없음).
 * - annualByBasis / monthlyByBasis: basis별 분리한 reference (차트가 작은 배열만 처리하도록).
 */
export interface PreparedPnlData {
  annualEntries: PnlEntry[];
  annualByBasis: Record<Basis, PnlEntry[]>;
  monthlyByBasis: Record<Basis, PnlEntry[]>;
}

export function preparePnlData(data: readonly PnlEntry[]): PreparedPnlData {
  // 연결 연간: DB의 period_month=0 행을 그대로 사용. '2026(P)' 계획값은 표시에서 제외.
  const consolidatedAnnual = data.filter(
    (e) => e.basis === 'consolidated' && e.period_month === 0 && e.year_label !== '2026(P)'
  );
  // 연결 2026 YTD: monthly 1~N월 합산 → period_month=0 derive (year_label='2026').
  const consolidated2026Ytd = deriveAnnualFromMonthly(data, 'consolidated', (y) => y === 2026);
  // 별도 연간: 월별만 적재되므로 전체 연도 derive.
  const standaloneMonthly = data.filter(
    (e) => e.basis === 'standalone' && e.period_month >= 1 && e.period_month <= 12
  );
  const standaloneAnnual = deriveStandaloneAnnual(standaloneMonthly);

  const annualEntries: PnlEntry[] = [
    ...consolidatedAnnual,
    ...consolidated2026Ytd,
    ...standaloneAnnual,
  ];

  // basis별로 분리한 reference 배열 — 차트가 작은 배열만 처리하도록.
  const annualByBasis: Record<Basis, PnlEntry[]> = { consolidated: [], standalone: [] };
  for (const e of annualEntries) {
    if (e.basis === 'consolidated') annualByBasis.consolidated.push(e);
    else annualByBasis.standalone.push(e);
  }

  const monthlyByBasis: Record<Basis, PnlEntry[]> = { consolidated: [], standalone: [] };
  for (const e of data) {
    if (e.basis === 'consolidated') monthlyByBasis.consolidated.push(e);
    else monthlyByBasis.standalone.push(e);
  }

  return { annualEntries, annualByBasis, monthlyByBasis };
}
