/**
 * 우즈베키스탄 자동차 시장 — fetch + 'use cache' + aggregate 오케스트레이션.
 * 데이터: uzbekistan_auto_stats (kind=sales|production, source_type=uzavtosanoat|stat-uz).
 */
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import logger from '@/lib/logger';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';

const SUPABASE_PAGE_SIZE = 1000;

export interface UzbekistanRow {
  kind: 'sales' | 'production';
  period_type: 'month' | 'quarter' | 'year' | 'ytd';
  year_period: string;
  company: string;
  brand: string;
  vehicle_model: string;
  units: number;
  source_type: 'uzavtosanoat' | 'stat-uz';
  source_url: string | null;
  publish_date: string | null;
}

export interface UzbekistanCompanyMonthlyPoint {
  period: string;
  period_label: string;
  companies: Record<string, number>;
  total: number;
  is_ytd?: boolean;
  /** 전년 동기 회사별 값(연간 토글의 YoY 라인용 — 토글 연동되도록 회사별 보관). */
  prev?: Record<string, number>;
}

export interface UzbekistanProductionYearPoint {
  period: string;
  period_label: string;
  brands: Record<string, number>;
  total: number;
  /** 전년 동기 시리즈별 값(만년=전년 만년, YTD=전년 같은 기간). YoY 라인이 토글에 연동되도록 시리즈별로 보관. */
  prev?: Record<string, number>;
}

/** brand별 시계열 한 점 — line chart용. */
export interface UzbekistanBrandSeriesPoint {
  period: string;
  period_label: string;
  units: number;
  yoy_pct: number | null;
}

/** 100% stacked share (production by brand). */
export interface UzbekistanShareRow {
  period: string;
  period_label: string;
  /** 각 brand의 비중 (%, 0~100). */
  shares: Record<string, number>;
  total: number;
}

/** 차종(모델)별 연도별 생산량 표 — 연도 컬럼(만년 또는 1~N월 누계) + 최신연도 YTD + YoY. */
export interface UzbekistanModelYearTable {
  columns: { year: string; label: string; isYtd: boolean }[];
  rows: { model: string; cells: Record<string, number | null>; yoyPct: number | null }[];
  /** 전 모델 합계 행 (각 연도 컬럼 합 + 동기 YoY). */
  totals: { cells: Record<string, number | null>; yoyPct: number | null };
}

/** 차종별 연간 생산량 — 연도 선택 + 전년 동기 비교(드롭다운 차트)용. */
export interface UzbekistanModelCompareYear {
  year: string;
  /** 0 = 만년(full), >0 = YTD 마지막 월(예: 3 → 1~3월). */
  ytdMonth: number;
  prevYear: string;
  /** 전년 동기 비교 데이터가 있는지(없으면 당해만 표시). */
  hasPrev: boolean;
}

export interface UzbekistanModelYearCompare {
  /** 선택 가능 연도(오름차순). */
  years: UzbekistanModelCompareYear[];
  /** year → 모델별 {당해, 전년 동기}. 모델은 당해 내림차순. */
  byYear: Record<string, { model: string; current: number; prev: number | null }[]>;
}

/** production KPI — 누적. */
export interface UzbekistanProductionKpi {
  chevroletLatest: number;
  chevroletLatestLabel: string;
  chevroletPrev: number;
  chevroletYoy: number | null;
  bydLatest: number;
  bydLatestLabel: string;
  carTotalLatest: number; // Chevrolet + BYD
}

export interface UzbekistanKpi {
  totalLatestYear: number;
  latestYearLabel: string;
  totalPrevYear: number;
  prevYearLabel: string;
  yoyPct: number | null;
  ytdLatest: number;
  ytdLabel: string;
  ytdPrev: number;
  ytdYoyPct: number | null;
}

export interface UzbekistanPageData {
  kpi: UzbekistanKpi;
  monthlyByCompany: UzbekistanCompanyMonthlyPoint[];
  annualByCompany: UzbekistanCompanyMonthlyPoint[];
  /** 연간 생산 (stat-uz 차종 → 브랜드 집계, 연도별 stacked). */
  productionByBrandYear: UzbekistanProductionYearPoint[];
  /** 연간 생산 (stat-uz 차종 → 회사 집계, 연도별 stacked). */
  productionByCompanyYear: UzbekistanProductionYearPoint[];
  /** 차종(모델)별 연도별 생산량 표 (연도 컬럼 + 최신 YTD + YoY). */
  productionModelYearTable: UzbekistanModelYearTable;
  /** 차종별 연간 생산량 — 연도 선택 + 전년 동기 비교(드롭다운 차트). */
  productionModelCompare: UzbekistanModelYearCompare;
  /** production KPI (Chevrolet/BYD/Engines + YoY). */
  productionKpi: UzbekistanProductionKpi;
  /** Chevrolet production 10년 시계열 (2016~2025). */
  chevroletSeries: UzbekistanBrandSeriesPoint[];
  /** 시장점유율 (생산 기준) — 브랜드 100% stacked. */
  productionShareByBrand: UzbekistanShareRow[];
  /** 시장점유율 (생산 기준) — 회사 100% stacked. */
  productionShareByCompany: UzbekistanShareRow[];
  /** 회사별 sales share 100% stacked (annual). */
  companySalesShare: UzbekistanShareRow[];
  /** 판매 share — 회사를 브랜드로 묶은 100% stacked (annual). 브랜드 토글용. */
  salesShareByBrand: UzbekistanShareRow[];
  totalRows: number;
  lastCollectedAt: string | null;
  companies: string[];
}

type AnonClient = ReturnType<typeof createSupabaseAnonClient>;

async function fetchAll(supabase: AnonClient): Promise<UzbekistanRow[]> {
  const all: UzbekistanRow[] = [];
  let from = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = supabase as unknown as { from: (t: string) => any };
  while (true) {
    const { data, error } = await client
      .from('uzbekistan_auto_stats')
      .select(
        'kind,period_type,year_period,company,brand,vehicle_model,units,source_type,source_url,publish_date,collected_at'
      )
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) {
      logger.error({ err: error }, 'uzbekistan_auto_stats 조회 실패');
      return [];
    }
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as UzbekistanRow[]));
    if (data.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return all;
}

function periodYear(p: string): string {
  return p.slice(0, 4);
}

/** sales 월 데이터로 연도별 보유 월 집합 (부분연도 YTD 판정용). */
function salesMonthsByYear(rows: UzbekistanRow[]): Map<string, Set<number>> {
  const m = new Map<string, Set<number>>();
  for (const r of rows) {
    if (r.kind !== 'sales' || r.period_type !== 'month' || r.source_type !== 'uzavtosanoat')
      continue;
    const y = periodYear(r.year_period);
    if (!m.has(y)) m.set(y, new Set());
    m.get(y)!.add(parseInt(r.year_period.slice(-2), 10));
  }
  return m;
}

/** 부분연도(12개월 미만)면 'YYYY (1~N월, YTD)' 라벨 + is_ytd, 아니면 'YYYY'. */
function annualYtdLabel(
  year: string,
  monthsByYear: Map<string, Set<number>>
): { label: string; isYtd: boolean } {
  const ms = monthsByYear.get(year);
  if (ms && ms.size > 0 && ms.size < 12) {
    return { label: `${year} (1~${Math.max(...ms)}월, YTD)`, isYtd: true };
  }
  return { label: year, isYtd: false };
}

function aggregateMonthlyByCompany(rows: UzbekistanRow[]): UzbekistanCompanyMonthlyPoint[] {
  const months = rows.filter(
    (r) => r.kind === 'sales' && r.period_type === 'month' && r.source_type === 'uzavtosanoat'
  );
  const byPeriod = new Map<string, UzbekistanCompanyMonthlyPoint>();
  for (const r of months) {
    let p = byPeriod.get(r.year_period);
    if (!p) {
      const [y, m] = r.year_period.split('-');
      p = {
        period: r.year_period,
        period_label: `${y.slice(2)}.${m}`,
        companies: {},
        total: 0,
      };
      byPeriod.set(r.year_period, p);
    }
    p.companies[r.company] = (p.companies[r.company] ?? 0) + r.units;
    p.total += r.units;
  }
  return [...byPeriod.values()].sort((a, b) => (a.period < b.period ? -1 : 1));
}

function aggregateAnnualByCompany(rows: UzbekistanRow[]): UzbekistanCompanyMonthlyPoint[] {
  // year row 우선 사용 (YTD 최신). 없으면 month 합산.
  const yearRows = rows.filter(
    (r) => r.kind === 'sales' && r.period_type === 'year' && r.source_type === 'uzavtosanoat'
  );
  if (yearRows.length === 0) {
    // fallback: month 합산
    const months = rows.filter(
      (r) => r.kind === 'sales' && r.period_type === 'month' && r.source_type === 'uzavtosanoat'
    );
    const byYear = new Map<string, UzbekistanCompanyMonthlyPoint>();
    const monthsByYear = new Map<string, Set<number>>();
    for (const r of months) {
      const y = periodYear(r.year_period);
      const mm = parseInt(r.year_period.slice(-2), 10);
      if (!monthsByYear.has(y)) monthsByYear.set(y, new Set());
      monthsByYear.get(y)!.add(mm);
      let p = byYear.get(y);
      if (!p) {
        p = { period: y, period_label: y, companies: {}, total: 0 };
        byYear.set(y, p);
      }
      p.companies[r.company] = (p.companies[r.company] ?? 0) + r.units;
      p.total += r.units;
    }
    // YTD 라벨
    const currentYear = new Date().getFullYear();
    for (const [y, p] of byYear) {
      const ms = monthsByYear.get(y)?.size ?? 0;
      const yNum = parseInt(y, 10);
      if (ms < 12) {
        if (yNum === currentYear) {
          p.period_label = `${y} YTD`;
          p.is_ytd = true;
        } else {
          p.period_label = `${y}.${String(Math.max(...(monthsByYear.get(y) ?? new Set()))).padStart(2, '0')}`;
        }
      }
    }
    return [...byYear.values()].sort((a, b) => (a.period < b.period ? -1 : 1));
  }
  // year row 사용
  const monthsByYear = salesMonthsByYear(rows);
  const byYear = new Map<string, UzbekistanCompanyMonthlyPoint>();
  for (const r of yearRows) {
    let p = byYear.get(r.year_period);
    if (!p) {
      const { label, isYtd } = annualYtdLabel(r.year_period, monthsByYear);
      p = { period: r.year_period, period_label: label, companies: {}, total: 0, is_ytd: isYtd };
      byYear.set(r.year_period, p);
    }
    p.companies[r.company] = (p.companies[r.company] ?? 0) + r.units;
    p.total += r.units;
  }

  // 전년 동기(YoY): 각 연도의 보유 월을 전년에서 같은 월로 합산(회사별). 토글 연동되도록 회사별 보관.
  const salesMonthSum = new Map<string, Map<string, number[]>>(); // company → year → [1..12]
  for (const r of rows) {
    if (r.kind !== 'sales' || r.period_type !== 'month' || r.source_type !== 'uzavtosanoat')
      continue;
    const y = periodYear(r.year_period);
    const mm = parseInt(r.year_period.slice(-2), 10);
    if (!salesMonthSum.has(r.company)) salesMonthSum.set(r.company, new Map());
    const ym = salesMonthSum.get(r.company)!;
    if (!ym.has(y)) ym.set(y, new Array(13).fill(0));
    ym.get(y)![mm] += r.units;
  }
  for (const [y, p] of byYear) {
    const ms = monthsByYear.get(y);
    if (!ms || ms.size === 0) continue;
    const prevYear = String(parseInt(y, 10) - 1);
    const prevMs = monthsByYear.get(prevYear);
    // 동기 비교는 전년이 당해의 모든 월을 보유할 때만(예: 2024 12월 누락 → 2025 YoY 생략).
    if (!prevMs || ![...ms].every((m) => prevMs.has(m))) continue;
    const prevObj: Record<string, number> = {};
    let hasPrev = false;
    for (const [company, ym] of salesMonthSum) {
      const arr = ym.get(prevYear);
      if (!arr) continue;
      let s = 0;
      for (const mm of ms) s += arr[mm] ?? 0;
      if (s > 0) {
        prevObj[company] = s;
        hasPrev = true;
      }
    }
    if (hasPrev) p.prev = prevObj;
  }

  return [...byYear.values()].sort((a, b) => (a.period < b.period ? -1 : 1));
}

/**
 * 차종(브랜드/모델) → 생산 회사 매핑 (사용자 확정, 2026-06-02).
 * - Chevrolet의 Damas/Labo는 Khorezm Auto, 그 외 Chevrolet 모델은 UzAuto Motors.
 * - BYD → BYD Uzbekistan Factory, KIA·Chery·Haval → ADM Jizzakh.
 * - 매핑에 없는 LADA·Tank 등은 '기타'.
 */
function companyOf(brand: string, vehicleModel: string): string {
  if (brand === 'Chevrolet')
    return vehicleModel === 'Damas/Labo' ? 'Khorezm Auto' : 'UzAuto Motors';
  if (brand === 'BYD') return 'BYD Uzbekistan Factory';
  if (brand === 'KIA' || brand === 'Chery' || brand === 'Haval') return 'ADM Jizzakh';
  return '기타';
}

/**
 * 판매(uzavtosanoat 회사별) → 브랜드 매핑. 생산 companyOf(2026-06-02 확정)와 정합되게 역방향.
 * 판매 데이터는 회사 단위라 brand 컬럼이 비어 있어, 회사를 브랜드 그룹으로 묶어 브랜드 차원을 만든다.
 * - UzAuto Motors·Khorezm Auto → Chevrolet
 * - BYD Uzbekistan Factory → BYD
 * - ADM Jizzakh → KIA/Chery/Haval (회사 합산이라 3개 브랜드 분해 불가 — 묶음 표기)
 * - 그 외(SamAuto·Asaka Motors·Alyans Auto·Jizzakh Auto)는 생산 매핑에 없어 회사명 유지.
 */
function brandOfSalesCompany(company: string): string {
  if (company === 'UzAuto Motors' || company === 'Khorezm Auto') return 'Chevrolet';
  if (company === 'BYD Uzbekistan Factory') return 'BYD';
  if (company === 'ADM Jizzakh') return 'KIA/Chery/Haval';
  return company;
}

/**
 * 연간 생산 — stat-uz 차종(period_type='year') 데이터를 브랜드 또는 회사 차원으로 연도별 집계.
 * dimension='brand' → 브랜드(Chevrolet/BYD/Chery/Haval/KIA/LADA/Tank).
 * dimension='company' → companyOf() 매핑(UzAuto Motors/Khorezm Auto/ADM Jizzakh/BYD .../기타).
 */
function aggregateModelProductionByYear(
  rows: UzbekistanRow[],
  dimension: 'brand' | 'company'
): UzbekistanProductionYearPoint[] {
  const keyOf = (r: UzbekistanRow) =>
    dimension === 'brand' ? r.brand : companyOf(r.brand, r.vehicle_model);
  const annual = rows.filter(
    (r) => r.kind === 'production' && r.period_type === 'year' && r.source_type === 'stat-uz'
  );
  const monthsAll = rows.filter(
    (r) => r.kind === 'production' && r.period_type === 'month' && r.source_type === 'stat-uz'
  );
  const annualYears = new Set(annual.map((r) => r.year_period));

  // 만년 값 (year → key → units)
  const annualByKey = new Map<string, Map<string, number>>();
  for (const r of annual) {
    const k = keyOf(r);
    if (!annualByKey.has(r.year_period)) annualByKey.set(r.year_period, new Map());
    const m = annualByKey.get(r.year_period)!;
    m.set(k, (m.get(k) ?? 0) + r.units);
  }
  // 월별 (year → key → [1..12])
  const monthSum = new Map<string, Map<string, number[]>>();
  const maxMonthByYear = new Map<string, number>();
  for (const r of monthsAll) {
    const y = periodYear(r.year_period);
    const mm = parseInt(r.year_period.slice(5), 10);
    const k = keyOf(r);
    maxMonthByYear.set(y, Math.max(maxMonthByYear.get(y) ?? 0, mm));
    if (!monthSum.has(y)) monthSum.set(y, new Map());
    if (!monthSum.get(y)!.has(k)) monthSum.get(y)!.set(k, new Array(13).fill(0));
    monthSum.get(y)!.get(k)![mm] += r.units;
  }
  // 연도의 1~upTo월 누계 (key → units)
  const ytdByKey = (year: string, upTo: number): Map<string, number> => {
    const out = new Map<string, number>();
    const ks = monthSum.get(year);
    if (!ks) return out;
    for (const [k, arr] of ks) {
      let s = 0;
      for (let i = 1; i <= upTo; i++) s += arr[i];
      if (s > 0) out.set(k, s);
    }
    return out;
  };

  // 연도 = 만년 연도 ∪ (만년 없는) 월 연도. YTD = 만년 없는 진행 연도(예: 2026).
  const allYears = [
    ...new Set([...annualYears, ...[...maxMonthByYear.keys()].filter((y) => !annualYears.has(y))]),
  ].sort();

  return allYears.map((year) => {
    const isYtd = !annualYears.has(year);
    const mm = maxMonthByYear.get(year) ?? 0;
    const cur = isYtd ? ytdByKey(year, mm) : (annualByKey.get(year) ?? new Map());
    const brands: Record<string, number> = {};
    let total = 0;
    for (const [k, v] of cur) {
      brands[k] = v;
      total += v;
    }
    // 전년 동기: YTD면 전년 1~mm월, 만년이면 전년 만년.
    const prevYear = String(parseInt(year, 10) - 1);
    const prevMap = isYtd
      ? ytdByKey(prevYear, mm)
      : (annualByKey.get(prevYear) ?? new Map<string, number>());
    const prev = prevMap.size > 0 ? Object.fromEntries(prevMap) : undefined;
    return {
      period: year,
      period_label: isYtd ? `${year} (1~${mm}월, YTD)` : year,
      brands,
      total,
      ...(prev ? { prev } : {}),
    };
  });
}

/** 시장점유율(생산 기준) — aggregateModelProductionByYear 결과를 연도별 100%로 정규화. */
function aggregateModelShareByYear(
  rows: UzbekistanRow[],
  dimension: 'brand' | 'company'
): UzbekistanShareRow[] {
  return aggregateModelProductionByYear(rows, dimension).map((p) => {
    const shares: Record<string, number> = {};
    for (const [k, v] of Object.entries(p.brands)) {
      shares[k] = p.total > 0 ? (v / p.total) * 100 : 0;
    }
    return { period: p.period, period_label: p.period_label, shares, total: p.total };
  });
}

const modelKeyOf = (r: UzbekistanRow) =>
  r.vehicle_model ? `${r.brand} ${r.vehicle_model}` : r.brand;

/**
 * 차종(모델)별 연도별 생산량 표.
 * - 만년(period_type='year')이 있는 해 → 만년 컬럼.
 * - 만년이 없는 당해연도 → 월별(period_type='month') 합으로 YTD 컬럼('1~N월') 구성.
 * - YoY = 최신 컬럼 vs 직전연도 동기간(최신이 YTD면 직전연도 같은 월수 합과 비교).
 */
function aggregateProductionModelYearTable(rows: UzbekistanRow[]): UzbekistanModelYearTable {
  const annual = rows.filter(
    (r) => r.kind === 'production' && r.period_type === 'year' && r.source_type === 'stat-uz'
  );
  const months = rows.filter(
    (r) => r.kind === 'production' && r.period_type === 'month' && r.source_type === 'stat-uz'
  );
  if (annual.length === 0 && months.length === 0)
    return { columns: [], rows: [], totals: { cells: {}, yoyPct: null } };

  const annualYears = new Set(annual.map((r) => r.year_period));
  // 월별: 연도별 최대 월 + (model, year, month) → units
  const maxMonthByYear = new Map<string, number>();
  for (const r of months) {
    const y = r.year_period.slice(0, 4);
    maxMonthByYear.set(
      y,
      Math.max(maxMonthByYear.get(y) ?? 0, parseInt(r.year_period.slice(5), 10))
    );
  }
  // 연도 = 만년 보유연도 ∪ (만년 없는) 월별 보유연도
  const years = new Set<string>(annualYears);
  for (const y of maxMonthByYear.keys()) years.add(y);
  const yearsAsc = [...years].sort();

  const columns = yearsAsc.map((year) => {
    if (annualYears.has(year)) return { year, label: year, isYtd: false };
    const mm = maxMonthByYear.get(year) ?? 0;
    return { year, label: `${year} (1~${mm}월, YTD)`, isYtd: true };
  });

  // 만년 값: (model → year → units)
  const cell = new Map<string, Map<string, number>>();
  for (const r of annual) {
    const k = modelKeyOf(r);
    if (!cell.has(k)) cell.set(k, new Map());
    cell.get(k)!.set(r.year_period, (cell.get(k)!.get(r.year_period) ?? 0) + r.units);
  }
  // 월별 누계 (model → year → upToMonth → cumulative). YTD 컬럼 + 동기 YoY용
  const monthSum = new Map<string, Map<string, number[]>>(); // model → year → [1..12] 월별
  for (const r of months) {
    const k = modelKeyOf(r);
    const y = r.year_period.slice(0, 4);
    const mm = parseInt(r.year_period.slice(5), 10);
    if (!monthSum.has(k)) monthSum.set(k, new Map());
    if (!monthSum.get(k)!.has(y)) monthSum.get(k)!.set(y, new Array(13).fill(0));
    monthSum.get(k)!.get(y)![mm] += r.units;
  }
  const ytdSum = (model: string, year: string, upTo: number): number => {
    const arr = monthSum.get(model)?.get(year);
    if (!arr) return 0;
    let s = 0;
    for (let i = 1; i <= upTo; i++) s += arr[i];
    return s;
  };

  // YTD 컬럼(만년 없는 연도)은 월별 합으로 cell 채움
  const allModels = new Set<string>([...cell.keys(), ...monthSum.keys()]);
  for (const m of allModels) {
    if (!cell.has(m)) cell.set(m, new Map());
    for (const col of columns) {
      if (col.isYtd)
        cell.get(m)!.set(col.year, ytdSum(m, col.year, maxMonthByYear.get(col.year) ?? 0));
    }
  }

  const latest = columns[columns.length - 1];
  const prevCol = columns.length > 1 ? columns[columns.length - 2] : null;
  const tableRows = [...allModels]
    .map((model) => {
      const byYear = cell.get(model)!;
      const cells: Record<string, number | null> = {};
      for (const c of columns) cells[c.year] = byYear.has(c.year) ? byYear.get(c.year)! : null;
      const cur = cells[latest.year];
      // YoY: 최신이 YTD면 직전연도 동일 월수 합과 비교, 아니면 직전 만년과 비교
      let prev: number | null = null;
      if (prevCol) {
        prev = latest.isYtd
          ? ytdSum(model, prevCol.year, maxMonthByYear.get(latest.year) ?? 0)
          : cells[prevCol.year];
      }
      const yoyPct = cur != null && prev != null && prev > 0 ? ((cur - prev) / prev) * 100 : null;
      return { model, cells, yoyPct };
    })
    .sort((a, b) => (b.cells[latest.year] ?? 0) - (a.cells[latest.year] ?? 0));

  // 합계 행 — 각 연도 컬럼의 전 모델 합 + 최신 컬럼 동기 YoY.
  const totalCells: Record<string, number | null> = {};
  for (const c of columns) {
    let s = 0;
    let has = false;
    for (const m of allModels) {
      const v = cell.get(m)?.get(c.year);
      if (v != null) {
        s += v;
        has = true;
      }
    }
    totalCells[c.year] = has ? s : null;
  }
  let totalYoy: number | null = null;
  if (prevCol) {
    const curTotal = totalCells[latest.year];
    let prevTotal: number | null;
    if (latest.isYtd) {
      let s = 0;
      for (const m of allModels) s += ytdSum(m, prevCol.year, maxMonthByYear.get(latest.year) ?? 0);
      prevTotal = s;
    } else {
      prevTotal = totalCells[prevCol.year];
    }
    totalYoy =
      curTotal != null && prevTotal != null && prevTotal > 0
        ? ((curTotal - prevTotal) / prevTotal) * 100
        : null;
  }

  return { columns, rows: tableRows, totals: { cells: totalCells, yoyPct: totalYoy } };
}

/**
 * 차종별 연간 생산량 — 연도별 + 전년 "동기" 비교(드롭다운 차트용).
 * - 만년(period_type='year') 연도 → 당해 만년 vs 전년 만년.
 * - YTD 연도(만년 없는 진행 연도, 예: 2026 1~N월) → 당해 1~N월 vs 전년 1~N월(동기).
 */
function aggregateModelYearCompare(rows: UzbekistanRow[]): UzbekistanModelYearCompare {
  const annual = rows.filter(
    (r) => r.kind === 'production' && r.period_type === 'year' && r.source_type === 'stat-uz'
  );
  const months = rows.filter(
    (r) => r.kind === 'production' && r.period_type === 'month' && r.source_type === 'stat-uz'
  );
  if (annual.length === 0 && months.length === 0) return { years: [], byYear: {} };

  const annualYears = new Set(annual.map((r) => r.year_period));
  const maxMonthByYear = new Map<string, number>();
  for (const r of months) {
    const y = r.year_period.slice(0, 4);
    maxMonthByYear.set(
      y,
      Math.max(maxMonthByYear.get(y) ?? 0, parseInt(r.year_period.slice(5), 10))
    );
  }
  // 만년 값 (model → year → units)
  const annualCell = new Map<string, Map<string, number>>();
  for (const r of annual) {
    const k = modelKeyOf(r);
    if (!annualCell.has(k)) annualCell.set(k, new Map());
    annualCell.get(k)!.set(r.year_period, (annualCell.get(k)!.get(r.year_period) ?? 0) + r.units);
  }
  // 월별 (model → year → [1..12])
  const monthSum = new Map<string, Map<string, number[]>>();
  for (const r of months) {
    const k = modelKeyOf(r);
    const y = r.year_period.slice(0, 4);
    const mm = parseInt(r.year_period.slice(5), 10);
    if (!monthSum.has(k)) monthSum.set(k, new Map());
    if (!monthSum.get(k)!.has(y)) monthSum.get(k)!.set(y, new Array(13).fill(0));
    monthSum.get(k)!.get(y)![mm] += r.units;
  }
  const ytdSum = (model: string, year: string, upTo: number): number => {
    const arr = monthSum.get(model)?.get(year);
    if (!arr) return 0;
    let s = 0;
    for (let i = 1; i <= upTo; i++) s += arr[i];
    return s;
  };

  const yearsSet = new Set<string>(annualYears);
  for (const y of maxMonthByYear.keys()) yearsSet.add(y);
  const yearsAsc = [...yearsSet].sort();
  const allModels = new Set<string>([...annualCell.keys(), ...monthSum.keys()]);

  // 당해 값(만년 또는 1~N월 YTD). 데이터 없으면 null.
  const currentOf = (model: string, year: string): number | null => {
    if (annualYears.has(year)) return annualCell.get(model)?.get(year) ?? null;
    if (!monthSum.get(model)?.has(year)) return null;
    return ytdSum(model, year, maxMonthByYear.get(year) ?? 0);
  };

  const years: UzbekistanModelCompareYear[] = yearsAsc.map((year) => {
    const ytdMonth = annualYears.has(year) ? 0 : (maxMonthByYear.get(year) ?? 0);
    const prevYear = String(parseInt(year, 10) - 1);
    // YTD면 전년 월별 데이터가, 만년이면 전년 만년 데이터가 있어야 동기 비교 가능.
    const hasPrev = ytdMonth > 0 ? maxMonthByYear.has(prevYear) : annualYears.has(prevYear);
    return { year, ytdMonth, prevYear, hasPrev };
  });

  const byYear: Record<string, { model: string; current: number; prev: number | null }[]> = {};
  for (const meta of years) {
    const prevOf = (model: string): number | null => {
      if (!meta.hasPrev) return null;
      return meta.ytdMonth > 0
        ? ytdSum(model, meta.prevYear, meta.ytdMonth)
        : (annualCell.get(model)?.get(meta.prevYear) ?? null);
    };
    byYear[meta.year] = [...allModels]
      .map((model) => ({ model, current: currentOf(model, meta.year) ?? 0, prev: prevOf(model) }))
      .filter((it) => it.current > 0 || (it.prev ?? 0) > 0)
      .sort((a, b) => b.current - a.current);
  }

  return { years, byYear };
}

function aggregateBrandYearSeries(
  rows: UzbekistanRow[],
  brand: string
): UzbekistanBrandSeriesPoint[] {
  const years = rows.filter(
    (r) =>
      r.kind === 'production' &&
      r.period_type === 'year' &&
      r.source_type === 'uzavtosanoat' &&
      r.brand === brand
  );
  const byYear = new Map<string, number>();
  for (const r of years) {
    byYear.set(r.year_period, (byYear.get(r.year_period) ?? 0) + r.units);
  }
  const sorted = [...byYear.keys()].sort();
  return sorted.map((y) => {
    const units = byYear.get(y) ?? 0;
    const prevY = String(parseInt(y, 10) - 1);
    const prev = byYear.get(prevY) ?? 0;
    const yoy = prev > 0 ? ((units - prev) / prev) * 100 : null;
    return { period: y, period_label: y, units, yoy_pct: yoy };
  });
}

function aggregateCompanySalesShare(
  rows: UzbekistanRow[],
  dimension: 'company' | 'brand' = 'company'
): UzbekistanShareRow[] {
  // annual sales row (uzavtosanoat)
  const years = rows.filter(
    (r) => r.kind === 'sales' && r.period_type === 'year' && r.source_type === 'uzavtosanoat'
  );
  const monthsByYear = salesMonthsByYear(rows);
  const byYear = new Map<string, Record<string, number>>();
  for (const r of years) {
    const key = dimension === 'brand' ? brandOfSalesCompany(r.company) : r.company;
    const cur = byYear.get(r.year_period) ?? {};
    cur[key] = (cur[key] ?? 0) + r.units;
    byYear.set(r.year_period, cur);
  }
  const sorted = [...byYear.keys()].sort();
  return sorted.map((y) => {
    const companies = byYear.get(y)!;
    const total = Object.values(companies).reduce((a, b) => a + b, 0);
    const shares: Record<string, number> = {};
    for (const [c, v] of Object.entries(companies)) {
      shares[c] = total > 0 ? (v / total) * 100 : 0;
    }
    return { period: y, period_label: annualYtdLabel(y, monthsByYear).label, shares, total };
  });
}

function aggregateProductionKpi(rows: UzbekistanRow[]): UzbekistanProductionKpi {
  // 엔진(UzAuto Motors Powertrain)은 완성차가 아니므로 집계 제외 (사용자 지시).
  const chev = aggregateBrandYearSeries(rows, 'Chevrolet');
  const byd = aggregateBrandYearSeries(rows, 'BYD');
  const lastChev = chev[chev.length - 1];
  const prevChev = chev[chev.length - 2];
  const lastByd = byd[byd.length - 1];
  return {
    chevroletLatest: lastChev?.units ?? 0,
    chevroletLatestLabel: lastChev?.period_label ?? '',
    chevroletPrev: prevChev?.units ?? 0,
    chevroletYoy: lastChev?.yoy_pct ?? null,
    bydLatest: lastByd?.units ?? 0,
    bydLatestLabel: lastByd?.period_label ?? '',
    carTotalLatest: (lastChev?.units ?? 0) + (lastByd?.units ?? 0),
  };
}

/**
 * 판매 KPI — 부분연도(YTD)를 만년과 혼동하지 않도록 월별 데이터로 동기간 비교.
 * - 완전 연도(12개월): 최신·직전 완전연도 합계 + YoY (둘 다 완전할 때만).
 * - 최신연도가 부분(예: 1~4월)이면 YTD 카드 + 전년 동월(1~4월) YoY.
 */
function aggregateKpi(monthly: UzbekistanCompanyMonthlyPoint[]): UzbekistanKpi {
  const empty: UzbekistanKpi = {
    totalLatestYear: 0,
    latestYearLabel: '',
    totalPrevYear: 0,
    prevYearLabel: '',
    yoyPct: null,
    ytdLatest: 0,
    ytdLabel: '',
    ytdPrev: 0,
    ytdYoyPct: null,
  };
  if (monthly.length === 0) return empty;

  const monthsByYear = new Map<number, Set<number>>();
  const totalByYM = new Map<string, number>(); // 'YYYY-MM' → total
  for (const p of monthly) {
    const [yStr, mStr] = p.period.split('-');
    const y = parseInt(yStr, 10);
    if (!monthsByYear.has(y)) monthsByYear.set(y, new Set());
    monthsByYear.get(y)!.add(parseInt(mStr, 10));
    totalByYM.set(p.period, p.total);
  }
  const years = [...monthsByYear.keys()].sort((a, b) => a - b);
  const yearTotal = (y: number) =>
    [...(monthsByYear.get(y) ?? [])].reduce(
      (s, m) => s + (totalByYM.get(`${y}-${String(m).padStart(2, '0')}`) ?? 0),
      0
    );

  // 완전 연도(12개월) — 만년 비교용
  const completeYears = years.filter((y) => (monthsByYear.get(y)?.size ?? 0) >= 12);
  const latestComplete = completeYears.at(-1) ?? null;
  const prevComplete = completeYears.length > 1 ? completeYears.at(-2)! : null;

  // YTD — 최신연도가 부분이면 전년 동월 합과 비교
  const latestYearNum = years.at(-1)!;
  const latestMonths = [...monthsByYear.get(latestYearNum)!].sort((a, b) => a - b);
  const isPartial = latestMonths.length < 12;
  let ytdLatest = 0;
  let ytdPrev = 0;
  let ytdLabel = '';
  let ytdYoyPct: number | null = null;
  if (isPartial) {
    ytdLatest = yearTotal(latestYearNum);
    ytdPrev = latestMonths.reduce(
      (s, m) => s + (totalByYM.get(`${latestYearNum - 1}-${String(m).padStart(2, '0')}`) ?? 0),
      0
    );
    ytdLabel = `${latestYearNum} 1~${Math.max(...latestMonths)}월`;
    ytdYoyPct = ytdPrev > 0 ? ((ytdLatest - ytdPrev) / ytdPrev) * 100 : null;
  }

  const latestTotal = latestComplete != null ? yearTotal(latestComplete) : 0;
  const prevTotal = prevComplete != null ? yearTotal(prevComplete) : 0;
  return {
    totalLatestYear: latestTotal,
    latestYearLabel: latestComplete != null ? String(latestComplete) : '',
    totalPrevYear: prevTotal,
    prevYearLabel: prevComplete != null ? String(prevComplete) : '',
    yoyPct:
      latestComplete != null && prevComplete != null && prevTotal > 0
        ? ((latestTotal - prevTotal) / prevTotal) * 100
        : null,
    ytdLatest,
    ytdLabel,
    ytdPrev,
    ytdYoyPct,
  };
}

export async function getUzbekistanData(): Promise<UzbekistanPageData> {
  'use cache';
  cacheLife('hours');
  cacheTag('uzbekistan-auto-stats');

  const supabase = createSupabaseAnonClient();
  const all = await fetchAll(supabase);
  const monthlyByCompany = aggregateMonthlyByCompany(all);
  const annualByCompany = aggregateAnnualByCompany(all);
  const companies = [
    ...new Set(all.filter((r) => r.kind === 'sales' && r.company).map((r) => r.company)),
  ].sort();
  const lastCollectedAt = all.reduce<string | null>((max, r) => {
    const ts = (r as unknown as { collected_at?: string }).collected_at;
    return max == null || (ts && ts > max) ? (ts ?? max) : max;
  }, null);

  return {
    kpi: aggregateKpi(monthlyByCompany),
    monthlyByCompany,
    annualByCompany,
    productionByBrandYear: aggregateModelProductionByYear(all, 'brand'),
    productionByCompanyYear: aggregateModelProductionByYear(all, 'company'),
    productionModelYearTable: aggregateProductionModelYearTable(all),
    productionModelCompare: aggregateModelYearCompare(all),
    productionKpi: aggregateProductionKpi(all),
    chevroletSeries: aggregateBrandYearSeries(all, 'Chevrolet'),
    productionShareByBrand: aggregateModelShareByYear(all, 'brand'),
    productionShareByCompany: aggregateModelShareByYear(all, 'company'),
    companySalesShare: aggregateCompanySalesShare(all, 'company'),
    salesShareByBrand: aggregateCompanySalesShare(all, 'brand'),
    totalRows: all.length,
    lastCollectedAt,
    companies,
  };
}
