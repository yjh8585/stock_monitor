/**
 * 스텔란티스 북미 매출 전망(/management/stellantis) 데이터 입구 — fetch + 'use cache'.
 *
 * 소스 5종을 한 화면에 모은다. **자사 매출만 사외비**이고 나머지 4종은 공개 데이터다:
 *  - `oem_production_model_country_month` (공개) 북미 생산 — MarkLines
 *  - `oem_sales_model_country_month`      (공개) 북미 소매 — MarkLines
 *  - `stellantis_shipments`               (공개) 북미 출하 — SEC EDGAR
 *  - `cox_brand_inventory`                (공개) 딜러 재고일수 — Cox
 *  - `pnl_entries`                        (**사외비**) 자사 Stellantis NA향 매출 → 반드시 confidentialDb
 *
 * 집계·판정은 aggregate.ts(pure)에서 하고 여기선 fetch + 조립만 한다.
 */
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import logger from '@/lib/logger';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import { confidentialDb } from '@/lib/supabase/confidential';
import {
  analyzeDrivers,
  attachEventContext,
  buildGapPoints,
  buildInventoryOutlooks,
  buildMonthlyFlow,
  buildNaProductionMonths,
  buildNaRetailMonths,
  buildNaRetailQuarters,
  buildProjectedGapQuarter,
  diagnose,
  lastCompleteMonth,
  lastCompleteQuarter,
  NA_COUNTRIES,
  quarterIndex,
  quarterLabel,
} from './aggregate';
import { PLANT_EVENTS } from './plant-events';
import type {
  CoxInventoryRow,
  ProductionMonthRow,
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

/**
 * MarkLines의 스텔란티스 그룹 라벨.
 *
 * 2020년은 'FCA'(PSA 합병 2021-01 완료 전), 2021년부터 'Stellantis'. 둘 다 받아야 시계열이
 * 2020년까지 이어진다. 북미 한정으로는 PSA의 생산·판매가 사실상 없어 스코프가 연속이다.
 */
const STELLANTIS_GROUPS = ['Stellantis', 'FCA'];

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
      .in('oem_group', STELLANTIS_GROUPS)
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

/**
 * MarkLines 북미 생산 — `country`가 **공장 국가**다(소매의 country와 의미가 다름).
 *
 * 소매와 같은 이유로 **결정적 정렬 필수**.
 */
async function fetchNaProduction(): Promise<ProductionMonthRow[]> {
  const supabase = createSupabaseAnonClient();
  const out: ProductionMonthRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('oem_production_model_country_month')
      .select('country, model, year_month, production')
      .in('oem_group', STELLANTIS_GROUPS)
      .in('country', NA_COUNTRIES as string[])
      .order('year_month', { ascending: true })
      .order('country', { ascending: true })
      .order('model', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      logger.error({ err: error }, 'oem_production_model_country_month 조회 실패');
      throw new Error(`MarkLines 북미 생산 조회 실패: ${error.message}`);
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
  cacheTag('oem_production_model_country_month');
  cacheTag('cox-brand-inventory');
  cacheTag('pnl_entries');

  const [shipments, retailRows, productionRows, cox, revenue] = await Promise.all([
    fetchShipments(),
    fetchNaRetail(),
    fetchNaProduction(),
    fetchCox(),
    fetchRevenue(),
  ]);

  // MarkLines는 국가별 도착 시점이 다르므로 3개국이 다 찬 기간까지만 쓴다 — 안 그러면
  // 소매·생산이 과소집계돼 갭이 허구가 된다(aggregate.ts lastCompleteMonth 주석 참고).
  const monthCutoff = lastCompleteMonth(productionRows, retailRows);
  const quarterCutoff = lastCompleteQuarter(retailRows);

  const retailMonths = buildNaRetailMonths(retailRows, monthCutoff);
  const productionMonths = buildNaProductionMonths(productionRows, monthCutoff);
  const retailQuarters = buildNaRetailQuarters(retailRows, quarterCutoff);

  const monthlyFlow = buildMonthlyFlow(productionMonths, retailMonths);
  const gap = buildGapPoints(shipments, retailQuarters);

  // 진행 중인 최신 분기(출하는 IR로 왔지만 소매가 아직 국가별로 덜 도착)를 소매 일부 추정으로
  // 채워 차트 2에만 붙인다(사용자 결정 2026-07-16). 통계·진단은 실측 gap만 쓴다.
  const projected = buildProjectedGapQuarter(gap, shipments, retailRows, quarterCutoff);

  // 출하가 아직 없는 분기(retail은 완비인데 shipment 미도착)가 있으면 화면에 사실대로 밝힌다.
  // 단 **출하 era(첫 출하 분기) 이전**의 소매 분기(2020 FCA 등)는 '대기'가 아니라 스코프 밖이므로
  // 제외한다 — 안 그러면 2020-Q4가 영영 오지 않을 출하를 기다리는 것처럼 오표시된다.
  const shipmentQuarters = new Set(shipments.map((s) => s.year_period));
  const firstShipQuarterIndex = shipments.length
    ? Math.min(...shipments.map((s) => quarterIndex(s.year_period)))
    : Infinity;
  const partialQuarter = [...retailQuarters.keys()]
    .filter((q) => !shipmentQuarters.has(q) && quarterIndex(q) >= firstShipQuarterIndex)
    .sort()
    .pop();

  return {
    monthlyFlow,
    gap,
    gapProjected: projected?.point ?? null,
    projectedNote: projected?.note ?? null,
    drivers: analyzeDrivers(revenue, productionMonths, retailMonths, shipments),
    outlooks: buildInventoryOutlooks(monthlyFlow, gap, revenue),
    // 공장 이벤트는 DB가 아니라 코드 상수(수동 큐레이션) — 그래서 cacheTag가 없다.
    // 파일이 바뀌면 배포가 캐시를 갈아치우므로 별도 무효화 경로가 필요 없다.
    events: attachEventContext(PLANT_EVENTS, monthlyFlow),
    diagnosis: diagnose(gap, monthlyFlow, cox),
    cox,
    lastCompleteMonth: monthCutoff,
    lastCompleteQuarter: quarterCutoff,
    partialQuarterNote: partialQuarter
      ? `${quarterLabel(partialQuarter)} 출하는 스텔란티스 반기·연간 보도자료 공시 후 반영됩니다(분기 실적 발표는 Q1·H1·Q3·FY 4회만).`
      : null,
  };
}
