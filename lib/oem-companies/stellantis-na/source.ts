/**
 * Stellantis NA(/oem/stellantis-na) 데이터 입구 — fetch + 'use cache' + aggregate.
 *
 * KG(lib/oem-companies/kg-mobility/source.ts) / 현대(hyundai/source.ts) 패턴 따른다.
 * Stellantis 특이사항:
 *  - 분기 데이터만 (월 차원 없음).
 *  - 단일 region='US'.
 *  - 합계 행(brand='Total' or vehicle_model='Total')은 DB에 적재되지만 차트/KPI는 모델 행만 집계.
 *
 * 페이지(`app/oem/stellantis-na/page.tsx`)는 `getStellantisNaData()`만 호출한다.
 */
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import logger from '@/lib/logger';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import type {
  CompanyKpiSummary,
  CompanyPtMixPoint,
  CompanyTimeSeriesPoint,
  CompanyTopModelsResult,
  StellantisNaBrandStackPoint,
  StellantisNaSaleRow,
  VehiclePowertrainMapRow,
} from '@/lib/types';
import {
  aggregateAnnualBrandStack,
  aggregateAnnualSeries,
  aggregateKpi,
  aggregatePtMixAnnual,
  aggregatePtMixQuarterly,
  aggregateQuarterlyBrandStack,
  aggregateQuarterlySeries,
  aggregateTopModels,
  attachPowertrains,
  STELLANTIS_NA_BRANDS,
} from './aggregate';

const COMPANY_SLUG = 'stellantis-na' as const;
const SUPABASE_PAGE_SIZE = 1000;

type AnonClient = ReturnType<typeof createSupabaseAnonClient>;

/** Supabase 한 번 select에 max 1000행 → range 페이지네이션. */
async function fetchAllStellantisNaSales(
  supabase: AnonClient
): Promise<(StellantisNaSaleRow & { collected_at: string })[]> {
  const all: (StellantisNaSaleRow & { collected_at: string })[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('stellantis_na_sales')
      .select('*')
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) {
      logger.error({ err: error }, 'stellantis_na_sales 조회 실패');
      throw new Error(`stellantis_na_sales: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as (StellantisNaSaleRow & { collected_at: string })[]));
    if (data.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return all;
}

async function fetchStellantisNaPowertrainMap(
  supabase: AnonClient
): Promise<VehiclePowertrainMapRow[]> {
  const { data, error } = await supabase
    .from('vehicle_powertrain_map')
    .select('*')
    .eq('company_slug', COMPANY_SLUG);
  if (error) {
    logger.error({ err: error }, 'vehicle_powertrain_map(stellantis-na) 조회 실패 — 빈 배열 반환');
    return [];
  }
  return (data ?? []) as unknown as VehiclePowertrainMapRow[];
}

/** TOP10 brand 필터별 사전 가공 (드롭다운 옵션 1:1 매핑). */
export interface StellantisNaTopModelsByBrand {
  all: CompanyTopModelsResult;
  /** brand 6종 → TOP10. 데이터 없는 brand는 EMPTY result. */
  brands: Record<string, CompanyTopModelsResult>;
}

/** 페이지 props 묶음. 모두 사전 가공된 작은 객체. */
export interface StellantisNaPageData {
  kpi: CompanyKpiSummary;
  /** 분기별 시계열 (X='25Q1') */
  quarterlySeries: CompanyTimeSeriesPoint[];
  /** 연도별 시계열 (X='2025') */
  annualSeries: CompanyTimeSeriesPoint[];
  /** 분기 brand stacked */
  quarterlyBrandStack: StellantisNaBrandStackPoint[];
  /** 연도 brand stacked */
  annualBrandStack: StellantisNaBrandStackPoint[];
  /** 분기 PT mix (100% stacked) */
  quarterlyPtMix: CompanyPtMixPoint[];
  /** 연 PT mix */
  annualPtMix: CompanyPtMixPoint[];
  /** TOP10 brand 필터별 (전체 + 6 brand) */
  topModels: StellantisNaTopModelsByBrand;
  /** 데이터 0행이면 페이지에서 "수집 대기" 안내 */
  totalRows: number;
  /** 최신 수집 시각 (페이지 footer 표시용) */
  lastCollectedAt: string | null;
}

export async function getStellantisNaData(): Promise<StellantisNaPageData> {
  'use cache';
  cacheLife('days');
  cacheTag('oem-stellantis-na-sales');
  cacheTag('vehicle-powertrain-map');

  const supabase = createSupabaseAnonClient();
  const [salesRows, ptMap] = await Promise.all([
    fetchAllStellantisNaSales(supabase),
    fetchStellantisNaPowertrainMap(supabase),
  ]);

  const withPt = attachPowertrains(salesRows, ptMap);

  const lastCollectedAt = salesRows.reduce<string | null>(
    (max, r) => (max == null || r.collected_at > max ? r.collected_at : max),
    null
  );

  // brand별 TOP10 사전 가공 (드롭다운 옵션 1:1)
  const brandTops: Record<string, CompanyTopModelsResult> = {};
  for (const brand of STELLANTIS_NA_BRANDS) {
    brandTops[brand] = aggregateTopModels(withPt, 10, brand);
  }
  const topModels: StellantisNaTopModelsByBrand = {
    all: aggregateTopModels(withPt, 10, 'all'),
    brands: brandTops,
  };

  return {
    kpi: aggregateKpi(withPt),
    quarterlySeries: aggregateQuarterlySeries(withPt),
    annualSeries: aggregateAnnualSeries(withPt),
    quarterlyBrandStack: aggregateQuarterlyBrandStack(withPt),
    annualBrandStack: aggregateAnnualBrandStack(withPt),
    quarterlyPtMix: aggregatePtMixQuarterly(withPt),
    annualPtMix: aggregatePtMixAnnual(withPt),
    topModels,
    totalRows: salesRows.length,
    lastCollectedAt,
  };
}
