/**
 * 기아(/oem/kia) 데이터 입구 — fetch + 'use cache' + aggregate 오케스트레이션.
 *
 * 패턴: lib/oem-companies/hyundai/source.ts와 동일.
 * 회사별 보강: 5개 plant stacked + region(10) stacked + vehicle_type(6) 100% stacked.
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
  FactoryMixPoint,
  KiaExportRegionRow,
  KiaExportTypeMixPoint,
  KiaRetailSaleRow,
  KiaSaleRow,
  VehiclePowertrainMapRow,
} from '@/lib/types';
import {
  aggregateAnnualSeries,
  aggregateKiaDomesticByModel,
  aggregateKiaExportRegions,
  aggregateKiaExportTypeMix,
  aggregateKiaFactoryMix,
  aggregateKiaFactoryMixAnnual,
  aggregateKiaRetailKpi,
  aggregateKiaRetailRegions,
  aggregateKiaRetailTopModels,
  aggregateKiaShipmentBreakdown,
  aggregateKpi,
  aggregateMonthlySeries,
  aggregatePtMix,
  aggregatePtMixAnnual,
  aggregateTopModels,
  attachPowertrains,
  kiaTopPrevYearLabel,
  listEvModels,
  listRetailPlants,
  type KiaDomesticByModelPoint,
  type KiaExportRegionPoint,
  type KiaRetailRegionPoint,
  type ShipmentBreakdownRow,
} from './aggregate';

export type {
  KiaDomesticByModelPoint,
  KiaExportRegionPoint,
  KiaRetailRegionPoint,
  ShipmentBreakdownRow,
} from './aggregate';

const COMPANY_SLUG = 'kia' as const;
const SUPABASE_PAGE_SIZE = 1000;

type AnonClient = ReturnType<typeof createSupabaseAnonClient>;

async function fetchAllKiaSales(
  supabase: AnonClient
): Promise<(KiaSaleRow & { collected_at: string })[]> {
  const all: (KiaSaleRow & { collected_at: string })[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('kia_sales')
      .select('*')
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) {
      logger.error({ err: error }, 'kia_sales 조회 실패');
      throw new Error(`kia_sales: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as (KiaSaleRow & { collected_at: string })[]));
    if (data.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return all;
}

async function fetchKiaExportRegions(supabase: AnonClient): Promise<KiaExportRegionRow[]> {
  const all: KiaExportRegionRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('kia_export_regions')
      .select('period_type,year_period,source,region_name,vehicle_type,sales_units')
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) {
      logger.error({ err: error }, 'kia_export_regions 조회 실패 — 빈 배열 반환');
      return [];
    }
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as KiaExportRegionRow[]));
    if (data.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return all;
}

async function fetchKiaRetail(supabase: AnonClient): Promise<KiaRetailSaleRow[]> {
  const all: KiaRetailSaleRow[] = [];
  let from = 0;
  // kia_retail_sales 마이그레이션 20260527000005로 신규 추가. lib/database.types.ts
  // 재생성 전이라 타입 미존재 — `as never` 캐스트 (PostgrestQueryBuilder 인자 우회).
  // TODO: npm run supabase:types 후 캐스트 제거.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = supabase as unknown as { from: (t: string) => any };
  while (true) {
    const { data, error } = await client
      .from('kia_retail_sales')
      .select('period_type,year_period,plant,vehicle_model,region,retail_units')
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) {
      logger.error({ err: error }, 'kia_retail_sales 조회 실패 — 빈 배열 반환');
      return [];
    }
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as KiaRetailSaleRow[]));
    if (data.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return all;
}

async function fetchKiaPowertrainMap(supabase: AnonClient): Promise<VehiclePowertrainMapRow[]> {
  const { data, error } = await supabase
    .from('vehicle_powertrain_map')
    .select('*')
    .eq('company_slug', COMPANY_SLUG);
  if (error) {
    logger.error({ err: error }, 'vehicle_powertrain_map(kia) 조회 실패 — 빈 배열 반환');
    return [];
  }
  return (data ?? []) as unknown as VehiclePowertrainMapRow[];
}

export interface KiaPageData {
  kpi: CompanyKpiSummary;
  monthlySeries: CompanyTimeSeriesPoint[];
  annualSeries: CompanyTimeSeriesPoint[];
  monthlyPtMix: CompanyPtMixPoint[];
  annualPtMix: CompanyPtMixPoint[];
  /** PT mix에서 EV로 집계되는 차종 목록 (차트 주석용). */
  evModels: string[];
  /** 해외 공장 5종 stacked (월/연 토글). */
  monthlyFactory: FactoryMixPoint[];
  annualFactory: FactoryMixPoint[];
  /** 지역별 수출 10 region stacked (월/연 토글). 진행 연도는 'YYYY YTD'. */
  monthlyExportRegions: KiaExportRegionPoint[];
  annualExportRegions: KiaExportRegionPoint[];
  /** 수출 차종 type 6종 100% stacked (월/연 토글). */
  monthlyExportTypeMix: KiaExportTypeMixPoint[];
  annualExportTypeMix: KiaExportTypeMixPoint[];
  /** TOP10 차종 (도매 wholesale) — 전체 + 분류별. */
  topModelsAll: CompanyTopModelsResult;
  /** TOP10 by factory wholesale: { 'all': result, 'domestic': ..., 'U.S. Plant': ..., ... } */
  topModelsByFactory: Record<string, CompanyTopModelsResult>;
  /** 사용 가능 factory 목록 (드롭다운). 'all' + 'domestic'(한국 공장) + 해외 5개 plant. */
  factoryOptions: string[];
  /** TOP10 직전 완료연도 컬럼 라벨 ('2024.10' = 11~12월 차종 분해 미게재로 1~10월까지). */
  topModelsPrevLabel: string;
  topModelsPrevPartial: boolean;
  topModelsPrevLastMonth: number;

  // ============================================================
  // Retail (kia_retail_sales — 현지판매실적)
  // ============================================================
  /** retail KPI (전년 vs 최근 + YTD). */
  retailKpi: CompanyKpiSummary;
  /** 지역별 retail stacked (12 region · month/annual 토글). */
  monthlyRetailRegions: KiaRetailRegionPoint[];
  annualRetailRegions: KiaRetailRegionPoint[];
  /** TOP10 차종 (retail) — plant 필터별 (사용자 명시: 전체 + 해외 plant 5개). */
  topRetailByPlant: Record<string, CompanyTopModelsResult>;
  /** retail에 존재하는 plant 목록 (드롭다운). */
  retailPlants: string[];

  // ============================================================
  // 국내 내수 출하 모델별 stacked — kia_sales factory='' AND region='내수'
  // ============================================================
  monthlyDomesticByModel: KiaDomesticByModelPoint[];
  annualDomesticByModel: KiaDomesticByModelPoint[];
  /** 출하량 누적 (내수/수출/해외) — 사용자 명시 가로 막대. */
  shipmentBreakdown: ShipmentBreakdownRow[];
  totalRows: number;
  lastCollectedAt: string | null;
}

/** 기아 단일 진입점 — 캐시 + 모든 차트 props 한 번에 반환. */
export async function getKiaData(): Promise<KiaPageData> {
  'use cache';
  cacheLife('days');
  cacheTag('oem-kia-sales');
  cacheTag('oem-kia-export-regions');
  cacheTag('oem-kia-retail');
  cacheTag('vehicle-powertrain-map');

  const supabase = createSupabaseAnonClient();
  const [salesRows, ptMap, exportRegionRows, retailRows] = await Promise.all([
    fetchAllKiaSales(supabase),
    fetchKiaPowertrainMap(supabase),
    fetchKiaExportRegions(supabase),
    fetchKiaRetail(supabase),
  ]);

  const withPt = attachPowertrains(salesRows, ptMap);

  const lastCollectedAt = salesRows.reduce<string | null>(
    (max, r) => (max == null || r.collected_at > max ? r.collected_at : max),
    null
  );

  // 해외 plant 5개 (kia_sales factory 컬럼 기준 — 'CKD'/한국은 별도 'domestic'으로 묶음)
  const KIA_OVERSEAS_PLANTS = [
    'U.S. Plant',
    'China Plants',
    'Slovakia Plant',
    'Mexico Plant',
    'India Plant',
  ];
  const topModelsByFactory: Record<string, CompanyTopModelsResult> = {
    all: aggregateTopModels(withPt, 10, 'all'),
    domestic: aggregateTopModels(withPt, 10, 'domestic'),
  };
  for (const p of KIA_OVERSEAS_PLANTS) {
    topModelsByFactory[p] = aggregateTopModels(
      withPt.filter((r) => r.factory === p),
      10,
      'all'
    );
  }

  // retail plant 필터별 TOP10
  const retailPlants = listRetailPlants(retailRows);
  const topRetailByPlant: Record<string, CompanyTopModelsResult> = {
    all: aggregateKiaRetailTopModels(retailRows, 10, 'all'),
  };
  for (const p of retailPlants) {
    topRetailByPlant[p] = aggregateKiaRetailTopModels(retailRows, 10, p);
  }

  const topPrev = kiaTopPrevYearLabel(withPt);
  const evModels = listEvModels(withPt);
  return {
    kpi: aggregateKpi(withPt),
    monthlySeries: aggregateMonthlySeries(withPt),
    annualSeries: aggregateAnnualSeries(withPt),
    monthlyPtMix: aggregatePtMix(withPt),
    annualPtMix: aggregatePtMixAnnual(withPt),
    monthlyFactory: aggregateKiaFactoryMix(withPt),
    annualFactory: aggregateKiaFactoryMixAnnual(withPt),
    monthlyExportRegions: aggregateKiaExportRegions(exportRegionRows, 'month'),
    annualExportRegions: aggregateKiaExportRegions(exportRegionRows, 'annual'),
    monthlyExportTypeMix: aggregateKiaExportTypeMix(exportRegionRows, 'month'),
    annualExportTypeMix: aggregateKiaExportTypeMix(exportRegionRows, 'annual'),
    topModelsAll: topModelsByFactory.all,
    topModelsByFactory,
    factoryOptions: ['all', 'domestic', ...KIA_OVERSEAS_PLANTS],
    topModelsPrevLabel: topPrev.label,
    topModelsPrevPartial: topPrev.partial,
    topModelsPrevLastMonth: topPrev.lastMonth,
    evModels,
    // retail
    retailKpi: aggregateKiaRetailKpi(retailRows),
    monthlyRetailRegions: aggregateKiaRetailRegions(retailRows, 'month'),
    annualRetailRegions: aggregateKiaRetailRegions(retailRows, 'annual'),
    topRetailByPlant,
    retailPlants,
    // 국내 내수 출하 모델별
    monthlyDomesticByModel: aggregateKiaDomesticByModel(withPt, 'month'),
    annualDomesticByModel: aggregateKiaDomesticByModel(withPt, 'annual'),
    shipmentBreakdown: aggregateKiaShipmentBreakdown(withPt),
    totalRows: salesRows.length,
    lastCollectedAt,
  };
}
