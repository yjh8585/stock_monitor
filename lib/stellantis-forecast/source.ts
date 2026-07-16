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
  attachEventContext,
  buildCoxInventoryEvents,
  buildGapPoints,
  buildInventoryKpi,
  buildMonthlyFlow,
  buildNaProductionMonths,
  buildNaRetailMonths,
  buildNaRetailQuarters,
  buildProjectedGapQuarter,
  buildRetailKpi,
  buildRevenueKpi,
  buildShipmentsKpi,
  CHART_START_MONTH,
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

/**
 * Cox 브랜드별 미국 딜러 재고일수 (공개) — 공장 동향의 '재고' 이벤트 자동 생성용.
 *
 * 스텔란티스 4개 브랜드 + NATION(업계 평균)만 받는다(≈수십 행 → 페이지네이션 불필요).
 */
async function fetchCoxInventory(): Promise<CoxInventoryRow[]> {
  const supabase = createSupabaseAnonClient();
  const { data, error } = await supabase
    .from('cox_brand_inventory')
    .select('brand, year_month, days_supply, is_outlier_excluded, source_url')
    .in('brand', ['Jeep', 'Ram', 'Dodge', 'Chrysler', 'NATION'])
    .order('year_month', { ascending: true })
    .order('brand', { ascending: true });
  if (error) {
    logger.error({ err: error }, 'cox_brand_inventory 조회 실패');
    throw new Error(`Cox 재고일수 조회 실패: ${error.message}`);
  }
  return data ?? [];
}

export async function getStellantisForecastData(): Promise<StellantisForecastData> {
  'use cache';
  cacheLife('days');
  cacheTag('stellantis-shipments');
  cacheTag('oem_sales_model_country_month');
  cacheTag('oem_production_model_country_month');
  cacheTag('cox_brand_inventory');
  cacheTag('pnl_entries');

  const [shipments, retailRows, productionRows, revenue, coxRows] = await Promise.all([
    fetchShipments(),
    fetchNaRetail(),
    fetchNaProduction(),
    fetchRevenue(),
    fetchCoxInventory(),
  ]);

  // MarkLines는 국가별 도착 시점이 다르므로 3개국이 다 찬 기간까지만 쓴다 — 안 그러면
  // 소매·생산이 과소집계돼 갭이 허구가 된다(aggregate.ts lastCompleteMonth 주석 참고).
  const monthCutoff = lastCompleteMonth(productionRows, retailRows);
  const quarterCutoff = lastCompleteQuarter(retailRows);

  const retailMonths = buildNaRetailMonths(retailRows, monthCutoff);
  const productionMonths = buildNaProductionMonths(productionRows, monthCutoff);
  const retailQuarters = buildNaRetailQuarters(retailRows, quarterCutoff);

  // 차트 2는 차트 1(분기 출하, 2021-Q1~)과 시작 연도를 맞춰 2021.01부터 그린다(사용자 지시 2026-07-17).
  const monthlyFlow = buildMonthlyFlow(productionMonths, retailMonths, CHART_START_MONTH);
  const gap = buildGapPoints(shipments, retailQuarters);

  // 공장 동향의 '재고' 이벤트는 Cox 재고일수에서 자동 생성한다(사용자 지시 2026-07-17 — 재고만 자동).
  // 수동 큐레이션 '재고'(inventory) 항목이 이미 있는 달은 자동 생성을 건너뛴다(수동 우선, 중복 방지).
  const manualInventoryMonths = new Set(
    PLANT_EVENTS.filter((e) => e.eventType === 'inventory').map((e) => e.startYearMonth)
  );
  const coxInventoryEvents = buildCoxInventoryEvents(coxRows, manualInventoryMonths);

  // 진행 중인 최신 분기(출하는 IR로 왔지만 소매가 아직 국가별로 덜 도착)를 소매 일부 추정으로
  // 채워 차트 1에만 붙인다(사용자 결정 2026-07-16). KPI 신호등은 최신 신호 반영 위해 이 계열을 쓴다.
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

  // 재고 신호등은 차트 1이 보여주는 계열(실측 + 추정 최신 분기)로 판정 — 최신 신호를 반영한다.
  const gapForKpi = projected ? [...gap, projected.point] : gap;

  return {
    monthlyFlow,
    gap,
    gapProjected: projected?.point ?? null,
    projectedNote: projected?.note ?? null,
    kpiMetrics: [
      buildRetailKpi(retailMonths),
      buildShipmentsKpi(shipments),
      buildRevenueKpi(revenue),
    ],
    kpiInventory: buildInventoryKpi(gapForKpi),
    // 공장 이벤트는 코드 상수(수동 큐레이션)이고, '재고'(딜러 재고일수)는 Cox DB에서 자동 생성한다.
    // 둘을 합쳐 재고 국면 컨텍스트를 붙인다(최신순 정렬은 attachEventContext가 담당).
    events: attachEventContext([...PLANT_EVENTS, ...coxInventoryEvents], monthlyFlow),
    lastCompleteMonth: monthCutoff,
    lastCompleteQuarter: quarterCutoff,
    partialQuarterNote: partialQuarter
      ? `${quarterLabel(partialQuarter)} 출하는 스텔란티스 반기·연간 보도자료 공시 후 반영됩니다(분기 실적 발표는 Q1·H1·Q3·FY 4회만).`
      : null,
  };
}
