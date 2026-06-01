/**
 * 기아(/oem/kia) 사전 가공 — pure 함수만.
 *
 * 현대차 패턴 차용 + Kia 특이사항 반영:
 *  - region: '내수' | '수출' | 'CKD' | '' (해외 공장)
 *  - factory: '' (한국 출하) | 'U.S. Plant' | 'China Plants' | 'Slovakia Plant' | 'Mexico Plant' | 'India Plant'
 *  - 'Aggregate' 모델: region='CKD' 행만 존재 — CKD section 합계(차종 분해 없음).
 *    → 차종 TOP10에서 제외, 시계열/KPI/PT mix에는 합산 포함(회사 전체 도매).
 *
 * 차종 TOP10 region 필터: 'all' | 'domestic' | '내수' | '수출' (현대차 동일).
 *  - all      : 모든 region (한국 출하 내수+수출+CKD + 해외 공장)
 *  - domestic : 한국 공장 출하만 (factory='', region IN ('내수','수출','CKD'))
 *  - '내수'   : 한국 공장 내수만
 *  - '수출'   : 한국 공장 수출만
 */
import type {
  CompanyKpiSummary,
  CompanyPowertrain,
  CompanyPtMixPoint,
  CompanySaleRow,
  CompanySaleRowWithPt,
  CompanyTimeSeriesPoint,
  CompanyTopModelRow,
  CompanyTopModelsResult,
  FactoryMixPoint,
  KiaExportRegionRow,
  KiaExportType,
  KiaExportTypeMixPoint,
  KiaRetailSaleRow,
  KiaSaleRow,
  VehiclePowertrainMapRow,
} from '@/lib/types';

export const MIN_YOY_PREV_SALES = 10;

/** 차종 TOP10 등에서 제외할 합계/Total 모델명.
 *  - 'Aggregate' = CKD section 합계 row (차종 분해 없음)
 *  - 'Aggregate (PR*)' = 2024-11/12 + 연간 보도자료 보완 데이터 (hyundaimotorgroup.com).
 *    region/factory별로 단순 합계만 들어가서 차종 TOP10·공장별 mix에서 제외해야 함.
 *    시계열/KPI는 isCountable 통해 자연 합산. */
export const KIA_NON_MODEL_LABELS = new Set<string>([
  'Aggregate',
  'Aggregate (PR)',
  'Aggregate (PR Annual)',
  'Aggregate (PR Special)',
  'Aggregate (PR Annual Special)',
]);

/** PR 보완분 marker — 공장별 stack에서 제외 (시계열 합산엔 포함).
 *  factory='Overseas (PR)' (해외 미분해) + model='Aggregate (PR...)' (한국 내수/CKD 미분해).
 *  2024 11~12월 보도자료 보완분은 공장별 분해가 불가 → 공장 차트는 1~10월까지(2024.10)로 표시. */
function isPrAggregate(r: { factory: string; vehicle_model: string }): boolean {
  return r.factory.startsWith('Overseas (PR') || r.vehicle_model.startsWith('Aggregate (PR');
}

/** Kia export 엑셀의 vehicle_type (8종, 연도별 차이 포함) → 6개 카테고리로 정규화.
 *  엑셀 표기:
 *   - 'Passenger Car' / 'Recreational Vehicle' / 'Commercial Vehicle'
 *   - 'Special Vehicle' (2023~)
 *   - 'CKD(excl, Special Vehicle)' (2024~) / 'CKD(Inc, Special Vehicle)' (2023, 단일) / 'KD' (2021~2022, CKD 통합)
 *   - 'CKD(Special Vehicle)' (2024~)
 *  → PC / RV / CV / SV / CKD_ex / CKD_sp */
export function normalizeKiaVehicleType(raw: string): KiaExportType {
  const v = raw.trim();
  if (v === 'Passenger Car') return 'PC';
  if (v === 'Recreational Vehicle') return 'RV';
  if (v === 'Commercial Vehicle') return 'CV';
  if (v === 'Special Vehicle') return 'SV';
  if (v === 'CKD(Special Vehicle)') return 'CKD_sp';
  // 'CKD(excl, Special Vehicle)' | 'CKD(Inc, Special Vehicle)' | 'KD'
  if (v.startsWith('CKD') || v === 'KD') return 'CKD_ex';
  return 'PC'; // fallback (현재 데이터엔 없음)
}

/** 'YYYY-MM' / 'YYYY' / 'YYYY-Q1' → 차트 X축 라벨. */
export function formatPeriodLabel(
  period: string,
  periodType: CompanySaleRow['period_type']
): string {
  if (periodType === 'annual') return period;
  if (periodType === 'quarter') return period.replace('-', '');
  const [y, m] = period.split('-');
  return `${y.slice(2)}.${m}`;
}

function shiftPeriodByYear(period: string, deltaYears: number): string {
  if (/^\d{4}$/.test(period)) {
    return String(parseInt(period, 10) + deltaYears);
  }
  const [y, rest] = period.split('-', 2);
  return `${parseInt(y, 10) + deltaYears}-${rest}`;
}

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

export function attachPowertrains(
  rows: KiaSaleRow[],
  ptMap: VehiclePowertrainMapRow[]
): (CompanySaleRowWithPt & { factory: string })[] {
  return rows.map((r) => ({
    ...r,
    resolved_powertrain: r.powertrain ?? lookupPowertrain(r.vehicle_model, ptMap, r.year_period),
  }));
}

function periodYear(period: string): string {
  return period.slice(0, 4);
}

/** annual 모드에서 연도 라벨 결정:
 *  - 12개월 모두 있으면 'YYYY'
 *  - 12개월 미만 + 현재 연도 → 'YYYY YTD' (진행 중)
 *  - 12개월 미만 + 과거 연도 → 'YYYY.NN' (출처 한계, 사용자 명시) */
function annualYearLabel(year: string, monthSet: Set<number>): { key: string; isYtd: boolean } {
  const currentYear = new Date().getFullYear();
  const monthCount = monthSet.size;
  if (monthCount === 12) return { key: year, isYtd: false };
  const yNum = parseInt(year, 10);
  if (yNum === currentYear) return { key: `${year} YTD`, isYtd: true };
  // 과거 연도 미완 — 마지막 월까지 표시.
  const lastMonth = monthCount > 0 ? Math.max(...monthSet) : 0;
  return { key: `${year}.${String(lastMonth).padStart(2, '0')}`, isYtd: false };
}

/** annual 포인트 중 과거 미완 연도('YYYY.NN')를 찾아 차트 footer 보조문구 생성.
 *  출처가 연중까지만 게시한 경우(2024 export/retail 등) 누계 수치를 안내한다.
 *  예: '⚠ 2024년은 11~12월 미게재로 1~10월까지만 집계 (누계 1,234,567대)'.
 *  해당 연도가 없으면 null (12개월 완비 차트는 자동으로 표시 안 됨). */
export function partialYearNote(points: { period_label: string; total: number }[]): string | null {
  const parts = points
    .filter((p) => /^\d{4}\.\d{2}$/.test(p.period_label))
    .map((p) => {
      const [y, mm] = p.period_label.split('.');
      const m = parseInt(mm, 10);
      const head = m < 12 ? `${m + 1}~12월 미게재로 ` : '';
      return `${y}년은 ${head}1~${m}월까지만 집계 (누계 ${p.total.toLocaleString('ko-KR')}대)`;
    });
  return parts.length > 0 ? `⚠ ${parts.join(' · ')}` : null;
}

/** 회사 전체 도매 합산 시 double counting 방지.
 *  - factory<>'' (해외 공장) → 모두 포함
 *  - factory='' AND region IN ('내수','수출','CKD') → 한국 공장 출하 포함
 *  - factory='' AND region='' → 데이터에 존재하지 않으나, 방어적으로 제외 */
function isCountable(r: { factory: string; region: string }): boolean {
  if (r.factory !== '') return true;
  return r.region === '내수' || r.region === '수출' || r.region === 'CKD';
}

// ============================================================
// 시계열 (월/연 토글)
// ============================================================

export function aggregateMonthlySeries(
  rows: (CompanySaleRowWithPt & { factory: string })[]
): CompanyTimeSeriesPoint[] {
  const monthRows = rows.filter((r) => r.period_type === 'month' && isCountable(r));
  const periodTotals = new Map<string, number>();
  for (const r of monthRows) {
    periodTotals.set(r.year_period, (periodTotals.get(r.year_period) ?? 0) + r.sales_units);
  }
  const periods = [...periodTotals.keys()].sort();
  return periods.map((period) => {
    const sales = periodTotals.get(period) ?? 0;
    const prevSales = periodTotals.get(shiftPeriodByYear(period, -1)) ?? 0;
    const yoy = prevSales < MIN_YOY_PREV_SALES ? null : ((sales - prevSales) / prevSales) * 100;
    return { period, period_label: formatPeriodLabel(period, 'month'), sales, yoy_pct: yoy };
  });
}

export function aggregateAnnualSeries(
  rows: (CompanySaleRowWithPt & { factory: string })[]
): CompanyTimeSeriesPoint[] {
  const monthRows = rows.filter((r) => r.period_type === 'month' && isCountable(r));
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
    const monthsStr = yearMonths.get(year) ?? new Set<string>();
    const monthSet = new Set([...monthsStr].map((s) => parseInt(s, 10)));
    const isFull = monthSet.size === 12;
    const isCurrentYear = parseInt(year, 10) === new Date().getFullYear();
    const isYtdForYoY = !isFull;
    const prevYear = String(parseInt(year, 10) - 1);
    let prevSales: number;
    if (isYtdForYoY) {
      prevSales = monthRows
        .filter(
          (r) => periodYear(r.year_period) === prevYear && monthsStr.has(r.year_period.slice(-2))
        )
        .reduce((sum, r) => sum + r.sales_units, 0);
    } else {
      prevSales = yearTotals.get(prevYear) ?? 0;
    }
    const yoy = prevSales < MIN_YOY_PREV_SALES ? null : ((sales - prevSales) / prevSales) * 100;
    const { key } = annualYearLabel(year, monthSet);
    return {
      period: year,
      period_label: key,
      sales,
      yoy_pct: yoy,
    };
  });
}

// ============================================================
// KPI
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

export function aggregateKpi(
  rows: (CompanySaleRowWithPt & { factory: string })[]
): CompanyKpiSummary {
  const monthRows = rows.filter((r) => r.period_type === 'month' && isCountable(r));
  if (monthRows.length === 0) return EMPTY_KPI;

  const periods = [...new Set(monthRows.map((r) => r.year_period))].sort();
  const latestPeriod = periods[periods.length - 1];
  const latestYear = parseInt(periodYear(latestPeriod), 10);
  const latestMonthNum = parseInt(latestPeriod.slice(-2), 10);
  const isLatestYearComplete = latestMonthNum === 12;
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
// TOP N 차종 — 'Aggregate'(CKD 합계 row) 제외
// ============================================================

/** region 필터 옵션 — TOP10 토글.
 *  - 'all'      : 전체 (한국 출하 + 해외 공장)
 *  - 'domestic' : 한국 공장 출하만 (factory='', region IN ('내수','수출','CKD'))
 *  - '내수'     : 한국 공장 내수만
 *  - '수출'     : 한국 공장 수출만 */
export type CompanyRegionFilter = 'all' | 'domestic' | '내수' | '수출';

const EMPTY_TOP_RESULT: CompanyTopModelsResult = {
  rows: [],
  totals: { latestPeriod: 0, prevPeriod: 0, ytd: 0 },
};

export function aggregateTopModels(
  rows: (CompanySaleRowWithPt & { factory: string })[],
  topN = 10,
  regionFilter: CompanyRegionFilter = 'all'
): CompanyTopModelsResult {
  let monthRows = rows.filter((r) => r.period_type === 'month' && isCountable(r));
  if (regionFilter === 'domestic') {
    monthRows = monthRows.filter(
      (r) => r.factory === '' && (r.region === '내수' || r.region === '수출' || r.region === 'CKD')
    );
  } else if (regionFilter !== 'all') {
    monthRows = monthRows.filter((r) => r.region === regionFilter);
  }
  // 'Aggregate'(CKD section 합계 row, 차종 아님) 제외
  monthRows = monthRows.filter((r) => !KIA_NON_MODEL_LABELS.has(r.vehicle_model));
  if (monthRows.length === 0) return EMPTY_TOP_RESULT;

  const periods = [...new Set(monthRows.map((r) => r.year_period))].sort();
  const latestPeriod = periods[periods.length - 1];
  const latestYear = parseInt(periodYear(latestPeriod), 10);
  const isComplete = parseInt(latestPeriod.slice(-2), 10) === 12;
  const completedYear = isComplete ? latestYear : latestYear - 1;
  const prevYear = completedYear - 1;
  const inProgressYear = completedYear + 1;

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
    const cur = modelTotals.get(r.vehicle_model) ?? {
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
    modelTotals.set(r.vehicle_model, cur);
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

/** 차종 TOP10 '직전 완료연도' 컬럼 라벨.
 *  모델별 분해가 부분연도까지만이면 'YYYY.NN' (Kia 2024: 11~12월이 Aggregate 합계 보완이라
 *  차종 분해는 1~10월까지) — 완비면 'YYYY년'.
 *  wholesale 모델 행(isCountable + 비-Aggregate) 기준. retail도 동 기간(2024 10개월)이라 공용. */
export function kiaTopPrevYearLabel(rows: (CompanySaleRowWithPt & { factory: string })[]): {
  label: string;
  lastMonth: number;
  partial: boolean;
} {
  const monthRows = rows.filter(
    (r) => r.period_type === 'month' && isCountable(r) && !KIA_NON_MODEL_LABELS.has(r.vehicle_model)
  );
  if (monthRows.length === 0) return { label: '', lastMonth: 0, partial: false };
  const periods = [...new Set(monthRows.map((r) => r.year_period))].sort();
  const latest = periods[periods.length - 1];
  const latestYear = parseInt(periodYear(latest), 10);
  const isComplete = parseInt(latest.slice(-2), 10) === 12;
  const completedYear = isComplete ? latestYear : latestYear - 1;
  const prevYear = completedYear - 1;
  const prevMonths = monthRows
    .filter((r) => periodYear(r.year_period) === String(prevYear))
    .map((r) => parseInt(r.year_period.slice(-2), 10));
  const lastMonth = prevMonths.length ? Math.max(...prevMonths) : 0;
  const partial = lastMonth > 0 && lastMonth < 12;
  const label = partial ? `${prevYear}.${String(lastMonth).padStart(2, '0')}` : `${prevYear}년`;
  return { label, lastMonth, partial };
}

// ============================================================
// PowerTrain Mix
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

export function aggregatePtMix(
  rows: (CompanySaleRowWithPt & { factory: string })[]
): CompanyPtMixPoint[] {
  const monthRows = rows.filter((r) => r.period_type === 'month' && isCountable(r));
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

export function aggregatePtMixAnnual(
  rows: (CompanySaleRowWithPt & { factory: string })[]
): CompanyPtMixPoint[] {
  const monthRows = rows.filter((r) => r.period_type === 'month' && isCountable(r));
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

/** PT mix에서 EV로 집계되는 차종 목록 (resolved_powertrain='EV' & 실판매>0, 정렬).
 *  PT mix의 EV 막대 구성을 차트 주석에 노출하기 위함. */
export function listEvModels(rows: (CompanySaleRowWithPt & { factory: string })[]): string[] {
  return [
    ...new Set(
      rows
        .filter(
          (r) => r.period_type === 'month' && r.resolved_powertrain === 'EV' && r.sales_units > 0
        )
        .map((r) => r.vehicle_model)
    ),
  ].sort();
}

// ============================================================
// 공장별 출하량 stacked bar (한국 + 해외 5 plant) — 월/연 토글
// 사용자 명시: 한국 공장(factory='', 내수+수출+CKD)을 'Korea Plants'로 포함.
// ============================================================

const KOREA_PLANT_LABEL = 'Korea Plants';

/** 한 행을 stacked의 어떤 factory bucket에 넣을지 — 한국 공장 행은 'Korea Plants'로 매핑. */
function factoryBucket(r: { factory: string }): string {
  return r.factory === '' ? KOREA_PLANT_LABEL : r.factory;
}

export function aggregateKiaFactoryMix(
  rows: (CompanySaleRowWithPt & { factory: string })[]
): FactoryMixPoint[] {
  const monthRows = rows.filter(
    (r) => r.period_type === 'month' && isCountable(r) && !isPrAggregate(r)
  );
  const byPeriod = new Map<string, FactoryMixPoint>();
  for (const r of monthRows) {
    let p = byPeriod.get(r.year_period);
    if (!p) {
      p = {
        period: r.year_period,
        period_label: formatPeriodLabel(r.year_period, 'month'),
        factories: {},
        total: 0,
      };
      byPeriod.set(r.year_period, p);
    }
    const k = factoryBucket(r);
    p.factories[k] = (p.factories[k] ?? 0) + r.sales_units;
    p.total += r.sales_units;
  }
  return [...byPeriod.values()].sort((a, b) => (a.period < b.period ? -1 : 1));
}

export function aggregateKiaFactoryMixAnnual(
  rows: (CompanySaleRowWithPt & { factory: string })[]
): FactoryMixPoint[] {
  // 월별 차트와 동일하게 PR 보완분('Overseas (PR)' = 2024 11~12월 공장 미분해) 제외.
  // → 2024 공장별 합계는 해외 11~12월(약 42만대)만큼 출하량 추이보다 작다(의도).
  const monthRows = rows.filter(
    (r) => r.period_type === 'month' && isCountable(r) && !isPrAggregate(r)
  );
  const monthsByYear = new Map<string, Set<number>>();
  for (const r of monthRows) {
    const y = periodYear(r.year_period);
    const m = parseInt(r.year_period.slice(-2), 10);
    if (!monthsByYear.has(y)) monthsByYear.set(y, new Set());
    monthsByYear.get(y)!.add(m);
  }
  const byYear = new Map<string, FactoryMixPoint>();
  for (const r of monthRows) {
    const y = periodYear(r.year_period);
    let p = byYear.get(y);
    if (!p) {
      const { key } = annualYearLabel(y, monthsByYear.get(y) ?? new Set());
      p = { period: y, period_label: key, factories: {}, total: 0 };
      byYear.set(y, p);
    }
    const k = factoryBucket(r);
    p.factories[k] = (p.factories[k] ?? 0) + r.sales_units;
    p.total += r.sales_units;
  }
  return [...byYear.values()].sort((a, b) => (a.period < b.period ? -1 : 1));
}

// ============================================================
// 지역별 수출 (10 region) — export-by-region. 월/연 토글, 진행 연도 YTD 라벨.
// ============================================================

/** Hyundai와 동일 구조 — region_name 합산. */
export interface KiaExportRegionPoint {
  period: string;
  period_label: string;
  regions: Record<string, number>;
  total: number;
  is_ytd?: boolean;
}

export function aggregateKiaExportRegions(
  rows: KiaExportRegionRow[],
  mode: 'month' | 'annual'
): KiaExportRegionPoint[] {
  const filtered = rows.filter((r) => r.source === 'export-by-region' && r.period_type === 'month');
  if (filtered.length === 0) return [];

  // 연간 모드: 12월까지 채워졌는지 판단
  const monthsByYear = new Map<string, Set<number>>();
  const currentYear = new Date().getFullYear();
  for (const r of filtered) {
    const y = periodYear(r.year_period);
    const m = parseInt(r.year_period.slice(-2), 10);
    if (!monthsByYear.has(y)) monthsByYear.set(y, new Set());
    monthsByYear.get(y)!.add(m);
  }

  void currentYear;
  const byPeriod = new Map<string, KiaExportRegionPoint>();
  for (const r of filtered) {
    let key: string;
    let label: string;
    let isYtd = false;
    if (mode === 'month') {
      key = r.year_period;
      label = formatPeriodLabel(key, 'month');
    } else {
      const y = periodYear(r.year_period);
      const monthSet = monthsByYear.get(y) ?? new Set<number>();
      const out = annualYearLabel(y, monthSet);
      key = out.key;
      label = out.key;
      isYtd = out.isYtd;
    }
    let p = byPeriod.get(key);
    if (!p) {
      p = {
        period: key,
        period_label: label,
        regions: {},
        total: 0,
        is_ytd: mode === 'annual' ? isYtd : undefined,
      };
      byPeriod.set(key, p);
    }
    p.regions[r.region_name] = (p.regions[r.region_name] ?? 0) + r.sales_units;
    p.total += r.sales_units;
  }
  return [...byPeriod.values()].sort((a, b) => (a.period < b.period ? -1 : 1));
}

// ============================================================
// 수출 차종 type mix (6 카테고리 100% stacked) — 월/연 토글
// ============================================================

function emptyTypePoint(period: string, period_label: string): KiaExportTypeMixPoint {
  return {
    period,
    period_label,
    PC: 0,
    RV: 0,
    CV: 0,
    SV: 0,
    CKD_ex: 0,
    CKD_sp: 0,
    total: 0,
  };
}

// ============================================================
// 연도별 출하 누적 (내수/수출/해외) — 가로 막대 차트용
// 사용자 명시 이미지: 4년 연도별 내수/수출/해외 stacked, 합계 라벨.
// ============================================================

export interface ShipmentBreakdownRow {
  period_label: string;
  domestic: number; // 내수 (한국 시장)
  export: number; // 수출 (한국 공장에서 수출)
  overseas: number; // 해외 (해외 공장 도매)
}

export function aggregateKiaShipmentBreakdown(
  rows: (CompanySaleRowWithPt & { factory: string })[]
): ShipmentBreakdownRow[] {
  const monthRows = rows.filter((r) => r.period_type === 'month' && isCountable(r));
  // 연도별 분류
  const byYear = new Map<
    string,
    { domestic: number; export: number; overseas: number; months: Set<number> }
  >();
  for (const r of monthRows) {
    const y = periodYear(r.year_period);
    const mm = parseInt(r.year_period.slice(-2), 10);
    let cur = byYear.get(y);
    if (!cur) {
      cur = { domestic: 0, export: 0, overseas: 0, months: new Set() };
      byYear.set(y, cur);
    }
    cur.months.add(mm);
    if (r.factory !== '') {
      cur.overseas += r.sales_units;
    } else if (r.region === '내수') {
      cur.domestic += r.sales_units;
    } else if (r.region === '수출') {
      cur.export += r.sales_units;
    }
    // CKD는 skip (의미 별도)
  }
  const years = [...byYear.keys()].sort();
  return years.map((y) => {
    const v = byYear.get(y)!;
    const label_obj = annualYearLabel(y, v.months);
    return {
      period_label: label_obj.key,
      domestic: v.domestic,
      export: v.export,
      overseas: v.overseas,
    };
  });
}

// ============================================================
// 국내 내수 출하 모델별 stacked — kia_sales factory='' AND region='내수'
// 사용자 요청: "국내 내수 출하 차트 추가 — 한국 출하 → 지역별 수출 앞에 위치"
// ============================================================

/** 국내 내수(한국 시장) 모델별 stacked bar 한 점. */
export interface KiaDomesticByModelPoint {
  period: string;
  period_label: string;
  models: Record<string, number>;
  total: number;
  is_ytd?: boolean;
}

function _domesticFiltered(
  rows: (CompanySaleRowWithPt & { factory: string })[]
): (CompanySaleRowWithPt & { factory: string })[] {
  return rows.filter(
    (r) =>
      r.period_type === 'month' &&
      r.factory === '' &&
      r.region === '내수' &&
      !KIA_NON_MODEL_LABELS.has(r.vehicle_model)
  );
}

export function aggregateKiaDomesticByModel(
  rows: (CompanySaleRowWithPt & { factory: string })[],
  mode: 'month' | 'annual'
): KiaDomesticByModelPoint[] {
  const filtered = _domesticFiltered(rows);
  if (filtered.length === 0) return [];

  // annual 모드용 12월 완비 판정
  const monthsByYear = new Map<string, Set<number>>();
  const currentYear = new Date().getFullYear();
  if (mode === 'annual') {
    for (const r of filtered) {
      const y = periodYear(r.year_period);
      const m = parseInt(r.year_period.slice(-2), 10);
      if (!monthsByYear.has(y)) monthsByYear.set(y, new Set());
      monthsByYear.get(y)!.add(m);
    }
  }

  void currentYear;
  const byPeriod = new Map<string, KiaDomesticByModelPoint>();
  for (const r of filtered) {
    let key: string;
    let label: string;
    let isYtd = false;
    if (mode === 'month') {
      key = r.year_period;
      label = formatPeriodLabel(key, 'month');
    } else {
      const y = periodYear(r.year_period);
      const monthSet = monthsByYear.get(y) ?? new Set<number>();
      const out = annualYearLabel(y, monthSet);
      key = out.key;
      label = out.key;
      isYtd = out.isYtd;
    }
    let p = byPeriod.get(key);
    if (!p) {
      p = {
        period: key,
        period_label: label,
        models: {},
        total: 0,
        is_ytd: mode === 'annual' ? isYtd : undefined,
      };
      byPeriod.set(key, p);
    }
    p.models[r.vehicle_model] = (p.models[r.vehicle_model] ?? 0) + r.sales_units;
    p.total += r.sales_units;
  }
  return [...byPeriod.values()].sort((a, b) => (a.period < b.period ? -1 : 1));
}

// ============================================================
// kia_retail_sales — 지역별 retail stacked + 모델 TOP10 (plant 필터)
// ============================================================

/** 지역별 retail stacked bar 한 점 (12 region). */
export interface KiaRetailRegionPoint {
  period: string;
  period_label: string;
  regions: Record<string, number>;
  total: number;
  is_ytd?: boolean;
}

/** 지역별 retail stacked — month/annual 토글.
 *  YTD 라벨은 **진행 중 연도(=현재 연도)에 12개월 미만일 때만** 부착.
 *  과거 연도(2024 등)는 12개월 미만이어도 그냥 'YYYY'로 표시 (출처 한계는 footer로 안내).
 *  annual 모드는 [2021..현재] 범위 빈 row 보장 — 사용자 명시 "다른 차트처럼 2021부터". */
const RETAIL_ANNUAL_MIN_YEAR = 2021;

export function aggregateKiaRetailRegions(
  rows: KiaRetailSaleRow[],
  mode: 'month' | 'annual'
): KiaRetailRegionPoint[] {
  const months = rows.filter((r) => r.period_type === 'month');
  if (months.length === 0) return [];

  const monthsByYear = new Map<string, Set<number>>();
  const currentYear = new Date().getFullYear();
  if (mode === 'annual') {
    for (const r of months) {
      const y = periodYear(r.year_period);
      const m = parseInt(r.year_period.slice(-2), 10);
      if (!monthsByYear.has(y)) monthsByYear.set(y, new Set());
      monthsByYear.get(y)!.add(m);
    }
  }

  void currentYear;
  const byPeriod = new Map<string, KiaRetailRegionPoint>();
  for (const r of months) {
    let key: string;
    let label: string;
    let isYtd = false;
    if (mode === 'month') {
      key = r.year_period;
      label = formatPeriodLabel(key, 'month');
    } else {
      const y = periodYear(r.year_period);
      const monthSet = monthsByYear.get(y) ?? new Set<number>();
      const out = annualYearLabel(y, monthSet);
      key = out.key;
      label = out.key;
      isYtd = out.isYtd;
    }
    let p = byPeriod.get(key);
    if (!p) {
      p = {
        period: key,
        period_label: label,
        regions: {},
        total: 0,
        is_ytd: mode === 'annual' ? isYtd : undefined,
      };
      byPeriod.set(key, p);
    }
    p.regions[r.region] = (p.regions[r.region] ?? 0) + r.retail_units;
    p.total += r.retail_units;
  }
  return [...byPeriod.values()].sort((a, b) => (a.period < b.period ? -1 : 1));
}

/** retail KPI (전년 vs 최근 완료 + YTD YoY). 데이터 일관성 위해 sales KPI와 같은 구조. */
export function aggregateKiaRetailKpi(rows: KiaRetailSaleRow[]): CompanyKpiSummary {
  const months = rows.filter((r) => r.period_type === 'month');
  if (months.length === 0) {
    return {
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
  }
  const periods = [...new Set(months.map((r) => r.year_period))].sort();
  const latestPeriod = periods[periods.length - 1];
  const latestYear = parseInt(periodYear(latestPeriod), 10);
  const latestMonthNum = parseInt(latestPeriod.slice(-2), 10);
  const isLatestYearComplete = latestMonthNum === 12;
  const completedYear = isLatestYearComplete ? latestYear : latestYear - 1;
  const inProgressYear = completedYear + 1;

  const sumYear = (year: number) =>
    months
      .filter((r) => periodYear(r.year_period) === String(year))
      .reduce((a, r) => a + r.retail_units, 0);

  const sumYearMonths = (year: number, monthSet: Set<number>) =>
    months
      .filter(
        (r) =>
          periodYear(r.year_period) === String(year) &&
          monthSet.has(parseInt(r.year_period.slice(-2), 10))
      )
      .reduce((a, r) => a + r.retail_units, 0);

  const latestYearSales = sumYear(completedYear);
  const prevYearSales = sumYear(completedYear - 1);
  const yoyPct =
    prevYearSales < MIN_YOY_PREV_SALES
      ? null
      : ((latestYearSales - prevYearSales) / prevYearSales) * 100;

  // YTD = inProgressYear 의 실제 발생 월 (retail_units>0)
  const inProgressMonths = new Set(
    months
      .filter((r) => periodYear(r.year_period) === String(inProgressYear) && r.retail_units > 0)
      .map((r) => parseInt(r.year_period.slice(-2), 10))
  );
  const hasInProgress = inProgressMonths.size > 0;
  const ytdLastMonth = hasInProgress ? Math.max(...inProgressMonths) : 0;

  let ytdLabel: string;
  let ytdCurrent: number;
  let ytdPrevLabel: string;
  let ytdPrev: number;
  let ytdYoyPct: number | null;

  if (hasInProgress) {
    ytdLabel = `${inProgressYear} YTD (1~${ytdLastMonth}월)`;
    ytdCurrent = sumYearMonths(inProgressYear, inProgressMonths);
    ytdPrevLabel = `${completedYear} 1~${ytdLastMonth}월`;
    ytdPrev = sumYearMonths(completedYear, inProgressMonths);
    ytdYoyPct = ytdPrev < MIN_YOY_PREV_SALES ? null : ((ytdCurrent - ytdPrev) / ytdPrev) * 100;
  } else {
    ytdLabel = `${inProgressYear} YTD (대기)`;
    ytdCurrent = 0;
    ytdPrevLabel = `${completedYear} 연간`;
    ytdPrev = latestYearSales;
    ytdYoyPct = null;
  }

  return {
    latestYearLabel: `${completedYear}년 retail`,
    latestYearSales,
    prevYearLabel: `${completedYear - 1}년 retail`,
    prevYearSales,
    yoyPct,
    ytdLabel,
    ytdCurrent,
    ytdPrevLabel,
    ytdPrev,
    ytdYoyPct,
    evRatio: null,
    latestPeriod,
  };
}

/** retail TOP N 차종 — plant 필터 ('all' | 'Korea Plants' | 'U.S. Plant' | ...).
 *  selectedMonths 판정 시 retail_units>0 조건으로 YTD 모드 안정 판정 (현대 retail과 동일 패턴). */
export function aggregateKiaRetailTopModels(
  rows: KiaRetailSaleRow[],
  topN = 10,
  plantFilter: 'all' | string = 'all'
): CompanyTopModelsResult {
  let months = rows.filter((r) => r.period_type === 'month');
  if (plantFilter !== 'all') {
    months = months.filter((r) => r.plant === plantFilter);
  }
  if (months.length === 0) {
    return { rows: [], totals: { latestPeriod: 0, prevPeriod: 0, ytd: 0 } };
  }

  const periods = [...new Set(months.map((r) => r.year_period))].sort();
  const latestPeriod = periods[periods.length - 1];
  const latestYear = parseInt(periodYear(latestPeriod), 10);
  const inProgressYear = latestYear;

  // 진행 중 연도의 실제 retail_units>0 발생 월
  const selectedMonths = new Set(
    months
      .filter((r) => periodYear(r.year_period) === String(inProgressYear) && r.retail_units > 0)
      .map((r) => r.year_period.slice(-2))
  );
  const isYtdMode = selectedMonths.size > 0 && selectedMonths.size < 12;
  const lastCompletedYear = isYtdMode ? String(inProgressYear - 1) : String(inProgressYear);
  const prevYear = String(parseInt(lastCompletedYear, 10) - 1);

  type Agg = { latest: number; prev: number; ytd: number; ytdPrev: number };
  const byModel = new Map<string, Agg>();
  let totLatest = 0;
  let totPrev = 0;
  let totYtd = 0;
  let totYtdPrev = 0;
  for (const r of months) {
    const y = periodYear(r.year_period);
    const mm = r.year_period.slice(-2);
    const v = r.retail_units;
    const cur = byModel.get(r.vehicle_model) ?? { latest: 0, prev: 0, ytd: 0, ytdPrev: 0 };
    if (y === lastCompletedYear) {
      cur.latest += v;
      totLatest += v;
    }
    if (y === prevYear) {
      cur.prev += v;
      totPrev += v;
    }
    if (isYtdMode) {
      if (y === String(inProgressYear)) {
        cur.ytd += v;
        totYtd += v;
      }
      if (y === lastCompletedYear && selectedMonths.has(mm)) {
        cur.ytdPrev += v;
        totYtdPrev += v;
      }
    }
    byModel.set(r.vehicle_model, cur);
  }

  const items: CompanyTopModelRow[] = [...byModel.entries()].map(([model, a]) => ({
    model,
    salesLatestPeriod: a.latest,
    salesPrevPeriod: a.prev,
    ytdSales: a.ytd,
    ytdPrevSales: a.ytdPrev,
    yoyPct: a.prev < MIN_YOY_PREV_SALES ? null : ((a.latest - a.prev) / a.prev) * 100,
    ytdYoyPct: a.ytdPrev < MIN_YOY_PREV_SALES ? null : ((a.ytd - a.ytdPrev) / a.ytdPrev) * 100,
    resolvedPt: null,
  }));
  const sortKey = (r: CompanyTopModelRow) => (isYtdMode ? r.ytdSales : r.salesLatestPeriod);
  items.sort((a, b) => sortKey(b) - sortKey(a));

  return {
    rows: items.slice(0, topN),
    totals: { latestPeriod: totLatest, prevPeriod: totPrev, ytd: totYtd, ytdPrev: totYtdPrev },
  };
}

/** retail 데이터에 등장하는 plant 목록 (도매 wholesale 토글용). */
export function listRetailPlants(rows: KiaRetailSaleRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    if (r.period_type !== 'month') continue;
    if (r.plant) set.add(r.plant);
  }
  return [...set].sort();
}

export function aggregateKiaExportTypeMix(
  rows: KiaExportRegionRow[],
  mode: 'month' | 'annual'
): KiaExportTypeMixPoint[] {
  const filtered = rows.filter((r) => r.source === 'export-by-region' && r.period_type === 'month');
  if (filtered.length === 0) return [];

  // 연간 모드: 12월까지 채워졌는지 판단해 YTD 라벨
  const monthsByYear = new Map<string, Set<number>>();
  const currentYear = new Date().getFullYear();
  for (const r of filtered) {
    const y = periodYear(r.year_period);
    const m = parseInt(r.year_period.slice(-2), 10);
    if (!monthsByYear.has(y)) monthsByYear.set(y, new Set());
    monthsByYear.get(y)!.add(m);
  }

  void currentYear;
  const byPeriod = new Map<string, KiaExportTypeMixPoint>();
  for (const r of filtered) {
    let key: string;
    let label: string;
    if (mode === 'month') {
      key = r.year_period;
      label = formatPeriodLabel(key, 'month');
    } else {
      const y = periodYear(r.year_period);
      const monthSet = monthsByYear.get(y) ?? new Set<number>();
      const out = annualYearLabel(y, monthSet);
      key = out.key;
      label = out.key;
    }
    let p = byPeriod.get(key);
    if (!p) {
      p = emptyTypePoint(key, label);
      byPeriod.set(key, p);
    }
    const t = normalizeKiaVehicleType(r.vehicle_type);
    p[t] += r.sales_units;
    p.total += r.sales_units;
  }
  return [...byPeriod.values()].sort((a, b) => (a.period < b.period ? -1 : 1));
}
