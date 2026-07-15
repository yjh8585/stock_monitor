/**
 * 스텔란티스 북미 매출 전망(/management/stellantis) 데이터 입구 — fetch + 'use cache'.
 *
 * 소스 4종을 한 화면에 모은다. **자사 매출만 사외비**이고 나머지 3종은 공개 데이터다:
 *  - `stellantis_shipments`      (공개) 북미 출하 — SEC EDGAR
 *  - `oem_sales_model_country_month` (공개) 북미 소매 — MarkLines
 *  - `cox_brand_inventory`       (공개) 딜러 재고일수 — Cox
 *  - `pnl_entries`               (**사외비**) 자사 Stellantis NA향 매출 → 반드시 confidentialDb
 *
 * 집계·판정은 aggregate.ts(pure)에서 하고 여기선 fetch + 조립만 한다.
 */
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import logger from '@/lib/logger';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import { confidentialDb } from '@/lib/supabase/confidential';
import {
  buildForecast,
  buildGapPoints,
  buildNaRetailMonths,
  buildNaRetailQuarters,
  buildRevenueVsRetail,
  buildUnitRevenue,
  detectLag,
  diagnose,
  lastCompleteQuarter,
  NA_COUNTRIES,
  quarterLabel,
  revenueByQuarter,
} from './aggregate';
import type {
  CoxInventoryRow,
  RetailMonthRow,
  RevenueMonthRow,
  ShipmentRow,
  StellantisForecastData,
} from './types';

/** pnl_entries의 거래처 값 — 스텔란티스 북미향. ('Stellantis EU'가 따로 있으니 정확히 매칭할 것) */
const CUSTOMER_STELLANTIS_NA = 'Stellantis NA';

/**
 * 자사 매출 기준 — 별도(standalone).
 *
 * 연결(consolidated)은 월별 데이터가 2025년부터라 시차 탐지 표본이 17개월뿐이다.
 * 별도는 2022-01부터 53개월 연속이라 ±6개월 시차 탐색에 필요한 표본이 나온다.
 */
const REVENUE_BASIS = 'standalone';

/** PostgREST 페이지 크기. */
const PAGE_SIZE = 1000;

async function fetchShipments(): Promise<ShipmentRow[]> {
  const supabase = createSupabaseAnonClient();
  const { data, error } = await supabase
    .from('stellantis_shipments')
    .select('region, year_period, shipments_units, is_derived')
    .eq('region', 'North America')
    .eq('period_type', 'quarter')
    .order('year_period', { ascending: true });
  if (error) {
    logger.error({ err: error }, 'stellantis_shipments 조회 실패');
    throw new Error(`stellantis_shipments 조회 실패: ${error.message}`);
  }
  return data ?? [];
}

/**
 * MarkLines 북미 소매 — 모델 단위(마세라티 제외를 aggregate에서 하므로 모델을 그대로 가져온다).
 *
 * 행이 많아 페이지네이션이 필요하다. **결정적 정렬 필수** — `.in()` 필터는 인덱스 스캔이라
 * 정렬 없이 다중 페이지를 받으면 페이지 경계에서 행이 누락·중복된다(lib/oem/source.ts 전례:
 * 특정 연도가 통째로 빠져 차트가 near-zero가 됐다).
 */
async function fetchNaRetail(): Promise<RetailMonthRow[]> {
  const supabase = createSupabaseAnonClient();
  const out: RetailMonthRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('oem_sales_model_country_month')
      .select('country, model, year_month, sales')
      .in('oem_group', ['Stellantis', 'FCA'])
      .in('country', NA_COUNTRIES as string[])
      .order('year_month', { ascending: true })
      .order('country', { ascending: true })
      .order('model', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      logger.error({ err: error }, 'oem_sales_model_country_month 조회 실패');
      throw new Error(`MarkLines 북미 소매 조회 실패: ${error.message}`);
    }
    const page = data ?? [];
    out.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return out;
}

/** Cox 딜러 재고일수. days_supply=null + is_outlier_excluded=true = "업계 평균 2배 초과(Cox 미공개)". */
async function fetchCox(): Promise<CoxInventoryRow[]> {
  const supabase = createSupabaseAnonClient();
  const { data, error } = await supabase
    .from('cox_brand_inventory')
    .select('brand, year_month, days_supply')
    .order('year_month', { ascending: true })
    .order('brand', { ascending: true });
  if (error) {
    // 재고는 보조 축이라 없어도 페이지가 성립한다 — 진단이 Cox 없이도 동작하도록 설계됨.
    logger.warn({ err: error }, 'cox_brand_inventory 조회 실패 — 재고 교차검증 없이 진행');
    return [];
  }
  return data ?? [];
}

/** 자사 Stellantis NA향 월별 매출 (사외비 → confidentialDb 필수). */
async function fetchRevenue(): Promise<RevenueMonthRow[]> {
  const { data, error } = await confidentialDb
    .from('pnl_entries')
    .select('period_year, period_month, revenue')
    .eq('customer', CUSTOMER_STELLANTIS_NA)
    .eq('basis', REVENUE_BASIS)
    .eq('is_plan', false)
    .gte('period_month', 1)
    .order('period_year', { ascending: true })
    .order('period_month', { ascending: true });
  if (error) {
    logger.error({ err: error }, 'pnl_entries(Stellantis NA) 조회 실패');
    throw new Error(`자사 매출 조회 실패: ${error.message}`);
  }
  // 같은 (연,월)이 차원별로 쪼개져 여러 행일 수 있으니 합산한다.
  const byMonth = new Map<number, number>();
  for (const row of data ?? []) {
    if (row.revenue === null) continue;
    const yearMonth = row.period_year * 100 + row.period_month;
    byMonth.set(yearMonth, (byMonth.get(yearMonth) ?? 0) + row.revenue);
  }
  return [...byMonth.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year_month, revenueEok]) => ({ year_month, revenueEok }));
}

export async function getStellantisForecastData(): Promise<StellantisForecastData> {
  'use cache';
  cacheLife('days');
  cacheTag('stellantis-shipments');
  cacheTag('oem_sales_model_country_month');
  cacheTag('cox-brand-inventory');
  cacheTag('pnl_entries');

  const [shipments, retailRows, cox, revenue] = await Promise.all([
    fetchShipments(),
    fetchNaRetail(),
    fetchCox(),
    fetchRevenue(),
  ]);

  // 캐나다가 한 달 늦게 들어오므로 3개국이 다 찬 분기까지만 쓴다 — 안 그러면 소매 과소집계로
  // 재고 축적을 과대평가한다(aggregate.ts lastCompleteQuarter 주석 참고).
  const cutoff = lastCompleteQuarter(retailRows);
  const retailQuarters = buildNaRetailQuarters(retailRows, cutoff);
  const retailMonths = buildNaRetailMonths(retailRows);

  const gap = buildGapPoints(shipments, retailQuarters);
  const lag = detectLag(new Map(revenue.map((r) => [r.year_month, r.revenueEok])), retailMonths);
  const lagMonths = lag?.lagMonths ?? 0;

  const revenueQuarters = revenueByQuarter(revenue);
  const unitRevenue = buildUnitRevenue(revenueQuarters, shipments, lagMonths);

  // 출하가 아직 없는 분기(H1/FY 보도자료 대기)가 있으면 화면에 사실대로 밝힌다.
  const shipmentQuarters = new Set(shipments.map((s) => s.year_period));
  const partialQuarter = [...retailQuarters.keys()]
    .filter((q) => !shipmentQuarters.has(q))
    .sort()
    .pop();

  return {
    gap,
    lag,
    unitRevenue,
    diagnosis: diagnose(gap, cox),
    forecast: buildForecast(gap, unitRevenue, revenueQuarters),
    cox,
    revenueVsRetail: buildRevenueVsRetail(revenue, retailMonths, lagMonths),
    lastCompleteQuarter: cutoff,
    partialQuarterNote: partialQuarter
      ? `${quarterLabel(partialQuarter)} 출하는 스텔란티스 반기·연간 보도자료 공시 후 반영됩니다(분기 실적 발표는 Q1·H1·Q3·FY 4회만).`
      : null,
  };
}
