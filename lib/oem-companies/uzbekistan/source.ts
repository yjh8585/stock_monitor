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
  period_type: 'month' | 'quarter' | 'year';
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

/** production KPI — 누적. */
export interface UzbekistanProductionKpi {
  chevroletLatest: number;
  chevroletLatestLabel: string;
  chevroletPrev: number;
  chevroletYoy: number | null;
  bydLatest: number;
  bydLatestLabel: string;
  enginesLatest: number;
  enginesLatestLabel: string;
  enginesPrev: number;
  enginesYoy: number | null;
  carTotalLatest: number;  // Chevrolet + BYD
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
  /** production KPI (Chevrolet/BYD/Engines + YoY). */
  productionKpi: UzbekistanProductionKpi;
  /** Chevrolet production 10년 시계열 (2016~2025). */
  chevroletSeries: UzbekistanBrandSeriesPoint[];
  /** Engines production 10년 시계열. */
  enginesSeries: UzbekistanBrandSeriesPoint[];
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
    (r) =>
      r.kind === 'sales' && r.period_type === 'month' && r.source_type === 'uzavtosanoat'
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
    (r) =>
      r.kind === 'sales' && r.period_type === 'year' && r.source_type === 'uzavtosanoat'
  );
  if (yearRows.length === 0) {
    // fallback: month 합산
    const months = rows.filter(
      (r) =>
        r.kind === 'sales' && r.period_type === 'month' && r.source_type === 'uzavtosanoat'
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
      r.source_type === 'uzavtosanoat'
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

/** stat.uz 월별 production (모델별 stacked, source_type='stat-uz'). */
function aggregateStatUzMonthlyByModel(rows: UzbekistanRow[]): UzbekistanProductionYearPoint[] {
  const months = rows.filter(
    (r) =>
      r.kind === 'production' &&
      r.period_type === 'month' &&
      r.source_type === 'stat-uz'
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
    (r) =>
      r.kind === 'sales' &&
      r.period_type === 'year' &&
      r.source_type === 'uzavtosanoat'
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
  const chev = aggregateBrandYearSeries(rows, 'Chevrolet');
  const byd = aggregateBrandYearSeries(rows, 'BYD');
  const eng = aggregateBrandYearSeries(rows, 'Engines');
  const lastChev = chev[chev.length - 1];
  const prevChev = chev[chev.length - 2];
  const lastByd = byd[byd.length - 1];
  const lastEng = eng[eng.length - 1];
  const prevEng = eng[eng.length - 2];
  return {
    chevroletLatest: lastChev?.units ?? 0,
    chevroletLatestLabel: lastChev?.period_label ?? '',
    chevroletPrev: prevChev?.units ?? 0,
    chevroletYoy: lastChev?.yoy_pct ?? null,
    bydLatest: lastByd?.units ?? 0,
    bydLatestLabel: lastByd?.period_label ?? '',
    enginesLatest: lastEng?.units ?? 0,
    enginesLatestLabel: lastEng?.period_label ?? '',
    enginesPrev: prevEng?.units ?? 0,
    enginesYoy: lastEng?.yoy_pct ?? null,
    carTotalLatest: (lastChev?.units ?? 0) + (lastByd?.units ?? 0),
  };
}

function aggregateKpi(rows: UzbekistanRow[]): UzbekistanKpi {
  const annual = aggregateAnnualByCompany(rows);
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
  if (annual.length === 0) return empty;
  // 가장 최근 완료 연도 + 직전 연도
  const completedYears = annual.filter((p) => !p.is_ytd).sort((a, b) => (a.period < b.period ? 1 : -1));
  const ytdYear = annual.find((p) => p.is_ytd);
  const latest = completedYears[0];
  const prev = completedYears[1];
  return {
    totalLatestYear: latest?.total ?? 0,
    latestYearLabel: latest?.period_label ?? '',
    totalPrevYear: prev?.total ?? 0,
    prevYearLabel: prev?.period_label ?? '',
    yoyPct:
      latest && prev && prev.total > 0
        ? ((latest.total - prev.total) / prev.total) * 100
        : null,
    ytdLatest: ytdYear?.total ?? 0,
    ytdLabel: ytdYear?.period_label ?? '',
    ytdPrev: 0,
    ytdYoyPct: null,
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
    ...new Set(
      all
        .filter((r) => r.kind === 'sales' && r.company)
        .map((r) => r.company)
    ),
  ].sort();
  const lastCollectedAt = all.reduce<string | null>((max, r) => {
    const ts = (r as unknown as { collected_at?: string }).collected_at;
    return max == null || (ts && ts > max) ? ts ?? max : max;
  }, null);

  return {
    kpi: aggregateKpi(all),
    monthlyByCompany,
    annualByCompany,
    productionAnnualByBrand,
    statUzMonthlyByModel: aggregateStatUzMonthlyByModel(all),
    productionKpi: aggregateProductionKpi(all),
    chevroletSeries: aggregateBrandYearSeries(all, 'Chevrolet'),
    enginesSeries: aggregateBrandYearSeries(all, 'Engines'),
    carBrandShare: aggregateCarBrandShare(all),
    companySalesShare: aggregateCompanySalesShare(all),
    totalRows: all.length,
    lastCollectedAt,
    companies,
  };
}
