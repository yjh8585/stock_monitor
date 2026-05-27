/**
 * 현대차(/oem/hyundai) 사전 가공 — pure 함수만.
 *
 * KG(lib/oem-companies/kg-mobility/aggregate.ts)와 동일 패턴.
 * 회사별 보강: 해외 공장별 stacked bar (aggregateHyundaiFactoryMix).
 *
 * 공통 함수(monthly/annual series · KPI · TopModels · PtMix)는 KG 구현과 거의 동일 —
 * CompanySaleRow 기반이라 회사 무관. 향후 공통화 검토 가능.
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
  FactoryModelMixPoint,
  HyundaiAnnualEarningsPoint,
  HyundaiEuRetailData,
  HyundaiEuRetailPoint,
  HyundaiEuRetailTopModel,
  HyundaiExportRegionPoint,
  HyundaiExportRegionRow,
  HyundaiIRComparisonSummary,
  HyundaiMarketSharePoint,
  HyundaiQuarterlyEarningsPoint,
  HyundaiQuarterlyEarningsRow,
  HyundaiQuarterlyRegionPoint,
  HyundaiRetailSaleRow,
  HyundaiRetailWholesaleData,
  HyundaiRetailWholesaleRegionCard,
  HyundaiSaleRow,
  HyundaiVehicleType,
  HyundaiVehicleTypeMixPoint,
  VehiclePowertrainMapRow,
} from '@/lib/types';

export const MIN_YOY_PREV_SALES = 10;

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
  rows: HyundaiSaleRow[],
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

/** 회사 전체 판매 = 한국 공장 출하(factory='', region IN ('내수','수출'))
 *  + 해외 공장 도매(factory<>''). 세부 region(U.S.A./Canada/Europe Subs/...) 행은
 *  export.xlsx의 region 분해 데이터로 sales-by-model의 '수출' Total과 동일 데이터 → 중복 합산 방지.
 *  KPI/시계열/TopModels/PT mix에서 isCountable() 필터로 export region 제외.
 *  지역별 수출 차트(Phase 2A)는 region 세부만 별도 사용. */
function isCountable(r: { factory: string; region: string }): boolean {
  // 해외 공장 행 = 모두 포함 (factory<>'')
  if (r.factory !== '') return true;
  // 한국 공장(factory='') = '내수'/'수출' Total만 (sales-by-model). 세부 region(export.xlsx)은 중복.
  return r.region === '내수' || r.region === '수출';
}

// ============================================================
// 시계열 (월/연 토글)
// ============================================================

/** 한 행이 시계열 합산 필터를 통과하는지 — 회사 전체 vs 한국 내수만 등.
 *  - 'all'      : isCountable (한국 공장 출하 + 해외 공장 도매)
 *  - 'domestic' : 한국 공장(factory='') + region='내수'만 (국내 시장 판매분)
 */
type SeriesScope = 'all' | 'domestic';

function passesScope(r: { factory: string; region: string }, scope: SeriesScope): boolean {
  if (scope === 'all') return isCountable(r);
  // domestic: 한국 시장 판매 (factory='' AND region='내수')
  return r.factory === '' && r.region === '내수';
}

export function aggregateMonthlySeries(
  rows: (CompanySaleRowWithPt & { factory: string })[],
  scope: SeriesScope = 'all'
): CompanyTimeSeriesPoint[] {
  const monthRows = rows.filter((r) => r.period_type === 'month' && passesScope(r, scope));
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
  rows: (CompanySaleRowWithPt & { factory: string })[],
  scope: SeriesScope = 'all'
): CompanyTimeSeriesPoint[] {
  const monthRows = rows.filter((r) => r.period_type === 'month' && passesScope(r, scope));
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
    // YTD 연도면 prev year도 같은 월까지로 잘라서 비교 (사용자 보고: 2026 YTD vs 2025 전체 비교가 -67.9% 잘못).
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
// 연도별 출하 누적 (내수/수출/해외) — 사용자 명시 가로 막대 차트용.
// ============================================================

export interface HyundaiShipmentBreakdownRow {
  period_label: string;
  domestic: number;
  export: number;
  overseas: number;
}

export function aggregateHyundaiShipmentBreakdown(
  rows: (CompanySaleRowWithPt & { factory: string })[]
): HyundaiShipmentBreakdownRow[] {
  const monthRows = rows.filter((r) => r.period_type === 'month' && isCountable(r));
  const byYear = new Map<
    string,
    { domestic: number; export: number; overseas: number; months: Set<string> }
  >();
  for (const r of monthRows) {
    const y = periodYear(r.year_period);
    const mm = r.year_period.slice(-2);
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
  }
  const currentYear = new Date().getFullYear();
  const years = [...byYear.keys()].sort();
  return years.map((y) => {
    const v = byYear.get(y)!;
    const monthCount = v.months.size;
    let label: string;
    if (monthCount === 12) label = y;
    else if (parseInt(y, 10) === currentYear) label = `${y} YTD`;
    else {
      const lastMm = Math.max(...[...v.months].map((s) => parseInt(s, 10)));
      label = `${y}.${String(lastMm).padStart(2, '0')}`;
    }
    return {
      period_label: label,
      domestic: v.domestic,
      export: v.export,
      overseas: v.overseas,
    };
  });
}

// ============================================================
// 한국 공장 출하 stacked (내수/수출) — 사용자 명시 #C2 신규 차트.
// 결과는 HyundaiExportRegionPoint 형식 재사용 (regions: { 내수, 수출 }).
// ============================================================

function shiftMonthByYear(month: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  return `${parseInt(m[1], 10) + delta}-${m[2]}`;
}

/** 한국 공장 출하(factory='' AND region IN '내수','수출') stacked — 월별. */
export function aggregateHyundaiKoreaPlantMonthlyStack(
  rows: (CompanySaleRowWithPt & { factory: string })[]
): HyundaiExportRegionPoint[] {
  const filtered = rows.filter(
    (r) => r.period_type === 'month' && r.factory === '' && (r.region === '내수' || r.region === '수출')
  );
  const map = new Map<string, { 내수: number; 수출: number }>();
  for (const r of filtered) {
    const cur = map.get(r.year_period) ?? { 내수: 0, 수출: 0 };
    if (r.region === '내수') cur.내수 += r.sales_units;
    else cur.수출 += r.sales_units;
    map.set(r.year_period, cur);
  }
  const periods = [...map.keys()].sort();
  return periods.map((p) => {
    const { 내수, 수출 } = map.get(p)!;
    return {
      period: p,
      period_label: formatPeriodLabel(p, 'month'),
      total: 내수 + 수출,
      regions: { 내수, 수출 },
    };
  });
}

/** 한국 공장 출하 stacked — 연간 (진행 중 연도는 'YYYY YTD'). */
export function aggregateHyundaiKoreaPlantAnnualStack(
  rows: (CompanySaleRowWithPt & { factory: string })[]
): HyundaiExportRegionPoint[] {
  const filtered = rows.filter(
    (r) => r.period_type === 'month' && r.factory === '' && (r.region === '내수' || r.region === '수출')
  );
  const yearMap = new Map<string, { 내수: number; 수출: number; months: Set<string> }>();
  for (const r of filtered) {
    const y = periodYear(r.year_period);
    const cur = yearMap.get(y) ?? { 내수: 0, 수출: 0, months: new Set<string>() };
    if (r.region === '내수') cur.내수 += r.sales_units;
    else cur.수출 += r.sales_units;
    cur.months.add(r.year_period);
    yearMap.set(y, cur);
  }
  const years = [...yearMap.keys()].sort();
  return years.map((y) => {
    const v = yearMap.get(y)!;
    const isYtd = v.months.size < 12;
    return {
      period: y,
      period_label: isYtd ? `${y} YTD` : y,
      total: v.내수 + v.수출,
      regions: { 내수: v.내수, 수출: v.수출 },
      is_ytd: isYtd,
    };
  });
}
void shiftMonthByYear; // (reserved for future MoM YoY)

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
// TOP N 차종 (factory='' 전체만)
// ============================================================

/** region 필터 옵션 — TOP10 토글.
 *  - 'all'   : 전체 (한국 공장 출하 + 해외 공장 도매)
 *  - 'all:내수' / 'all:수출' : 전체 데이터에서 region 필터 추가 (#7)
 *  - 'domestic': 한국 공장 출하만 (factory='', region IN ('내수','수출'))
 *  - '내수'  : 한국 공장 내수 출하만 (factory='', region='내수')
 *  - '수출'  : 한국 공장 수출 출하만 (factory='', region='수출')
 *  - 그 외 string: 해당 factory 코드 (예: 'HMI', 'HMMA') — 해외 공장만 사용 (region 무관)
 *  - 'factory:HMI:내수' / 'factory:HMI:수출' : 해외 공장 + region 필터 (#7) */
export type CompanyRegionFilter = string;

/**
 * 차종명을 프로그램 코드로 통일.
 *
 * - "Avante (CN7)", "Avante (CN7c)", "Avante (CN7 HEV)" → 모두 "Avante (CN7)"
 * - "Tucson (NX4)", "Tucson (NX4a)", "Tucson (NX4 HEV)" → 모두 "Tucson (NX4)"
 * - 매칭 없으면 원본 그대로 반환.
 *
 * 형식: `이름 (CODE[region][ PT])` — CODE는 대문자+숫자, region 접미는 소문자, PT는 공백+토큰.
 */
/** 모델명 → 프로그램 코드 통일 (모든 hyundai 모델 일괄 적용).
 *  - "Avante (CN7)" / "Elantra (CN7c)" / "Avante (CN7 HEV)" / "Avante (CN7 N)" → "Elantra (CN7)"
 *  - "Tucson (NX4a)" / "Tucson HEV (NX4e HEV)" / "Tucson OB (NX4a OB)" → "Tucson (NX4)"
 *  - "Kona (SX2 HEV)" / "Kona (OS HEV)" → "Kona (SX2)" / "Kona (OS)" (generation 별개 유지)
 *  - "Sonata (DN8 HEV)" → "Sonata (DN8)" / "Palisade (LX3 HEV)" → "Palisade (LX3)"
 *  - "Casper EV (AX EV)" → "Casper (AX)"
 *  - "IONIQ 5 (NE)" → "IONIQ 5 (NE)" (코드에 숫자 없으면 그대로)
 *  규칙:
 *   1) brand prefix powertrain/variant suffix 제거 (HEV/PHEV/EV/FCEV/MHEV/OB/N/GT)
 *   2) 괄호 코드: 끝의 PT/region suffix 단어 제거 → 영문+숫자 그룹 첫 매칭 또는 trailing 영문 1~2자(region 코드) 제거
 *   3) Avante↔Elantra 통일 → "Elantra" (글로벌 통일명) */
export function normalizeProgramCode(model: string): string {
  const m = /^([^()]+?)\s*\(([^)]+)\)\s*$/.exec(model);
  if (!m) return model;
  let brand = m[1].trim();
  let codePart = m[2].trim();

  // 1) brand suffix 제거
  brand = brand.replace(/\s+(HEV|PHEV|EV|FCEV|MHEV|OB|N|GT)$/i, '').trim();
  // brand 표기 통일
  if (brand === 'Avante') brand = 'Elantra';
  if (/^Santa[\s-]+Fe$/i.test(brand)) brand = 'Santa-Fe';
  // Ioniq5 → IONIQ 5 / Ioniq9 → IONIQ 9 / ioniq6 → IONIQ 6
  const ioniqMatch = /^Ioniq\s*(\d+)$/i.exec(brand);
  if (ioniqMatch) brand = `IONIQ ${ioniqMatch[1]}`;

  // 2) code: 끝의 powertrain 단어 제거 (예: "NX4 HEV" → "NX4", "OS HEV" → "OS")
  codePart = codePart.replace(/\s+(HEV|PHEV|EV|FCEV|MHEV|OB|N|GT)\s*$/i, '').trim();
  // 3) 영문+숫자 매칭 → 코드 root (NX4a → NX4, CN7c → CN7)
  const numMatch = /^([A-Z]+\d+)[a-z]*$/.exec(codePart);
  if (numMatch) {
    return `${brand} (${numMatch[1]})`;
  }
  // 4) 영문만 코드 (OS/JK/NE) — 끝의 1~2자 소문자 region 코드 제거 (예: "OSa" → "OS")
  const alphaMatch = /^([A-Z]{2,})([a-z]{1,2})?$/.exec(codePart);
  if (alphaMatch) {
    return `${brand} (${alphaMatch[1]})`;
  }
  return `${brand} (${codePart})`;
}

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
  // 필터 키 파싱
  // - 'all'           : 전체
  // - 'all:내수'      : 전체 + region 필터 (#7)
  // - 'all:수출'      : 전체 + region 필터
  // - 'domestic'      : 한국 공장 (region 내수+수출)
  // - '내수' / '수출' : 한국 공장 + region 단일
  // - 'HMI' / 'HMMA' …: 해외 공장 전체 region
  // - 'factory:HMI:내수' …: 해외 공장 + region 필터 (#7)
  let regionRestrict: string | null = null; // '내수' | '수출' | null
  let factoryRestrict: string | null = null; // factory 코드 또는 null
  let mode: 'all' | 'domestic' | 'koreaRegion' | 'factory' = 'all';

  if (regionFilter === 'all') {
    mode = 'all';
  } else if (regionFilter === 'all:내수' || regionFilter === 'all:수출') {
    mode = 'all';
    regionRestrict = regionFilter.split(':')[1];
  } else if (regionFilter === 'domestic') {
    mode = 'domestic';
  } else if (regionFilter === '내수' || regionFilter === '수출') {
    mode = 'koreaRegion';
    regionRestrict = regionFilter;
  } else if (regionFilter.startsWith('factory:')) {
    const [, code, region] = regionFilter.split(':');
    mode = 'factory';
    factoryRestrict = code;
    if (region === '내수' || region === '수출') regionRestrict = region;
  } else {
    mode = 'factory';
    factoryRestrict = regionFilter;
  }

  if (mode === 'all' && regionRestrict) {
    // 전체 데이터 + region 필터: 한국 공장은 region 일치, 해외 공장은 그대로 분기
    // 해외 공장 행도 자체 region 컬럼이 있으므로 동일 일치 조건 적용
    monthRows = monthRows.filter((r) => r.region === regionRestrict);
  } else if (mode === 'domestic') {
    monthRows = monthRows.filter(
      (r) => r.factory === '' && (r.region === '내수' || r.region === '수출')
    );
  } else if (mode === 'koreaRegion') {
    monthRows = monthRows.filter((r) => r.factory === '' && r.region === regionRestrict);
  } else if (mode === 'factory') {
    monthRows = monthRows.filter(
      (r) =>
        r.factory === factoryRestrict && (regionRestrict ? r.region === regionRestrict : true)
    );
  }
  if (monthRows.length === 0) return EMPTY_TOP_RESULT;

  const periods = [...new Set(monthRows.map((r) => r.year_period))].sort();
  const latestPeriod = periods[periods.length - 1];
  const latestYear = parseInt(periodYear(latestPeriod), 10);
  const isComplete = parseInt(latestPeriod.slice(-2), 10) === 12;
  const completedYear = isComplete ? latestYear : latestYear - 1;
  const prevYear = completedYear - 1;
  const inProgressYear = completedYear + 1;

  // 차종 통일: 'all'(전체) 모드에서만 normalizeProgramCode 적용 (사용자 명시).
  // 'domestic'·공장 선택·region 필터 시는 원본 모델명 그대로.
  const useProgramCode = mode === 'all';
  const modelKey = (raw: string) => (useProgramCode ? normalizeProgramCode(raw) : raw);

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
    const key = modelKey(r.vehicle_model);
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
        // 정규화 모드(전체/국내)에서는 PT 정보가 무의미하므로 null (다른 PT의 모델이 합쳐짐).
        resolvedPt: useProgramCode ? null : pt,
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

/** 데이터에서 실제로 등장하는 해외 공장 코드 목록 — UI 드롭다운용. */
export function listFactoryCodes(rows: (CompanySaleRowWithPt & { factory: string })[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    if (r.period_type !== 'month') continue;
    if (r.factory && r.factory !== '') set.add(r.factory);
  }
  return [...set].sort();
}

/** 한 공장(또는 한국 전체 등)에서 실제로 등장하는 region 목록 — region 드롭다운 동적 구성 (#7).
 *  factoryCode='' → 한국 공장(국내 출하)의 region들.
 *  factoryCode='HMI' → HMI 공장의 region들. */
export function listRegionsForFactory(
  rows: (CompanySaleRowWithPt & { factory: string })[],
  factoryCode: string
): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    if (r.period_type !== 'month') continue;
    if (r.factory !== factoryCode) continue;
    if (r.region) set.add(r.region);
  }
  return [...set].sort();
}

/** 1단계 '전체' 모드에서 사용 가능한 region 목록 — 한국 공장 + 해외 공장 합쳐서 등장하는 region.
 *  사용자 요청 #7: 전체 + 내수/수출 분기. */
export function listAllRegions(rows: (CompanySaleRowWithPt & { factory: string })[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    if (r.period_type !== 'month') continue;
    if (!isCountable(r)) continue;
    if (r.region) set.add(r.region);
  }
  return [...set].sort();
}

// ============================================================
// PowerTrain Mix (factory='' 전체만)
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

// ============================================================
// 현대 전용: 해외 공장별 stacked bar (월/연 토글)
// factory<>'' 행만 사용. 국내(factory='')는 다른 차트에서 표시.
// ============================================================

export function aggregateHyundaiFactoryMix(
  rows: (CompanySaleRowWithPt & { factory: string })[]
): FactoryMixPoint[] {
  const monthRows = rows.filter(
    (r) => r.period_type === 'month' && isCountable(r) && r.factory !== ''
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
    p.factories[r.factory] = (p.factories[r.factory] ?? 0) + r.sales_units;
    p.total += r.sales_units;
  }
  return [...byPeriod.values()].sort((a, b) => (a.period < b.period ? -1 : 1));
}

export function aggregateHyundaiFactoryMixAnnual(
  rows: (CompanySaleRowWithPt & { factory: string })[]
): FactoryMixPoint[] {
  const monthRows = rows.filter(
    (r) => r.period_type === 'month' && isCountable(r) && r.factory !== ''
  );
  const byYear = new Map<string, FactoryMixPoint>();
  for (const r of monthRows) {
    const y = periodYear(r.year_period);
    let p = byYear.get(y);
    if (!p) {
      p = { period: y, period_label: y, factories: {}, total: 0 };
      byYear.set(y, p);
    }
    p.factories[r.factory] = (p.factories[r.factory] ?? 0) + r.sales_units;
    p.total += r.sales_units;
  }
  return [...byYear.values()].sort((a, b) => (a.period < b.period ? -1 : 1));
}

// ============================================================
// 차종 type mix (PC/RV/Genesis/CV/Other) — 월/연 토글
// vehicle_type 컬럼 (DB UPDATE로 보강됨) 기반.
// ============================================================

function emptyVehicleTypePoint(period: string, period_label: string): HyundaiVehicleTypeMixPoint {
  return {
    period,
    period_label,
    PC: 0,
    RV: 0,
    Genesis: 0,
    CV: 0,
    Other: 0,
    total: 0,
  };
}

function normalizeVehicleType(raw: string): HyundaiVehicleType {
  if (raw === 'PC' || raw === 'RV' || raw === 'Genesis' || raw === 'CV') return raw;
  return 'Other';
}

export function aggregateHyundaiVehicleTypeMix(
  rows: (CompanySaleRowWithPt & { factory: string })[]
): HyundaiVehicleTypeMixPoint[] {
  const monthRows = rows.filter((r) => r.period_type === 'month' && isCountable(r));
  const byPeriod = new Map<string, HyundaiVehicleTypeMixPoint>();
  for (const r of monthRows) {
    let p = byPeriod.get(r.year_period);
    if (!p) {
      p = emptyVehicleTypePoint(r.year_period, formatPeriodLabel(r.year_period, 'month'));
      byPeriod.set(r.year_period, p);
    }
    const t = normalizeVehicleType(r.vehicle_type);
    p[t] += r.sales_units;
    p.total += r.sales_units;
  }
  return [...byPeriod.values()].sort((a, b) => (a.period < b.period ? -1 : 1));
}

export function aggregateHyundaiVehicleTypeMixAnnual(
  rows: (CompanySaleRowWithPt & { factory: string })[]
): HyundaiVehicleTypeMixPoint[] {
  const monthRows = rows.filter((r) => r.period_type === 'month' && isCountable(r));
  const byYear = new Map<string, HyundaiVehicleTypeMixPoint>();
  for (const r of monthRows) {
    const y = periodYear(r.year_period);
    let p = byYear.get(y);
    if (!p) {
      p = emptyVehicleTypePoint(y, y);
      byYear.set(y, p);
    }
    const t = normalizeVehicleType(r.vehicle_type);
    p[t] += r.sales_units;
    p.total += r.sales_units;
  }
  return [...byYear.values()].sort((a, b) => (a.period < b.period ? -1 : 1));
}

// ============================================================
// Phase 2A — 지역별 수출 (export-by-region) + IR summary (9 region 연 합계)
// ============================================================

/** export-by-region 월별/연별 stacked bar 데이터 가공.
 *  같은 month/year + region_name 합산 → regions dict.
 *  연간 모드: 12월까지 완료된 연도는 그대로, 진행 중 연도(예: 2026 1~4월)는 'YYYY YTD' 라벨로 별도 표시. */
export function aggregateHyundaiExportRegions(
  rows: HyundaiExportRegionRow[],
  mode: 'month' | 'annual'
): HyundaiExportRegionPoint[] {
  const filtered = rows.filter((r) => r.source === 'export-by-region' && r.period_type === 'month');
  if (filtered.length === 0) return [];

  // 연간 모드: 각 연도가 12월까지 채워졌는지 판단 (가용 월 수 < 12 → YTD)
  const monthsByYear = new Map<string, Set<number>>();
  for (const r of filtered) {
    const y = periodYear(r.year_period);
    const m = parseInt(r.year_period.slice(-2), 10);
    if (!monthsByYear.has(y)) monthsByYear.set(y, new Set());
    monthsByYear.get(y)!.add(m);
  }

  const byPeriod = new Map<string, HyundaiExportRegionPoint>();
  for (const r of filtered) {
    let key: string;
    let label: string;
    let isYtd = false;
    if (mode === 'month') {
      key = r.year_period;
      label = formatPeriodLabel(key, 'month');
    } else {
      const y = periodYear(r.year_period);
      const monthCount = monthsByYear.get(y)?.size ?? 0;
      isYtd = monthCount < 12;
      key = isYtd ? `${y} YTD` : y;
      label = key;
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

/** IR summary 9 region 연 합계 → 연별 stacked bar (사이트 cross-check). */
export function aggregateHyundaiIRSummary(
  rows: HyundaiExportRegionRow[]
): HyundaiExportRegionPoint[] {
  const filtered = rows.filter((r) => r.source === 'ir-summary' && r.period_type === 'annual');
  const byYear = new Map<string, HyundaiExportRegionPoint>();
  for (const r of filtered) {
    let p = byYear.get(r.year_period);
    if (!p) {
      p = { period: r.year_period, period_label: r.year_period, regions: {}, total: 0 };
      byYear.set(r.year_period, p);
    }
    p.regions[r.region_name] = (p.regions[r.region_name] ?? 0) + r.sales_units;
    p.total += r.sales_units;
  }
  return [...byYear.values()].sort((a, b) => (a.period < b.period ? -1 : 1));
}

// ============================================================
// Phase 2B — 분기별 IR 실적 (hyundai_quarterly_earnings)
// ============================================================

/** opm 계산: 행의 operating_margin_pct가 있으면 그대로, 없으면 op/rev*100. 둘 다 NULL이면 null. */
function calcOpm(row: HyundaiQuarterlyEarningsRow): number | null {
  if (row.operating_margin_pct != null) return row.operating_margin_pct;
  if (row.operating_income_krw_bn != null && row.revenue_krw_bn != null && row.revenue_krw_bn > 0) {
    return (row.operating_income_krw_bn / row.revenue_krw_bn) * 100;
  }
  return null;
}

/** 분기별 IR 실적 → 차트 포인트 (fiscal_year, fiscal_quarter 오름차순 정렬).
 *  revenue(bar) + opm(line) 듀얼 축에 사용. */
export function aggregateHyundaiQuarterlyEarnings(
  rows: HyundaiQuarterlyEarningsRow[]
): HyundaiQuarterlyEarningsPoint[] {
  return rows
    .map((r) => ({
      period: `${r.fiscal_year}-Q${r.fiscal_quarter}`,
      period_label: `${String(r.fiscal_year).slice(2)}Q${r.fiscal_quarter}`,
      fiscal_year: r.fiscal_year,
      fiscal_quarter: r.fiscal_quarter,
      revenue_krw_bn: r.revenue_krw_bn,
      operating_margin_pct: calcOpm(r),
      operating_income_krw_bn: r.operating_income_krw_bn,
      global_wholesale_k_units: r.global_wholesale_k_units,
    }))
    .sort((a, b) => {
      if (a.fiscal_year !== b.fiscal_year) return a.fiscal_year - b.fiscal_year;
      return a.fiscal_quarter - b.fiscal_quarter;
    });
}

// ============================================================
// Phase 2C — 미국/유럽 소매 (hyundai_retail_sales)
// ============================================================

function retailYear(yearPeriod: string): string {
  return yearPeriod.slice(0, 4);
}

/** 한 region(US/EU)의 연도별 retail 합계 — month 행에서 'Total' vehicle_model만 합산 (월별 'Total' = 해당 월 retail 합).
 *  market_share/industry 행은 vehicle_model NOT IN ('Total','Industry','MarketShare') 필터로 제외.
 *  vehicle_model='Total'이 가장 신뢰 가능 (엑셀의 Total row 그대로). */
function annualRetailByYear(
  rows: HyundaiRetailSaleRow[],
  region: 'US' | 'EU'
): Map<string, number> {
  const byYear = new Map<string, number>();
  for (const r of rows) {
    if (r.region !== region) continue;
    if (r.period_type !== 'month') continue;
    if (r.vehicle_model !== 'Total') continue;
    if (r.retail_units == null) continue;
    const y = retailYear(r.year_period);
    byYear.set(y, (byYear.get(y) ?? 0) + r.retail_units);
  }
  return byYear;
}

/** 한 region(US/EU)의 연도별 retail의 (월별 retail, 보유 월 set) — YTD YoY 계산용. */
function annualRetailMonthsByYear(
  rows: HyundaiRetailSaleRow[],
  region: 'US' | 'EU'
): Map<string, { total: number; months: Set<string> }> {
  const byYear = new Map<string, { total: number; months: Set<string> }>();
  for (const r of rows) {
    if (r.region !== region) continue;
    if (r.period_type !== 'month') continue;
    if (r.vehicle_model !== 'Total') continue;
    if (r.retail_units == null || r.retail_units === 0) continue;
    const y = retailYear(r.year_period);
    const cur = byYear.get(y) ?? { total: 0, months: new Set<string>() };
    cur.total += r.retail_units;
    cur.months.add(r.year_period.slice(-2));
    byYear.set(y, cur);
  }
  return byYear;
}

/** ir-summary 연도별 wholesale 합계 — region_name(한국어)을 IR 사이트 발표 기준으로 매칭.
 *  US ← '북미' (현대 IR summary 9 region 중), EU ← '유럽'. */
function annualWholesaleByYear(
  irRows: HyundaiExportRegionRow[],
  region: 'US' | 'EU'
): Map<string, number> {
  const target = region === 'US' ? '북미' : '유럽';
  const byYear = new Map<string, number>();
  for (const r of irRows) {
    if (r.source !== 'ir-summary') continue;
    if (r.period_type !== 'annual') continue;
    if (r.region_name !== target) continue;
    byYear.set(r.year_period, (byYear.get(r.year_period) ?? 0) + r.sales_units);
  }
  return byYear;
}

/** 한 region(US/EU) 카드 한 장 — 비교 연도 직접 지정 또는 자동(가장 최근 retail+wholesale 모두 있는 연도).
 *  데이터 없으면 null 반환. */
function buildRetailWholesaleCard(
  retailRows: HyundaiRetailSaleRow[],
  irRows: HyundaiExportRegionRow[],
  region: 'US' | 'EU',
  yearFilter?: string
): HyundaiRetailWholesaleRegionCard | null {
  const retailByYear = annualRetailByYear(retailRows, region);
  const wholesaleByYear = annualWholesaleByYear(irRows, region);

  let targetYear: string;
  if (yearFilter) {
    // 명시 연도: retail 0이거나 wholesale 결측이어도 표시 (UI에서 0/— 처리).
    if (!retailByYear.has(yearFilter) && !wholesaleByYear.has(yearFilter)) return null;
    targetYear = yearFilter;
  } else {
    // 둘 다 있는 연도 중 가장 최근
    const candidateYears = [...retailByYear.keys()]
      .filter((y) => wholesaleByYear.has(y) && (retailByYear.get(y) ?? 0) > 0)
      .sort();
    if (candidateYears.length === 0) return null;
    targetYear = candidateYears[candidateYears.length - 1];
  }
  const prevYear = String(parseInt(targetYear, 10) - 1);

  const retailUnits = retailByYear.get(targetYear) ?? 0;
  const wholesaleUnits = wholesaleByYear.get(targetYear) ?? 0;
  const retailOverWholesalePct = wholesaleUnits > 0 ? (retailUnits / wholesaleUnits) * 100 : null;

  // YTD YoY 보정: targetYear가 YTD면 prev도 같은 월까지 합산해 비교 (사용자 요청 동일 기준).
  const monthsByYear = annualRetailMonthsByYear(retailRows, region);
  const targetMonths = monthsByYear.get(targetYear)?.months ?? new Set<string>();
  const isYtd = targetMonths.size > 0 && targetMonths.size < 12;
  let prevRetail: number;
  if (isYtd) {
    prevRetail = retailRows
      .filter((r) => r.region === region && r.period_type === 'month' && r.vehicle_model === 'Total')
      .filter((r) => retailYear(r.year_period) === prevYear)
      .filter((r) => targetMonths.has(r.year_period.slice(-2)))
      .reduce((sum, r) => sum + (r.retail_units ?? 0), 0);
  } else {
    prevRetail = retailByYear.get(prevYear) ?? 0;
  }
  const retailYoyPct =
    prevRetail < MIN_YOY_PREV_SALES ? null : ((retailUnits - prevRetail) / prevRetail) * 100;

  return {
    region,
    latestYear: targetYear,
    retailUnits,
    wholesaleUnits,
    retailOverWholesalePct,
    retailYoyPct,
    prevYear,
  };
}

/** US/EU retail vs wholesale 비교 — KPI 카드 2장. yearFilter 미지정 시 자동(최근). */
export function aggregateHyundaiRetailWholesale(
  retailRows: HyundaiRetailSaleRow[],
  irRows: HyundaiExportRegionRow[],
  yearFilter?: string
): HyundaiRetailWholesaleData {
  return {
    us: buildRetailWholesaleCard(retailRows, irRows, 'US', yearFilter),
    eu: buildRetailWholesaleCard(retailRows, irRows, 'EU', yearFilter),
  };
}

/** retail 모델별 TOP N → CompanyTopModelsResult 형식 (차종 TOP10 표 통일용).
 *  - selectedYear: 표시 기준 연도 (예: '2026' = YTD 모드, '2025' = 완료 모드).
 *  - 완료 모드: latestPeriod=selectedYear, prevPeriod=prevYear, ytd 0.
 *  - YTD 모드 (selectedYear가 진행 중): latestPeriod=lastCompletedYear(전년), prevPeriod=2년 전,
 *    ytd=selectedYear 합, ytdPrev=lastCompletedYear 동일 월 합, ytdYoyPct 계산. */
export function aggregateHyundaiRetailTopResult(
  rows: HyundaiRetailSaleRow[],
  region: 'US' | 'EU',
  selectedYear: string,
  topN = 10
): CompanyTopModelsResult {
  const months = rows.filter(
    (r) =>
      r.region === region &&
      r.period_type === 'month' &&
      !['Total', 'Industry', 'MarketShare'].includes(r.vehicle_model) &&
      r.retail_units != null
  );
  if (months.length === 0) {
    return { rows: [], totals: { latestPeriod: 0, prevPeriod: 0, ytd: 0 } };
  }
  // selectedYear의 실제 발생 월(retail_units>0)이 12개월 모두 있는지 판단.
  // DB에 미래 월을 retail_units=0으로 미리 적재해도 (Tucson 2026-05~12 등) YTD 모드 정확 판정.
  const selectedMonths = new Set(
    months
      .filter((r) => retailYear(r.year_period) === selectedYear && (r.retail_units ?? 0) > 0)
      .map((r) => r.year_period.slice(-2))
  );
  const isYtdMode = selectedMonths.size > 0 && selectedMonths.size < 12;
  const lastCompletedYear = isYtdMode
    ? String(parseInt(selectedYear, 10) - 1)
    : selectedYear;
  const prevYear = String(parseInt(lastCompletedYear, 10) - 1);

  type Agg = { latest: number; prev: number; ytd: number; ytdPrev: number };
  const byModel = new Map<string, Agg>();
  let totLatest = 0;
  let totPrev = 0;
  let totYtd = 0;
  let totYtdPrev = 0;
  for (const r of months) {
    const y = retailYear(r.year_period);
    const mm = r.year_period.slice(-2);
    const v = r.retail_units ?? 0;
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
      if (y === selectedYear) {
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
  // 정렬: YTD 모드면 YTD 큰 순, 아니면 latestPeriod 큰 순
  const sortKey = (r: CompanyTopModelRow) => (isYtdMode ? r.ytdSales : r.salesLatestPeriod);
  items.sort((a, b) => sortKey(b) - sortKey(a));

  return {
    rows: items.slice(0, topN),
    totals: { latestPeriod: totLatest, prevPeriod: totPrev, ytd: totYtd, ytdPrev: totYtdPrev },
  };
}

/** 한 region(US/EU)의 retail 데이터에 등장하는 연도 목록 (오름차순) — UI 드롭다운용 (#9). */
export function listRetailYears(rows: HyundaiRetailSaleRow[], region: 'US' | 'EU'): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    if (r.region !== region) continue;
    if (r.period_type !== 'month') continue;
    set.add(retailYear(r.year_period));
  }
  return [...set].sort();
}

/** US 시장 점유율 시계열 (월별).
 *  market_share row: vehicle_model='MarketShare' AND region='US' → market_share(0~1).
 *  industry_total row: vehicle_model='Industry' AND region='US' → industry_total.
 *  같은 year_period에 두 row가 따로 있음 → 합쳐서 한 point. */
export function aggregateHyundaiUsMarketShare(
  rows: HyundaiRetailSaleRow[]
): HyundaiMarketSharePoint[] {
  const usMonth = rows.filter((r) => r.region === 'US' && r.period_type === 'month');
  const byPeriod = new Map<string, HyundaiMarketSharePoint>();

  function ensure(period: string): HyundaiMarketSharePoint {
    let p = byPeriod.get(period);
    if (!p) {
      p = {
        period,
        period_label: formatPeriodLabel(period, 'month'),
        market_share_pct: null,
        industry_total: null,
        hmc_retail: null,
      };
      byPeriod.set(period, p);
    }
    return p;
  }

  for (const r of usMonth) {
    if (r.vehicle_model === 'MarketShare') {
      if (r.market_share != null) {
        ensure(r.year_period).market_share_pct = r.market_share * 100;
      }
    } else if (r.vehicle_model === 'Industry') {
      if (r.industry_total != null) {
        ensure(r.year_period).industry_total = r.industry_total;
      }
    } else if (r.vehicle_model === 'Total') {
      if (r.retail_units != null) {
        ensure(r.year_period).hmc_retail = r.retail_units;
      }
    }
  }

  const sorted = [...byPeriod.values()].sort((a, b) => (a.period < b.period ? -1 : 1));
  // 마지막 non-zero/non-null 월까지로 trim (사용자 요청: 2026-04까지만 표시).
  let lastIdx = -1;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const v = sorted[i];
    if ((v.hmc_retail ?? 0) > 0 || (v.market_share_pct ?? 0) > 0 || (v.industry_total ?? 0) > 0) {
      lastIdx = i;
      break;
    }
  }
  return lastIdx >= 0 ? sorted.slice(0, lastIdx + 1) : sorted;
}

/** 미국 retail 차종 TOP10 — Total/Industry/MarketShare 제외, 최근 완료 연도 기준 (EU와 동일 패턴).
 *  yearFilter 지정 시 해당 연도 기준 (#9 연도 드롭다운).
 *  hyundai_retail_sales WHERE region='US' AND vehicle_model NOT IN ('Total','Industry','MarketShare'). */
export function aggregateHyundaiUsRetailTopModels(
  rows: HyundaiRetailSaleRow[],
  yearFilter?: string
): HyundaiEuRetailTopModel[] {
  const usMonth = rows.filter((r) => r.region === 'US' && r.period_type === 'month');
  const periods = [...new Set(usMonth.map((r) => r.year_period))].sort();
  if (periods.length === 0) return [];

  let targetYear: string;
  if (yearFilter) {
    targetYear = yearFilter;
  } else {
    const years = [...new Set(periods.map(periodYear))].sort();
    const latestYear = years[years.length - 1];
    const latestMonths = periods
      .filter((p) => periodYear(p) === latestYear)
      .map((p) => parseInt(p.slice(-2), 10));
    const isComplete = latestMonths.includes(12);
    targetYear = isComplete ? latestYear : String(parseInt(latestYear, 10) - 1);
  }
  const prevYear = String(parseInt(targetYear, 10) - 1);

  const sumByModel = (year: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of usMonth) {
      if (periodYear(r.year_period) !== year) continue;
      if (
        r.vehicle_model === 'Total' ||
        r.vehicle_model === 'Industry' ||
        r.vehicle_model === 'MarketShare'
      ) {
        continue;
      }
      if (r.retail_units == null) continue;
      m.set(r.vehicle_model, (m.get(r.vehicle_model) ?? 0) + r.retail_units);
    }
    return m;
  };

  const latestByModel = sumByModel(targetYear);
  const prevByModel = sumByModel(prevYear);

  return [...latestByModel.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([model, retailLatest]) => {
      const retailPrev = prevByModel.get(model) ?? 0;
      const yoyPct =
        retailPrev < MIN_YOY_PREV_SALES ? null : ((retailLatest - retailPrev) / retailPrev) * 100;
      return { model, retailLatest, retailPrev, yoyPct };
    });
}

/** US retail TOP 차종 + 라벨 (HyundaiEuRetailData와 동일 형식).
 *  yearFilter 지정 시 해당 연도, 미지정 시 최근 완료 연도. */
export function aggregateHyundaiUsRetail(
  rows: HyundaiRetailSaleRow[],
  yearFilter?: string
): HyundaiEuRetailData {
  const usMonth = rows.filter((r) => r.region === 'US' && r.period_type === 'month');
  const periods = [...new Set(usMonth.map((r) => r.year_period))].sort();
  if (periods.length === 0) {
    return { monthlySeries: [], topModels: [], latestYearLabel: '', prevYearLabel: '' };
  }
  let targetYear: string;
  if (yearFilter) {
    targetYear = yearFilter;
  } else {
    const years = [...new Set(periods.map(periodYear))].sort();
    const latestYear = years[years.length - 1];
    const latestMonths = periods
      .filter((p) => periodYear(p) === latestYear)
      .map((p) => parseInt(p.slice(-2), 10));
    const isComplete = latestMonths.includes(12);
    targetYear = isComplete ? latestYear : String(parseInt(latestYear, 10) - 1);
  }
  const prevYear = String(parseInt(targetYear, 10) - 1);

  return {
    monthlySeries: [], // 별도 차트가 점유율 라인 담당 — 시계열 중복 표시 X
    topModels: aggregateHyundaiUsRetailTopModels(rows, yearFilter),
    latestYearLabel: targetYear,
    prevYearLabel: prevYear,
  };
}

/** 사이트 IR summary 연 합 vs 우리 hyundai_sales 회사 전체 합 cross-check 요약.
 *  HyundaiIRComparisonCard 삭제(2026-05-26) — 9-region 차트 footer에 직렬화. */
export function summarizeIRComparison(
  irRows: HyundaiExportRegionRow[],
  dbAnnualSeries: CompanyTimeSeriesPoint[]
): HyundaiIRComparisonSummary {
  const irByYear = new Map<string, number>();
  for (const r of irRows) {
    if (r.source !== 'ir-summary') continue;
    irByYear.set(r.year_period, (irByYear.get(r.year_period) ?? 0) + r.sales_units);
  }
  const dbByYear = new Map(dbAnnualSeries.map((p) => [p.period, p.sales]));
  const allYears = [...new Set([...irByYear.keys(), ...dbByYear.keys()])].sort();
  const rows = allYears.map((year) => {
    const ir = irByYear.get(year) ?? 0;
    const db = dbByYear.get(year) ?? 0;
    const diff = ir - db;
    const pct = ir > 0 ? (diff / ir) * 100 : null;
    return { year, ir_total: ir, db_total: db, diff, pct };
  });
  // 최근 비교 연도 = IR+DB 둘 다 0 이상인 연도 중 가장 큰 연도
  const bothPresent = rows.filter((r) => r.ir_total > 0 && r.db_total > 0);
  const latest = bothPresent.length > 0 ? bothPresent[bothPresent.length - 1] : null;
  return {
    latestYear: latest?.year ?? null,
    latestIrTotal: latest?.ir_total ?? 0,
    latestDbTotal: latest?.db_total ?? 0,
    latestDiff: latest?.diff ?? 0,
    latestDiffPct: latest?.pct ?? null,
    rows,
  };
}

// ============================================================
// Phase 2D — 연간 IR 실적 (분기 합산 + 가중평균 opm)
// ============================================================

/** 분기 데이터를 연단위로 합산. NULL 분기는 합산에서 제외. opm = 가중평균 (영업이익 합 / 매출 합).
 *  진행 중 연도(4 분기 미달)는 'YYYY YTD' 라벨로 별도. */
export function aggregateHyundaiAnnualEarnings(
  rows: HyundaiQuarterlyEarningsRow[]
): HyundaiAnnualEarningsPoint[] {
  const byYear = new Map<
    number,
    {
      revenueSum: number;
      revenueHasValue: boolean;
      opIncomeSum: number;
      opIncomeHasValue: boolean;
      wholesaleSum: number;
      wholesaleHasValue: boolean;
      quarters: Set<number>;
    }
  >();

  for (const r of rows) {
    let entry = byYear.get(r.fiscal_year);
    if (!entry) {
      entry = {
        revenueSum: 0,
        revenueHasValue: false,
        opIncomeSum: 0,
        opIncomeHasValue: false,
        wholesaleSum: 0,
        wholesaleHasValue: false,
        quarters: new Set(),
      };
      byYear.set(r.fiscal_year, entry);
    }
    entry.quarters.add(r.fiscal_quarter);
    if (r.revenue_krw_bn != null) {
      entry.revenueSum += r.revenue_krw_bn;
      entry.revenueHasValue = true;
    }
    if (r.operating_income_krw_bn != null) {
      entry.opIncomeSum += r.operating_income_krw_bn;
      entry.opIncomeHasValue = true;
    }
    if (r.global_wholesale_k_units != null) {
      entry.wholesaleSum += r.global_wholesale_k_units;
      entry.wholesaleHasValue = true;
    }
  }

  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, e]) => {
      const isYtd = e.quarters.size < 4;
      const periodKey = isYtd ? `${year} YTD` : String(year);
      const opm =
        e.revenueHasValue && e.opIncomeHasValue && e.revenueSum > 0
          ? (e.opIncomeSum / e.revenueSum) * 100
          : null;
      return {
        period: periodKey,
        period_label: periodKey,
        fiscal_year: year,
        revenue_krw_bn: e.revenueHasValue ? e.revenueSum : null,
        operating_margin_pct: opm,
        operating_income_krw_bn: e.opIncomeHasValue ? e.opIncomeSum : null,
        global_wholesale_k_units: e.wholesaleHasValue ? e.wholesaleSum : null,
        quarters_used: e.quarters.size,
        is_ytd: isYtd,
      };
    });
}

// ============================================================
// 공장별 차종 mix — 모든 해외 공장, 연도 선택 가능 (사용자 요청 #9).
// 기존 주요 5개 공장 한정 → 전체 해외 공장. 데이터 없는 공장은 자동 제외.
// ============================================================

/** 해외 공장 코드 → 위치(국가/도시) 매핑. 차트 X축 라벨에 사용.
 *  출처: hyundai.com IR 공시 + 공식 사이트 (2026-05 기준). */
export const HYUNDAI_FACTORY_LOCATIONS: Record<string, string> = {
  HMI: '인도 첸나이',
  HMMA: '미국 앨라배마',
  HMGMA: '미국 조지아',
  BHMC: '중국 베이징',
  HMMC: '체코 노쇼비체',
  HMB: '브라질 피라시카바',
  HMMR: '러시아 상트페테르부르크',
  HMMI: '인도네시아 카라왕',
  HAOS: '터키 이즈미트',
  HTBC: '중국 쓰촨 (상용)',
  KMX: '멕시코',
  Vietnam: '베트남 (Thanh Cong)',
  Russia: '러시아',
  Singapore: '싱가포르 (HMGICS)',
  Others: '기타',
  CKD: 'CKD (현지 조립)',
};

/** 데이터에 등장하는 연도 목록 (오름차순). 모든 연도 + 'YTD'는 진행 중 연도. */
export function listFactoryModelMixYears(
  rows: (CompanySaleRowWithPt & { factory: string })[]
): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    if (r.period_type !== 'month' || r.factory === '') continue;
    set.add(periodYear(r.year_period));
  }
  return [...set].sort();
}

/** 공장별 × 차종 mix (선택 연도). 각 공장 카드 1장 — TOP N 차종 + Others.
 *  yearFilter 미지정 시 가장 최근 완료 연도 사용.
 *  data 없는 공장은 자동 제외. */
export function aggregateHyundaiFactoryModelMix(
  rows: (CompanySaleRowWithPt & { factory: string })[],
  topModelN = 6,
  yearFilter?: string
): FactoryModelMixPoint[] {
  const allMonth = rows.filter((r) => r.period_type === 'month' && isCountable(r));
  if (allMonth.length === 0) return [];
  const periods = [...new Set(allMonth.map((r) => r.year_period))].sort();
  const latestPeriod = periods[periods.length - 1];
  const latestYear = parseInt(periodYear(latestPeriod), 10);
  const isComplete = parseInt(latestPeriod.slice(-2), 10) === 12;
  const targetYear = yearFilter ?? String(isComplete ? latestYear : latestYear - 1);

  // 해외 공장 전체 + 선택 연도
  const filtered = allMonth.filter(
    (r) => r.factory !== '' && periodYear(r.year_period) === targetYear
  );

  // factory → model → units
  const byFactory = new Map<string, Map<string, number>>();
  for (const r of filtered) {
    if (!byFactory.has(r.factory)) byFactory.set(r.factory, new Map());
    const inner = byFactory.get(r.factory)!;
    inner.set(r.vehicle_model, (inner.get(r.vehicle_model) ?? 0) + r.sales_units);
  }

  // 각 공장의 합계 큰 모델 TOP N + Others. 공장 자체는 합계 큰 순으로 정렬.
  return [...byFactory.entries()]
    .map(([code, modelMap]) => {
      const sorted = [...modelMap.entries()].sort((a, b) => b[1] - a[1]);
      const top = sorted.slice(0, topModelN);
      const others = sorted.slice(topModelN);
      const models: Record<string, number> = {};
      for (const [m, v] of top) models[m] = v;
      const othersSum = others.reduce((a, [, v]) => a + v, 0);
      if (othersSum > 0) models['Others'] = othersSum;
      const total = sorted.reduce((a, [, v]) => a + v, 0);
      const location = HYUNDAI_FACTORY_LOCATIONS[code] ?? '';
      return { factory: code, factoryLocation: location, models, total };
    })
    .filter((p) => p.total > 0)
    .sort((a, b) => b.total - a.total);
}

// ============================================================
// Phase 2C — 유럽(EU) retail 시계열 + 차종 TOP (US와 위상 동일)
// ============================================================

/** EU 월별 Total retail 추이 + YoY%. industry/market_share 없음 → 점유율 차트 불가.
 *  yearFilter 지정 시 해당 연도 기준 TOP10 (#9). 시계열은 항상 전체. */
export function aggregateHyundaiEuRetail(
  rows: HyundaiRetailSaleRow[],
  yearFilter?: string
): HyundaiEuRetailData {
  const euMonth = rows.filter((r) => r.region === 'EU' && r.period_type === 'month');

  // 월별 Total = vehicle_model='Total' AND retail_units != null
  const totalByPeriod = new Map<string, number>();
  for (const r of euMonth) {
    if (r.vehicle_model !== 'Total') continue;
    if (r.retail_units == null) continue;
    totalByPeriod.set(r.year_period, (totalByPeriod.get(r.year_period) ?? 0) + r.retail_units);
  }
  const sortedPeriods = [...totalByPeriod.keys()].sort();
  // 마지막 non-zero 월까지로 trim — collect 스크립트가 미발표 월에 0을 적재해
  // X축에 빈 막대(2026-05~12)가 나오는 문제 방지 (사용자 요청: 2026-04까지만 표시).
  let lastNonZeroIdx = -1;
  for (let i = sortedPeriods.length - 1; i >= 0; i--) {
    if ((totalByPeriod.get(sortedPeriods[i]) ?? 0) > 0) {
      lastNonZeroIdx = i;
      break;
    }
  }
  const periods = lastNonZeroIdx >= 0 ? sortedPeriods.slice(0, lastNonZeroIdx + 1) : sortedPeriods;
  const monthlySeries: HyundaiEuRetailPoint[] = periods.map((p) => {
    const cur = totalByPeriod.get(p) ?? 0;
    const prevP = shiftPeriodByYear(p, -1);
    const prev = totalByPeriod.get(prevP) ?? 0;
    const yoy = prev < MIN_YOY_PREV_SALES ? null : ((cur - prev) / prev) * 100;
    return {
      period: p,
      period_label: formatPeriodLabel(p, 'month'),
      retail_units: cur,
      yoy_pct: yoy,
    };
  });

  // 차종 TOP — yearFilter 우선, 없으면 최근 완료 연도 (model NOT IN Total/Industry/MarketShare)
  const years = [...new Set(periods.map(periodYear))].sort();
  if (years.length === 0) {
    return { monthlySeries, topModels: [], latestYearLabel: '', prevYearLabel: '' };
  }
  let targetYear: string;
  if (yearFilter) {
    targetYear = yearFilter;
  } else {
    const latestYear = years[years.length - 1];
    const latestMonthsForYear = periods
      .filter((p) => periodYear(p) === latestYear)
      .map((p) => parseInt(p.slice(-2), 10));
    const isComplete = latestMonthsForYear.includes(12);
    targetYear = isComplete ? latestYear : String(parseInt(latestYear, 10) - 1);
  }
  const prevYear = String(parseInt(targetYear, 10) - 1);

  const sumByModel = (year: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of euMonth) {
      if (periodYear(r.year_period) !== year) continue;
      if (
        r.vehicle_model === 'Total' ||
        r.vehicle_model === 'Industry' ||
        r.vehicle_model === 'MarketShare'
      ) {
        continue;
      }
      if (r.retail_units == null) continue;
      m.set(r.vehicle_model, (m.get(r.vehicle_model) ?? 0) + r.retail_units);
    }
    return m;
  };

  const latestByModel = sumByModel(targetYear);
  const prevByModel = sumByModel(prevYear);

  const topModels: HyundaiEuRetailTopModel[] = [...latestByModel.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([model, retailLatest]) => {
      const retailPrev = prevByModel.get(model) ?? 0;
      const yoyPct =
        retailPrev < MIN_YOY_PREV_SALES ? null : ((retailLatest - retailPrev) / retailPrev) * 100;
      return { model, retailLatest, retailPrev, yoyPct };
    });

  return {
    monthlySeries,
    topModels,
    latestYearLabel: targetYear,
    prevYearLabel: prevYear,
  };
}

// ============================================================
// Phase 2E — 분기별 IR region 도매 (source='ir-quarterly')
// ============================================================

/** 'YYYY-QN' (예: '2025-Q3') → 'YYQN' (예: '25Q3'). */
function formatQuarterLabel(period: string): string {
  // 'YYYY-QN' 가정. 형식 어긋나면 그대로 반환.
  const [y, q] = period.split('-');
  if (!y || !q || y.length !== 4) return period;
  return `${y.slice(2)}${q}`;
}

/** 분기별 IR region 도매 stacked bar 데이터 (천대).
 *  source='ir-quarterly' AND period_type='quarter' 필터 → period(YYYY-QN) 그룹 →
 *  region을 컬럼으로 펼침. 단위는 sales_units / 1000 (DB는 대 단위 저장, UI 표시 천대).
 *  year_period 오름차순 정렬. 누락 region은 키 없음(recharts가 빈 stack으로 처리). */
export function aggregateHyundaiQuarterlyRegions(
  rows: HyundaiExportRegionRow[]
): HyundaiQuarterlyRegionPoint[] {
  const filtered = rows.filter((r) => r.source === 'ir-quarterly' && r.period_type === 'quarter');
  if (filtered.length === 0) return [];

  const byPeriod = new Map<string, HyundaiQuarterlyRegionPoint>();
  for (const r of filtered) {
    let p = byPeriod.get(r.year_period);
    if (!p) {
      p = {
        period: r.year_period,
        period_label: formatQuarterLabel(r.year_period),
        total: 0,
        regions: {},
      };
      byPeriod.set(r.year_period, p);
    }
    const kUnits = r.sales_units / 1000;
    p.regions[r.region_name] = (p.regions[r.region_name] ?? 0) + kUnits;
    p.total += kUnits;
  }
  return [...byPeriod.values()].sort((a, b) => (a.period < b.period ? -1 : 1));
}
