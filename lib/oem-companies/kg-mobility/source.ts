/**
 * KG모빌리티(/oem/kg-mobility) 데이터 입구 — fetch + 'use cache' + aggregate 오케스트레이션.
 *
 * 페이지(`app/oem/kg-mobility/page.tsx`)는 `getKgMobilityData()`만 호출하면 된다.
 * - kg_mobility_sales fetch (전체, 페이지네이션)
 * - vehicle_powertrain_map fetch (company_slug='kg-mobility' 필터)
 * - 메모리에서 PT 매핑 join → aggregate 5종 호출 → 작은 props로 반환
 *
 * 사전 가공 함수는 `./aggregate`. 단위 테스트는 `./aggregate.test.ts`.
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
  KgMobilitySaleRow,
  VehiclePowertrainMapRow,
} from '@/lib/types';
import {
  aggregateAnnualSeries,
  aggregateKgRegionSeries,
  aggregateKgRegionSeriesAnnual,
  aggregateKpi,
  aggregateMonthlySeries,
  aggregatePtMix,
  aggregatePtMixAnnual,
  aggregateTopModels,
  attachPowertrains,
  type KgRegionSeriesPoint,
} from './aggregate';

export type { KgRegionSeriesPoint } from './aggregate';

const COMPANY_SLUG = 'kg-mobility' as const;
const SUPABASE_PAGE_SIZE = 1000;

type AnonClient = ReturnType<typeof createSupabaseAnonClient>;

/** Supabase 한 번 select에 max 1000행 → range 페이지네이션. */
async function fetchAllKgSales(
  supabase: AnonClient
): Promise<(KgMobilitySaleRow & { collected_at: string })[]> {
  const all: (KgMobilitySaleRow & { collected_at: string })[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('kg_mobility_sales')
      .select('*')
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) {
      logger.error({ err: error }, 'kg_mobility_sales 조회 실패');
      throw new Error(`kg_mobility_sales: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as (KgMobilitySaleRow & { collected_at: string })[]));
    if (data.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return all;
}

async function fetchKgPowertrainMap(supabase: AnonClient): Promise<VehiclePowertrainMapRow[]> {
  const { data, error } = await supabase
    .from('vehicle_powertrain_map')
    .select('*')
    .eq('company_slug', COMPANY_SLUG);
  if (error) {
    logger.error({ err: error }, 'vehicle_powertrain_map 조회 실패 — 빈 배열 반환');
    return [];
  }
  return (data ?? []) as unknown as VehiclePowertrainMapRow[];
}

/** 페이지 props 묶음. 모두 사전 가공된 작은 객체 → 클라이언트 전달.
 *  3개 시계열 차트(시계열·PT mix·region)는 월/연 토글을 위해 양쪽 데이터를 모두 제공.
 */
export interface KgMobilityPageData {
  kpi: CompanyKpiSummary;
  monthlySeries: CompanyTimeSeriesPoint[];
  annualSeries: CompanyTimeSeriesPoint[];
  monthlyPtMix: CompanyPtMixPoint[];
  annualPtMix: CompanyPtMixPoint[];
  monthlyRegionSeries: KgRegionSeriesPoint[];
  annualRegionSeries: KgRegionSeriesPoint[];
  /** TOP10 region 토글 — 전체/내수/수출 사전 가공 (rows + 회사 전체 합계 비중 계산용) */
  topModelsAll: CompanyTopModelsResult;
  topModelsDomestic: CompanyTopModelsResult;
  topModelsExport: CompanyTopModelsResult;
  /** 데이터 0행이면 페이지에서 "수집 대기" 안내 표시 */
  totalRows: number;
  /** 최신 수집 시각 (페이지 footer 표시용) */
  lastCollectedAt: string | null;
}

export async function getKgMobilityData(): Promise<KgMobilityPageData> {
  'use cache';
  cacheLife('hours');
  cacheTag('oem-kg-mobility-sales');
  cacheTag('vehicle-powertrain-map');

  const supabase = createSupabaseAnonClient();
  const [salesRows, ptMap] = await Promise.all([
    fetchAllKgSales(supabase),
    fetchKgPowertrainMap(supabase),
  ]);

  const withPt = attachPowertrains(salesRows, ptMap);

  // 최신 collected_at
  const lastCollectedAt = salesRows.reduce<string | null>(
    (max, r) => (max == null || r.collected_at > max ? r.collected_at : max),
    null
  );

  return {
    kpi: aggregateKpi(withPt),
    monthlySeries: aggregateMonthlySeries(withPt),
    annualSeries: aggregateAnnualSeries(withPt),
    monthlyPtMix: aggregatePtMix(withPt),
    annualPtMix: aggregatePtMixAnnual(withPt),
    monthlyRegionSeries: aggregateKgRegionSeries(withPt),
    annualRegionSeries: aggregateKgRegionSeriesAnnual(withPt),
    topModelsAll: aggregateTopModels(withPt, 10, 'all'),
    topModelsDomestic: aggregateTopModels(withPt, 10, '내수'),
    topModelsExport: aggregateTopModels(withPt, 10, '수출'),
    totalRows: salesRows.length,
    lastCollectedAt,
  };
}
