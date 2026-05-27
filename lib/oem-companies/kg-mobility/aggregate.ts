/**
 * KG모빌리티(/oem/kg-mobility) 사전 가공 — pure 함수만.
 *
 * 모든 함수는 입력(rows) → 출력(가공 객체), 사이드 이펙트 없음.
 * source.ts의 'use cache' 안에서 호출되어 작은 props로 클라이언트 전달.
 * 테스트는 aggregate.test.ts (Vitest).
 *
 * KPI 정책 (사용자 피드백 반영):
 *  - 카드 A: 가장 최근 "완료된 연도" (12월 데이터 있는 연도) — 예: '2025년 실적'
 *  - 카드 B: 진행 중인 연도 YTD — 예: '2026 YTD (1~4월)' / '2026 YTD (대기)'
 *  - 두 비교 기준: 카드 A는 전년 vs 최근연도, 카드 B는 전년 동기 vs YTD
 *
 * 시계열/PT mix/region 모두 month/year 토글 위해 양쪽 series 제공.
 */
import type {
  CompanyKpiSummary,
  CompanyPowertrain,
  CompanyPtMixPoint,
  CompanySaleRow,
  CompanySaleRowWithPt,
  CompanyTimeSeriesPoint,
  CompanyTopModelsResult,
  VehiclePowertrainMapRow,
} from '@/lib/types';

/** 전년 동기 sales가 이 값 미만이면 YoY% null (소수 sample로 인한 spike 방지). */
export const MIN_YOY_PREV_SALES = 10;

/** 'YYYY-MM' 또는 'YYYY-Q1' 또는 'YYYY' → 화면 X축 라벨. */
export function formatPeriodLabel(
  period: string,
  periodType: CompanySaleRow['period_type']
): string {
  if (periodType === 'annual') return period; // 'YYYY'
  if (periodType === 'quarter') return period.replace('-', ''); // '2025Q1'
  const [y, m] = period.split('-');
  return `${y.slice(2)}.${m}`;
}

/** 'YYYY-MM' / 'YYYY' / 'YYYY-Q1' shift by year delta. */
function shiftPeriodByYear(period: string, deltaYears: number): string {
  if (/^\d{4}$/.test(period)) {
    return String(parseInt(period, 10) + deltaYears);
  }
  const [y, rest] = period.split('-', 2);
  return `${parseInt(y, 10) + deltaYears}-${rest}`;
}

/** 차종 모델명을 PT 매핑에 조회. valid_from/valid_to 기간 확인. */
function lookupPowertrain(
  model: string,
  ptMap: VehiclePowertrainMapRow[],
  ymRef?: string
): CompanyPowertrain | null {
  const candidates = ptMap.filter((m) => m.vehicle_model === model);
  if (candidates.length === 0) return null;
  if (!ymRef) return candidates[candidates.length - 1].powertrain;
  const refDate = ymRef.length >= 7 ? `${ymRef.slice(0, 7)}-01` : `${ymRef}-01-01`;
  const valid = candidates.find(
    (m) => m.valid_from <= refDate && (m.valid_to == null || refDate <= m.valid_to)
  );
  return valid?.powertrain ?? candidates[candidates.length - 1].powertrain;
}

/** sales rows에 PT 매핑을 attach. row.powertrain ?? 매핑 결과 ?? null. */
export function attachPowertrains(
  rows: CompanySaleRow[],
  ptMap: VehiclePowertrainMapRow[]
): CompanySaleRowWithPt[] {
  return rows.map((r) => ({
    ...r,
    resolved_powertrain: r.powertrain ?? lookupPowertrain(r.vehicle_model, ptMap, r.year_period),
  }));
}

/** YYYY 추출 (period가 'YYYY-MM' / 'YYYY-Q1' / 'YYYY' 모두 처리). */
function periodYear(period: string): string {
  return period.slice(0, 4);
}

// ============================================================
// 시계열 (월/연 토글용)
// ============================================================

/** 월별 시계열 (전 region 합산). YoY = 같은 month vs 1년 전 같은 month. */
export function aggregateMonthlySeries(rows: CompanySaleRowWithPt[]): CompanyTimeSeriesPoint[] {
  const monthRows = rows.filter((r) => r.period_type === 'month');
  const periodTotals = new Map<string, number>();
  for (const r of monthRows) {
    periodTotals.set(r.year_period, (periodTotals.get(r.year_period) ?? 0) + r.sales_units);
  }
  const periods = [...periodTotals.keys()].sort();
  return periods.map((period) => {
    const sales = periodTotals.get(period) ?? 0;
    const prevSales = periodTotals.get(shiftPeriodByYear(period, -1)) ?? 0;
    const yoy = prevSales < MIN_YOY_PREV_SALES ? null : ((sales - prevSales) / prevSales) * 100;
    return {
      period,
      period_label: formatPeriodLabel(period, 'month'),
      sales,
      yoy_pct: yoy,
    };
  });
}

/** 연도별 시계열 (월 데이터를 연 합계). YoY = 전년 동일 월 누계 대비 (YTD 연도면 prev도 YTD).
 *  사용자 요청: 2026 YTD vs 2025 동일 월 누계 비교. */
export function aggregateAnnualSeries(rows: CompanySaleRowWithPt[]): CompanyTimeSeriesPoint[] {
  const monthRows = rows.filter((r) => r.period_type === 'month');
  const yearTotals = new Map<string, number>();
  const yearMonths = new Map<string, Set<string>>();
  for (const r of monthRows) {
    const y = periodYear(r.year_period);
    yearTotals.set(y, (yearTotals.get(y) ?? 0) + r.sales_units);
    if (!yearMonths.has(y)) yearMonths.set(y, new Set());
    yearMonths.get(y)!.add(r.year_period.slice(-2));
  }
  const years = [...yearTotals.keys()].sort();
  return years.map((year) => {
    const sales = yearTotals.get(year) ?? 0;
    const months = yearMonths.get(year) ?? new Set<string>();
    const isYtd = months.size > 0 && months.size < 12;
    const prevYear = String(parseInt(year, 10) - 1);
    let prevSales: number;
    if (isYtd) {
      prevSales = monthRows
        .filter(
          (r) => periodYear(r.year_period) === prevYear && months.has(r.year_period.slice(-2))
        )
        .reduce((sum, r) => sum + r.sales_units, 0);
    } else {
      prevSales = yearTotals.get(prevYear) ?? 0;
    }
    const yoy = prevSales < MIN_YOY_PREV_SALES ? null : ((sales - prevSales) / prevSales) * 100;
    return {
      period: year,
      period_label: isYtd ? `${year} YTD` : year,
      sales,
      yoy_pct: yoy,
    };
  });
}

// ============================================================
// KPI 카드 — 최근 완료 연도 + 진행 연도 YTD
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

export function aggregateKpi(rows: CompanySaleRowWithPt[]): CompanyKpiSummary {
  const monthRows = rows.filter((r) => r.period_type === 'month');
  if (monthRows.length === 0) return EMPTY_KPI;

  const periods = [...new Set(monthRows.map((r) => r.year_period))].sort();
  const latestPeriod = periods[periods.length - 1];
  const latestYear = parseInt(periodYear(latestPeriod), 10);
  const latestMonthNum = parseInt(latestPeriod.slice(-2), 10);
  const isLatestYearComplete = latestMonthNum === 12;

  // "완료 연도" 결정 — 12월까지 데이터 있으면 latestYear, 아니면 latestYear-1
  const completedYear = isLatestYearComplete ? latestYear : latestYear - 1;
  const inProgressYear = completedYear + 1;

  const sumYear = (year: number) =>
    monthRows
      .filter((r) => periodYear(r.year_period) === String(year))
      .reduce((a, r) => a + r.sales_units, 0);

  const sumYearMonths = (year: number, months: number[]) =>
    monthRows
      .filter(
        (r) =>
          periodYear(r.year_period) === String(year) &&
          months.includes(parseInt(r.year_period.slice(-2), 10))
      )
      .reduce((a, r) => a + r.sales_units, 0);

  const latestYearSales = sumYear(completedYear);
  const prevYearSales = sumYear(completedYear - 1);
  const yoyPct =
    prevYearSales < MIN_YOY_PREV_SALES
      ? null
      : ((latestYearSales - prevYearSales) / prevYearSales) * 100;

  // YTD 라벨/수치 — 진행 연도 데이터 유무 분기
  const inProgressMonths = monthRows
    .filter((r) => periodYear(r.year_period) === String(inProgressYear))
    .map((r) => parseInt(r.year_period.slice(-2), 10));
  const hasInProgress = inProgressMonths.length > 0;
  const ytdLastMonth = hasInProgress ? Math.max(...inProgressMonths) : 0;

  let ytdLabel: string;
  let ytdCurrent: number;
  let ytdPrevLabel: string;
  let ytdPrev: number;
  let ytdYoyPct: number | null;

  if (hasInProgress) {
    const ytdMonths = Array.from({ length: ytdLastMonth }, (_, i) => i + 1);
    ytdLabel = `${inProgressYear} YTD (1~${ytdLastMonth}월)`;
    ytdCurrent = sumYearMonths(inProgressYear, ytdMonths);
    ytdPrevLabel = `${completedYear} 1~${ytdLastMonth}월`;
    ytdPrev = sumYearMonths(completedYear, ytdMonths);
    ytdYoyPct = ytdPrev < MIN_YOY_PREV_SALES ? null : ((ytdCurrent - ytdPrev) / ytdPrev) * 100;
  } else {
    ytdLabel = `${inProgressYear} YTD (대기)`;
    ytdCurrent = 0;
    ytdPrevLabel = `${completedYear} 연간`;
    ytdPrev = latestYearSales;
    ytdYoyPct = null;
  }

  // EV 비중 (완료 연도 기준): EV + PHEV + FCEV
  const evSum = monthRows
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
    latestPeriod,
  };
}

// ============================================================
// TOP N 차종 — 최근 완료 연도 vs 직전 연도
// ============================================================

/** region 필터 옵션 — TOP10 토글 (전체/내수/수출). 회사마다 region 명칭은 다를 수 있으나
 *  KG는 '내수'/'수출' 두 종류. 'all' = 모든 region 합산. */
export type CompanyRegionFilter = 'all' | '내수' | '수출';

const EMPTY_TOP_RESULT: CompanyTopModelsResult = {
  rows: [],
  totals: { latestPeriod: 0, prevPeriod: 0, ytd: 0 },
};

/** KG모빌리티 차종명 정규화 (사용자 명시).
 *  - 'R/Sports'         → 'Musso' (Rexton Sports = Musso sports)
 *  - 'R/Sports KHAN'    → 'Musso' (Khan = Musso Khan, 2026부터 Musso로 통합)
 *  - 'Musso sports'     → 'Musso'
 *  - 'Musso Khan'       → 'Musso'
 *  - 'Rexton/S/K'       → 'Musso' (Rexton Sports/Khan 묶음 표기, 60대 노이즈)
 *  - 그 외(Musso EV·Korando EV 등 BEV/HEV variant)는 별도 모델로 유지. */
export function normalizeKgModel(raw: string): string {
  const m = raw.trim();
  if (m === 'R/Sports' || m === 'R/Sports KHAN' || m === 'Musso sports' || m === 'Musso Khan')
    return 'Musso';
  if (m === 'Rexton/S/K') return 'Musso';
  return m;
}

export function aggregateTopModels(
  rows: CompanySaleRowWithPt[],
  topN = 10,
  regionFilter: CompanyRegionFilter = 'all'
): CompanyTopModelsResult {
  let monthRows = rows.filter((r) => r.period_type === 'month');
  if (regionFilter !== 'all') {
    monthRows = monthRows.filter((r) => r.region === regionFilter);
  }
  if (monthRows.length === 0) return EMPTY_TOP_RESULT;

  const periods = [...new Set(monthRows.map((r) => r.year_period))].sort();
  const latestPeriod = periods[periods.length - 1];
  const latestYear = parseInt(periodYear(latestPeriod), 10);
  const isComplete = parseInt(latestPeriod.slice(-2), 10) === 12;
  const completedYear = isComplete ? latestYear : latestYear - 1;
  const prevYear = completedYear - 1;
  const inProgressYear = completedYear + 1;

  // YTD 비교 기준 월 (inProgressYear의 실제 보유 월)
  const ytdMonths = new Set(
    monthRows
      .filter((r) => parseInt(periodYear(r.year_period), 10) === inProgressYear)
      .map((r) => r.year_period.slice(-2))
  );

  const modelTotals = new Map<
    string,
    {
      latest: number;
      prev: number;
      ytd: number;
      ytdPrev: number;
      pt: CompanyPowertrain | null;
    }
  >();
  let totalLatest = 0;
  let totalPrev = 0;
  let totalYtd = 0;
  let totalYtdPrev = 0;
  for (const r of monthRows) {
    const y = parseInt(periodYear(r.year_period), 10);
    const mm = r.year_period.slice(-2);
    const key = normalizeKgModel(r.vehicle_model);
    const cur = modelTotals.get(key) ?? {
      latest: 0,
      prev: 0,
      ytd: 0,
      ytdPrev: 0,
      pt: r.resolved_powertrain,
    };
    if (y === completedYear) {
      cur.latest += r.sales_units;
      totalLatest += r.sales_units;
      if (ytdMonths.has(mm)) {
        cur.ytdPrev += r.sales_units;
        totalYtdPrev += r.sales_units;
      }
    }
    if (y === prevYear) {
      cur.prev += r.sales_units;
      totalPrev += r.sales_units;
    }
    if (y === inProgressYear) {
      cur.ytd += r.sales_units;
      totalYtd += r.sales_units;
    }
    if (cur.pt == null && r.resolved_powertrain != null) cur.pt = r.resolved_powertrain;
    modelTotals.set(key, cur);
  }

  return {
    rows: [...modelTotals.entries()]
      .map(([model, { latest, prev, ytd, ytdPrev, pt }]) => ({
        model,
        salesLatestPeriod: latest,
        salesPrevPeriod: prev,
        ytdSales: ytd,
        ytdPrevSales: ytdPrev,
        yoyPct: prev < MIN_YOY_PREV_SALES ? null : ((latest - prev) / prev) * 100,
        ytdYoyPct: ytdPrev < MIN_YOY_PREV_SALES ? null : ((ytd - ytdPrev) / ytdPrev) * 100,
        resolvedPt: pt,
      }))
      .sort((a, b) => b.salesLatestPeriod - a.salesLatestPeriod)
      .slice(0, topN),
    totals: {
      latestPeriod: totalLatest,
      prevPeriod: totalPrev,
      ytd: totalYtd,
      ytdPrev: totalYtdPrev,
    },
  };
}

// ============================================================
// PowerTrain Mix (월/연 토글용)
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

export function aggregatePtMix(rows: CompanySaleRowWithPt[]): CompanyPtMixPoint[] {
  const monthRows = rows.filter((r) => r.period_type === 'month');
  const byPeriod = new Map<string, CompanyPtMixPoint>();
  for (const r of monthRows) {
    let pt = byPeriod.get(r.year_period);
    if (!pt) {
      pt = emptyPtPoint(r.year_period, formatPeriodLabel(r.year_period, 'month'));
      byPeriod.set(r.year_period, pt);
    }
    if (r.resolved_powertrain == null) pt.Unknown += r.sales_units;
    else pt[r.resolved_powertrain] += r.sales_units;
    pt.total += r.sales_units;
  }
  return [...byPeriod.values()].sort((a, b) => (a.period < b.period ? -1 : 1));
}

export function aggregatePtMixAnnual(rows: CompanySaleRowWithPt[]): CompanyPtMixPoint[] {
  const monthRows = rows.filter((r) => r.period_type === 'month');
  const byYear = new Map<string, CompanyPtMixPoint>();
  for (const r of monthRows) {
    const y = periodYear(r.year_period);
    let pt = byYear.get(y);
    if (!pt) {
      pt = emptyPtPoint(y, y);
      byYear.set(y, pt);
    }
    if (r.resolved_powertrain == null) pt.Unknown += r.sales_units;
    else pt[r.resolved_powertrain] += r.sales_units;
    pt.total += r.sales_units;
  }
  return [...byYear.values()].sort((a, b) => (a.period < b.period ? -1 : 1));
}

// ============================================================
// KG 전용: 내수/수출 분리 (월/연 토글용)
// ============================================================

export interface KgRegionSeriesPoint {
  period: string;
  period_label: string;
  domestic: number;
  export: number;
  total: number;
}

export function aggregateKgRegionSeries(rows: CompanySaleRowWithPt[]): KgRegionSeriesPoint[] {
  const monthRows = rows.filter((r) => r.period_type === 'month');
  const byPeriod = new Map<string, KgRegionSeriesPoint>();
  for (const r of monthRows) {
    let p = byPeriod.get(r.year_period);
    if (!p) {
      p = {
        period: r.year_period,
        period_label: formatPeriodLabel(r.year_period, 'month'),
        domestic: 0,
        export: 0,
        total: 0,
      };
      byPeriod.set(r.year_period, p);
    }
    if (r.region === '수출') p.export += r.sales_units;
    else p.domestic += r.sales_units;
    p.total += r.sales_units;
  }
  return [...byPeriod.values()].sort((a, b) => (a.period < b.period ? -1 : 1));
}

export function aggregateKgRegionSeriesAnnual(rows: CompanySaleRowWithPt[]): KgRegionSeriesPoint[] {
  const monthRows = rows.filter((r) => r.period_type === 'month');
  const byYear = new Map<string, KgRegionSeriesPoint>();
  for (const r of monthRows) {
    const y = periodYear(r.year_period);
    let p = byYear.get(y);
    if (!p) {
      p = { period: y, period_label: y, domestic: 0, export: 0, total: 0 };
      byYear.set(y, p);
    }
    if (r.region === '수출') p.export += r.sales_units;
    else p.domestic += r.sales_units;
    p.total += r.sales_units;
  }
  return [...byYear.values()].sort((a, b) => (a.period < b.period ? -1 : 1));
}
