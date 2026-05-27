/**
 * Stellantis NA(/oem/stellantis-na) 사전 가공 — pure 함수만.
 *
 * Stellantis NA 특이사항 (audit: data/_stellantis_audit_report.md):
 *  - 분기 데이터만 (period_type='quarter' + Q4 PR이 CYTD를 'year'로 추가 적재).
 *  - 월 차원 없음 → 시계열은 X축이 분기('2025Q1') · 연도('2025') 토글.
 *  - 단일 region='US'. 캐나다 별도 PR 미수집.
 *  - brand 6종(Jeep/Ram/Chrysler/Dodge/Fiat/Alfa Romeo) + 'Total'(회사 합계) + brand별 'Total'(brand 합계) 행 존재.
 *  - 차트/KPI에서 'Total' 행은 제외 — brand 합계는 모델 SUM으로 도출.
 *
 * KPI 정책 (현대/KG와 동일 구조 유지):
 *  - latestYear = 가장 최근 "완료 연도" (Q4까지 데이터 있는 연도). Q1~Q3만 있으면 latestYear-1.
 *  - YTD = 진행 중 연도(latestYear+1)의 누계 분기 합. 데이터 없으면 '대기'.
 *  - 비교: prevYear 연 합계 vs latestYear 연 합계 / 전년 동기 분기 합 vs YTD 분기 합.
 *
 * 시계열/PT mix/brand mix 모두 quarter/year 토글 위해 양쪽 series 제공.
 */
import type {
  CompanyKpiSummary,
  CompanyPowertrain,
  CompanyPtMixPoint,
  CompanyTimeSeriesPoint,
  CompanyTopModelRow,
  CompanyTopModelsResult,
  StellantisNaBrandStackPoint,
  StellantisNaSaleRow,
  StellantisNaSaleRowWithPt,
  VehiclePowertrainMapRow,
} from '@/lib/types';

/** 전년 동기 sales가 이 값 미만이면 YoY% null (소수 sample로 인한 spike 방지). */
export const MIN_YOY_PREV_SALES = 10;

/** 차트/KPI 집계에서 제외할 합계 행 표식. */
const TOTAL_LABEL = 'Total' as const;

/** brand 6종 — 표시 순서 (audit 보고 기준). */
export const STELLANTIS_NA_BRANDS: readonly string[] = [
  'Jeep',
  'Ram',
  'Chrysler',
  'Dodge',
  'Fiat',
  'Alfa Romeo',
] as const;

/** brand별 색상 — 합계 큰 순/시각 구분. */
export const STELLANTIS_NA_BRAND_COLORS: Record<string, string> = {
  Jeep: '#2563eb', // blue-600
  Ram: '#dc2626', // red-600
  Chrysler: '#16a34a', // green-600
  Dodge: '#9333ea', // purple-600
  Fiat: '#f59e0b', // amber-500
  'Alfa Romeo': '#0891b2', // cyan-600
};

/** 'YYYY-Q1' → '25Q1' / 'YYYY' → '2025'. */
export function formatPeriodLabel(
  period: string,
  periodType: StellantisNaSaleRow['period_type']
): string {
  if (periodType === 'year') return period;
  // 'YYYY-QN' → 'YYQN' (보다 짧게: 25Q1)
  const [y, q] = period.split('-');
  return `${y.slice(2)}${q}`;
}

/** 'YYYY-QN' / 'YYYY' shift by year delta. */
function shiftPeriodByYear(period: string, deltaYears: number): string {
  if (/^\d{4}$/.test(period)) {
    return String(parseInt(period, 10) + deltaYears);
  }
  const [y, rest] = period.split('-', 2);
  return `${parseInt(y, 10) + deltaYears}-${rest}`;
}

/** period의 연도 추출 ('YYYY-Q1' / 'YYYY' 모두). */
function periodYear(period: string): string {
  return period.slice(0, 4);
}

/** period의 분기 번호 추출 (1~4). period_type='year'면 null. */
function periodQuarter(period: string): number | null {
  const m = period.match(/-Q(\d)$/);
  if (!m) return null;
  return parseInt(m[1], 10);
}

/** 합계 행(Total) 제외 — 차트/KPI에서 모델 SUM 자연 도출. */
function isModelRow<T extends { brand: string; vehicle_model: string }>(r: T): boolean {
  return r.brand !== TOTAL_LABEL && r.vehicle_model !== TOTAL_LABEL;
}

/** PT 매핑 lookup — valid_from/valid_to 기간 확인. */
function lookupPowertrain(
  model: string,
  ptMap: VehiclePowertrainMapRow[],
  yearPeriod?: string
): CompanyPowertrain | null {
  const candidates = ptMap.filter((m) => m.vehicle_model === model);
  if (candidates.length === 0) return null;
  if (!yearPeriod) return candidates[candidates.length - 1].powertrain;
  // year 또는 quarter 모두 'YYYY'로 환산해 비교 (분기 정밀도 불필요).
  const refDate = `${yearPeriod.slice(0, 4)}-01-01`;
  const valid = candidates.find(
    (m) => m.valid_from <= refDate && (m.valid_to == null || refDate <= m.valid_to)
  );
  return valid?.powertrain ?? candidates[candidates.length - 1].powertrain;
}

/** sale rows에 PT 매핑을 attach. */
export function attachPowertrains(
  rows: StellantisNaSaleRow[],
  ptMap: VehiclePowertrainMapRow[]
): StellantisNaSaleRowWithPt[] {
  return rows.map((r) => ({
    ...r,
    resolved_powertrain: lookupPowertrain(r.vehicle_model, ptMap, r.year_period),
  }));
}

// ============================================================
// 시계열 (분기/연 토글)
// ============================================================

/** 분기별 시계열 (모델 행만 합산). YoY = 같은 분기 vs 1년 전 같은 분기. */
export function aggregateQuarterlySeries(
  rows: StellantisNaSaleRowWithPt[]
): CompanyTimeSeriesPoint[] {
  const quarterRows = rows.filter((r) => r.period_type === 'quarter' && isModelRow(r));
  const periodTotals = new Map<string, number>();
  for (const r of quarterRows) {
    periodTotals.set(r.year_period, (periodTotals.get(r.year_period) ?? 0) + r.sales_units);
  }
  const periods = [...periodTotals.keys()].sort();
  return periods.map((period) => {
    const sales = periodTotals.get(period) ?? 0;
    const prevSales = periodTotals.get(shiftPeriodByYear(period, -1)) ?? 0;
    const yoy = prevSales < MIN_YOY_PREV_SALES ? null : ((sales - prevSales) / prevSales) * 100;
    return {
      period,
      period_label: formatPeriodLabel(period, 'quarter'),
      sales,
      yoy_pct: yoy,
    };
  });
}

/** 연도별 시계열 (모델 행 분기 SUM). YoY = 전년 합계 대비.
 *  Q4 PR의 'year' 행은 brand_total/company_total 포함 → 모델 행만 사용해도
 *  분기 SUM == year 합계 (cross-check 통과). 일관성 위해 quarter SUM 사용. */
export function aggregateAnnualSeries(rows: StellantisNaSaleRowWithPt[]): CompanyTimeSeriesPoint[] {
  const quarterRows = rows.filter((r) => r.period_type === 'quarter' && isModelRow(r));
  const yearTotals = new Map<string, number>();
  for (const r of quarterRows) {
    const y = periodYear(r.year_period);
    yearTotals.set(y, (yearTotals.get(y) ?? 0) + r.sales_units);
  }
  const years = [...yearTotals.keys()].sort();
  return years.map((year) => {
    const sales = yearTotals.get(year) ?? 0;
    const prevSales = yearTotals.get(String(parseInt(year, 10) - 1)) ?? 0;
    const yoy = prevSales < MIN_YOY_PREV_SALES ? null : ((sales - prevSales) / prevSales) * 100;
    return {
      period: year,
      period_label: year,
      sales,
      yoy_pct: yoy,
    };
  });
}

// ============================================================
// KPI — 최근 완료 연도 + 진행 연도 YTD
// ============================================================

const EMPTY_KPI: CompanyKpiSummary = {
  latestYearLabel: '',
  latestYearSales: 0,
  prevYearLabel: '',
  prevYearSales: 0,
  yoyPct: null,
  ytdLabel: '',
  ytdCurrent: 0,
  ytdPrevLabel: '',
  ytdPrev: 0,
  ytdYoyPct: null,
  evRatio: null,
  latestPeriod: '',
};

export function aggregateKpi(rows: StellantisNaSaleRowWithPt[]): CompanyKpiSummary {
  const quarterRows = rows.filter((r) => r.period_type === 'quarter' && isModelRow(r));
  if (quarterRows.length === 0) return EMPTY_KPI;

  const periods = [...new Set(quarterRows.map((r) => r.year_period))].sort();
  const latestPeriod = periods[periods.length - 1];
  const latestYear = parseInt(periodYear(latestPeriod), 10);
  const latestQuarter = periodQuarter(latestPeriod);
  const isLatestYearComplete = latestQuarter === 4;
  const completedYear = isLatestYearComplete ? latestYear : latestYear - 1;
  const inProgressYear = completedYear + 1;

  const sumYear = (year: number) =>
    quarterRows
      .filter((r) => periodYear(r.year_period) === String(year))
      .reduce((a, r) => a + r.sales_units, 0);

  const sumYearQuarters = (year: number, quarters: number[]) =>
    quarterRows
      .filter((r) => {
        if (periodYear(r.year_period) !== String(year)) return false;
        const q = periodQuarter(r.year_period);
        return q != null && quarters.includes(q);
      })
      .reduce((a, r) => a + r.sales_units, 0);

  const latestYearSales = sumYear(completedYear);
  const prevYearSales = sumYear(completedYear - 1);
  const yoyPct =
    prevYearSales < MIN_YOY_PREV_SALES
      ? null
      : ((latestYearSales - prevYearSales) / prevYearSales) * 100;

  // 진행 연도 분기 — Q1~Q4 중 데이터 있는 것.
  const inProgressQuarters = quarterRows
    .filter((r) => periodYear(r.year_period) === String(inProgressYear))
    .map((r) => periodQuarter(r.year_period))
    .filter((q): q is number => q != null);
  const hasInProgress = inProgressQuarters.length > 0;
  const ytdLastQuarter = hasInProgress ? Math.max(...inProgressQuarters) : 0;

  let ytdLabel: string;
  let ytdCurrent: number;
  let ytdPrevLabel: string;
  let ytdPrev: number;
  let ytdYoyPct: number | null;

  if (hasInProgress) {
    const ytdQuarters = Array.from({ length: ytdLastQuarter }, (_, i) => i + 1);
    const qRange = ytdLastQuarter === 1 ? 'Q1' : `Q1~Q${ytdLastQuarter}`;
    ytdLabel = `${inProgressYear} YTD (${qRange})`;
    ytdCurrent = sumYearQuarters(inProgressYear, ytdQuarters);
    ytdPrevLabel = `${completedYear} ${qRange}`;
    ytdPrev = sumYearQuarters(completedYear, ytdQuarters);
    ytdYoyPct = ytdPrev < MIN_YOY_PREV_SALES ? null : ((ytdCurrent - ytdPrev) / ytdPrev) * 100;
  } else {
    ytdLabel = `${inProgressYear} YTD (대기)`;
    ytdCurrent = 0;
    ytdPrevLabel = `${completedYear} 연간`;
    ytdPrev = latestYearSales;
    ytdYoyPct = null;
  }

  // EV 비중 = (EV + PHEV + FCEV) / 완료 연도 합계.
  const evSum = quarterRows
    .filter(
      (r) =>
        periodYear(r.year_period) === String(completedYear) &&
        (r.resolved_powertrain === 'EV' ||
          r.resolved_powertrain === 'PHEV' ||
          r.resolved_powertrain === 'FCEV')
    )
    .reduce((a, r) => a + r.sales_units, 0);
  const evRatio = latestYearSales > 0 ? (evSum / latestYearSales) * 100 : null;

  return {
    latestYearLabel: `${completedYear}년 실적`,
    latestYearSales,
    prevYearLabel: `${completedYear - 1}년 실적`,
    prevYearSales,
    yoyPct,
    ytdLabel,
    ytdCurrent,
    ytdPrevLabel,
    ytdPrev,
    ytdYoyPct,
    evRatio,
    latestPeriod: formatPeriodLabel(latestPeriod, 'quarter'),
  };
}

// ============================================================
// Brand mix — 분기/연 토글 (stacked bar)
// ============================================================

/** brand stacked bar — 모델 행을 brand별로 집계. */
function aggregateBrandStack(
  rows: StellantisNaSaleRowWithPt[],
  mode: 'quarter' | 'year'
): StellantisNaBrandStackPoint[] {
  const filtered = rows.filter((r) => r.period_type === 'quarter' && isModelRow(r));
  const byPeriod = new Map<string, Map<string, number>>();
  for (const r of filtered) {
    const key = mode === 'quarter' ? r.year_period : periodYear(r.year_period);
    if (!byPeriod.has(key)) byPeriod.set(key, new Map());
    const inner = byPeriod.get(key)!;
    inner.set(r.brand, (inner.get(r.brand) ?? 0) + r.sales_units);
  }
  const periods = [...byPeriod.keys()].sort();
  return periods.map((period) => {
    const brands = byPeriod.get(period)!;
    const brandsObj: Record<string, number> = {};
    let total = 0;
    for (const brand of STELLANTIS_NA_BRANDS) {
      const v = brands.get(brand) ?? 0;
      brandsObj[brand] = v;
      total += v;
    }
    return {
      period,
      period_label:
        mode === 'quarter'
          ? formatPeriodLabel(period, 'quarter')
          : formatPeriodLabel(period, 'year'),
      brands: brandsObj,
      total,
    };
  });
}

/** 분기별 brand stacked. */
export function aggregateQuarterlyBrandStack(
  rows: StellantisNaSaleRowWithPt[]
): StellantisNaBrandStackPoint[] {
  return aggregateBrandStack(rows, 'quarter');
}

/** 연도별 brand stacked. */
export function aggregateAnnualBrandStack(
  rows: StellantisNaSaleRowWithPt[]
): StellantisNaBrandStackPoint[] {
  return aggregateBrandStack(rows, 'year');
}

/** 전체 기간 합계 큰 brand 순으로 정렬 — stack/legend 순서 고정. */
export function sortBrandsByTotal(points: StellantisNaBrandStackPoint[]): string[] {
  const totals = new Map<string, number>();
  for (const b of STELLANTIS_NA_BRANDS) totals.set(b, 0);
  for (const p of points) {
    for (const b of STELLANTIS_NA_BRANDS) {
      totals.set(b, (totals.get(b) ?? 0) + (p.brands[b] ?? 0));
    }
  }
  return STELLANTIS_NA_BRANDS.slice().sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
}

// ============================================================
// TOP N 차종 — 최근 완료 연도 vs 직전 연도, brand 필터
// ============================================================

/** brand 필터 옵션 — TOP10. 'all' = 전체 brand. */
export type StellantisNaBrandFilter = 'all' | string;

const EMPTY_TOP_RESULT: CompanyTopModelsResult = {
  rows: [],
  totals: { latestPeriod: 0, prevPeriod: 0, ytd: 0 },
};

export function aggregateTopModels(
  rows: StellantisNaSaleRowWithPt[],
  topN = 10,
  brandFilter: StellantisNaBrandFilter = 'all'
): CompanyTopModelsResult {
  let quarterRows = rows.filter((r) => r.period_type === 'quarter' && isModelRow(r));
  if (brandFilter !== 'all') {
    quarterRows = quarterRows.filter((r) => r.brand === brandFilter);
  }
  if (quarterRows.length === 0) return EMPTY_TOP_RESULT;

  const periods = [...new Set(quarterRows.map((r) => r.year_period))].sort();
  const latestPeriod = periods[periods.length - 1];
  const latestYear = parseInt(periodYear(latestPeriod), 10);
  const isComplete = periodQuarter(latestPeriod) === 4;
  const completedYear = isComplete ? latestYear : latestYear - 1;
  const prevYear = completedYear - 1;
  const inProgressYear = completedYear + 1;

  // YTD 분기 — inProgressYear의 가장 늦은 분기 (예: 2026-Q1)
  const ytdPeriods = periods.filter((p) => parseInt(periodYear(p), 10) === inProgressYear);
  const ytdQuarters = new Set(ytdPeriods.map((p) => periodQuarter(p)));

  const modelTotals = new Map<
    string,
    {
      latest: number;
      prev: number;
      ytd: number;
      ytdPrev: number;
      pt: CompanyPowertrain | null;
      brand: string;
    }
  >();
  let totalLatest = 0;
  let totalPrev = 0;
  let totalYtd = 0;
  let totalYtdPrev = 0;
  for (const r of quarterRows) {
    const y = parseInt(periodYear(r.year_period), 10);
    const q = periodQuarter(r.year_period);
    const cur = modelTotals.get(r.vehicle_model) ?? {
      latest: 0,
      prev: 0,
      ytd: 0,
      ytdPrev: 0,
      pt: r.resolved_powertrain,
      brand: r.brand ?? '',
    };
    if (y === completedYear) {
      cur.latest += r.sales_units;
      totalLatest += r.sales_units;
    }
    if (y === prevYear) {
      cur.prev += r.sales_units;
      totalPrev += r.sales_units;
    }
    if (y === inProgressYear) {
      cur.ytd += r.sales_units;
      totalYtd += r.sales_units;
    }
    // YTD YoY: completedYear의 같은 분기까지 합산
    if (y === completedYear && ytdQuarters.has(q)) {
      cur.ytdPrev += r.sales_units;
      totalYtdPrev += r.sales_units;
    }
    if (cur.pt == null && r.resolved_powertrain != null) cur.pt = r.resolved_powertrain;
    if (!cur.brand && r.brand) cur.brand = r.brand;
    modelTotals.set(r.vehicle_model, cur);
  }

  const items: CompanyTopModelRow[] = [...modelTotals.entries()].map(
    ([model, { latest, prev, ytd, ytdPrev, pt, brand }]) => ({
      model,
      salesLatestPeriod: latest,
      salesPrevPeriod: prev,
      ytdSales: ytd,
      ytdPrevSales: ytdPrev,
      yoyPct: prev < MIN_YOY_PREV_SALES ? null : ((latest - prev) / prev) * 100,
      ytdYoyPct: ytdPrev < MIN_YOY_PREV_SALES ? null : ((ytd - ytdPrev) / ytdPrev) * 100,
      resolvedPt: pt,
      brand,
    })
  );

  return {
    rows: items.sort((a, b) => b.salesLatestPeriod - a.salesLatestPeriod).slice(0, topN),
    totals: {
      latestPeriod: totalLatest,
      prevPeriod: totalPrev,
      ytd: totalYtd,
      ytdPrev: totalYtdPrev,
    },
  };
}

// ============================================================
// PowerTrain Mix — 100% stacked, 분기/연 토글
// ============================================================

function emptyPtPoint(period: string, period_label: string): CompanyPtMixPoint {
  return {
    period,
    period_label,
    ICE: 0,
    HV: 0,
    PHEV: 0,
    EV: 0,
    FCEV: 0,
    Multi: 0,
    Unknown: 0,
    total: 0,
  };
}

/** PT mix를 mode에 따라 quarter 또는 year로 집계. PT 매핑은 row.resolved_powertrain. */
function aggregatePtMixBase(
  rows: StellantisNaSaleRowWithPt[],
  mode: 'quarter' | 'year'
): CompanyPtMixPoint[] {
  const quarterRows = rows.filter((r) => r.period_type === 'quarter' && isModelRow(r));
  const byPeriod = new Map<string, CompanyPtMixPoint>();
  for (const r of quarterRows) {
    const key = mode === 'quarter' ? r.year_period : periodYear(r.year_period);
    let pt = byPeriod.get(key);
    if (!pt) {
      const label =
        mode === 'quarter' ? formatPeriodLabel(key, 'quarter') : formatPeriodLabel(key, 'year');
      pt = emptyPtPoint(key, label);
      byPeriod.set(key, pt);
    }
    if (r.resolved_powertrain == null) pt.Unknown += r.sales_units;
    else pt[r.resolved_powertrain] += r.sales_units;
    pt.total += r.sales_units;
  }
  return [...byPeriod.values()].sort((a, b) => (a.period < b.period ? -1 : 1));
}

export function aggregatePtMixQuarterly(rows: StellantisNaSaleRowWithPt[]): CompanyPtMixPoint[] {
  return aggregatePtMixBase(rows, 'quarter');
}

export function aggregatePtMixAnnual(rows: StellantisNaSaleRowWithPt[]): CompanyPtMixPoint[] {
  return aggregatePtMixBase(rows, 'year');
}
