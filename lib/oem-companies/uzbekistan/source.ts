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
}

export interface UzbekistanProductionYearPoint {
  period: string;
  period_label: string;
  brands: Record<string, number>;
  total: number;
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
  productionAnnualByBrand: UzbekistanProductionYearPoint[];
  /** stat.uz 월별 production (모델별 stacked). */
  statUzMonthlyByModel: UzbekistanProductionYearPoint[];
  /** 차종(모델)별 생산량 — 모델 x축, 당년·전년 동기 grouped. */
  productionByModel: UzbekistanProductionYearPoint[];
  /** 차종(모델)별 연도별 생산량 표 (연도 컬럼 + 최신 YTD + YoY). */
  productionModelYearTable: UzbekistanModelYearTable;
  /** production KPI (Chevrolet/BYD/Engines + YoY). */
  productionKpi: UzbekistanProductionKpi;
  /** Chevrolet production 10년 시계열 (2016~2025). */
  chevroletSeries: UzbekistanBrandSeriesPoint[];
  /** 자동차 brand share 100% stacked (Chevrolet vs BYD over years). */
  carBrandShare: UzbekistanShareRow[];
  /** 회사별 sales share 100% stacked (annual). */
  companySalesShare: UzbekistanShareRow[];
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
  const byYear = new Map<string, UzbekistanCompanyMonthlyPoint>();
  for (const r of yearRows) {
    let p = byYear.get(r.year_period);
    if (!p) {
      p = { period: r.year_period, period_label: r.year_period, companies: {}, total: 0 };
      byYear.set(r.year_period, p);
    }
    p.companies[r.company] = (p.companies[r.company] ?? 0) + r.units;
    p.total += r.units;
  }
  return [...byYear.values()].sort((a, b) => (a.period < b.period ? -1 : 1));
}

function aggregateProductionAnnualByBrand(rows: UzbekistanRow[]): UzbekistanProductionYearPoint[] {
  const years = rows.filter(
    (r) =>
      r.kind === 'production' &&
      r.period_type === 'year' &&
      r.source_type === 'uzavtosanoat' &&
      r.company === '' && // 브랜드별 시드만 (회사별 생산 row는 제외)
      r.brand !== '' &&
      r.brand !== 'Engines' // 엔진(Powertrain)은 완성차 아님 — 집계 제외 (사용자 지시)
  );
  const byYear = new Map<string, UzbekistanProductionYearPoint>();
  for (const r of years) {
    let p = byYear.get(r.year_period);
    if (!p) {
      p = { period: r.year_period, period_label: r.year_period, brands: {}, total: 0 };
      byYear.set(r.year_period, p);
    }
    p.brands[r.brand] = (p.brands[r.brand] ?? 0) + r.units;
    p.total += r.units;
  }
  return [...byYear.values()].sort((a, b) => (a.period < b.period ? -1 : 1));
}

/** stat.uz 모델별 월별 생산 (source_type='stat-uz', period_type='month'). YTD 차분 결과. */
function aggregateStatUzMonthlyByModel(rows: UzbekistanRow[]): UzbekistanProductionYearPoint[] {
  const months = rows.filter(
    (r) => r.kind === 'production' && r.period_type === 'month' && r.source_type === 'stat-uz'
  );
  const byPeriod = new Map<string, UzbekistanProductionYearPoint>();
  for (const r of months) {
    let p = byPeriod.get(r.year_period);
    if (!p) {
      const [y, m] = r.year_period.split('-');
      p = {
        period: r.year_period,
        period_label: `${y.slice(2)}.${m}`,
        brands: {},
        total: 0,
      };
      byPeriod.set(r.year_period, p);
    }
    // model이 비어있으면 brand 자체 표시
    const key = r.vehicle_model ? `${r.brand} ${r.vehicle_model}` : r.brand;
    p.brands[key] = (p.brands[key] ?? 0) + r.units;
    p.total += r.units;
  }
  return [...byPeriod.values()].sort((a, b) => (a.period < b.period ? -1 : 1));
}

const modelKeyOf = (r: UzbekistanRow) =>
  r.vehicle_model ? `${r.brand} ${r.vehicle_model}` : r.brand;

/**
 * 차종(모델)별 생산량 — stat.uz 연간(period_type='year') 최근 2개년을 모델 x축으로 grouped.
 * 만년 데이터가 한 해뿐이면 단일 시리즈. (연말 기사 수집 시 자동으로 다개년 비교)
 */
function aggregateProductionByModel(rows: UzbekistanRow[]): UzbekistanProductionYearPoint[] {
  const years = rows.filter(
    (r) => r.kind === 'production' && r.period_type === 'year' && r.source_type === 'stat-uz'
  );
  if (years.length === 0) return [];
  const periods = [...new Set(years.map((r) => r.year_period))].sort();
  const recent = periods.slice(-2);
  const cur = recent[recent.length - 1];
  const byModel = new Map<string, UzbekistanProductionYearPoint>();
  for (const r of years) {
    if (!recent.includes(r.year_period)) continue;
    const key = modelKeyOf(r);
    let p = byModel.get(key);
    if (!p) {
      p = { period: key, period_label: key, brands: {}, total: 0 };
      byModel.set(key, p);
    }
    p.brands[r.year_period] = (p.brands[r.year_period] ?? 0) + r.units;
    if (r.year_period === cur) p.total += r.units;
  }
  return [...byModel.values()].sort((a, b) => b.total - a.total);
}

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
  if (annual.length === 0 && months.length === 0) return { columns: [], rows: [] };

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

  return { columns, rows: tableRows };
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

function aggregateCarBrandShare(rows: UzbekistanRow[]): UzbekistanShareRow[] {
  // 차량 brand만 (Chevrolet + BYD) — Engines/LCV 제외
  const years = rows.filter(
    (r) =>
      r.kind === 'production' &&
      r.period_type === 'year' &&
      r.source_type === 'uzavtosanoat' &&
      (r.brand === 'Chevrolet' || r.brand === 'BYD')
  );
  const byYear = new Map<string, Record<string, number>>();
  for (const r of years) {
    const cur = byYear.get(r.year_period) ?? {};
    cur[r.brand] = (cur[r.brand] ?? 0) + r.units;
    byYear.set(r.year_period, cur);
  }
  const sorted = [...byYear.keys()].sort();
  return sorted.map((y) => {
    const brands = byYear.get(y)!;
    const total = Object.values(brands).reduce((a, b) => a + b, 0);
    const shares: Record<string, number> = {};
    for (const [b, v] of Object.entries(brands)) {
      shares[b] = total > 0 ? (v / total) * 100 : 0;
    }
    return { period: y, period_label: y, shares, total };
  });
}

function aggregateCompanySalesShare(rows: UzbekistanRow[]): UzbekistanShareRow[] {
  // annual sales row (uzavtosanoat)
  const years = rows.filter(
    (r) => r.kind === 'sales' && r.period_type === 'year' && r.source_type === 'uzavtosanoat'
  );
  const byYear = new Map<string, Record<string, number>>();
  for (const r of years) {
    const cur = byYear.get(r.year_period) ?? {};
    cur[r.company] = (cur[r.company] ?? 0) + r.units;
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
    return { period: y, period_label: y, shares, total };
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
  const productionAnnualByBrand = aggregateProductionAnnualByBrand(all);
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
    productionAnnualByBrand,
    statUzMonthlyByModel: aggregateStatUzMonthlyByModel(all),
    productionByModel: aggregateProductionByModel(all),
    productionModelYearTable: aggregateProductionModelYearTable(all),
    productionKpi: aggregateProductionKpi(all),
    chevroletSeries: aggregateBrandYearSeries(all, 'Chevrolet'),
    carBrandShare: aggregateCarBrandShare(all),
    companySalesShare: aggregateCompanySalesShare(all),
    totalRows: all.length,
    lastCollectedAt,
    companies,
  };
}
