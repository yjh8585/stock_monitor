/**
 * 현대차(/oem/hyundai) 데이터 입구 — fetch + 'use cache' + aggregate 오케스트레이션.
 *
 * KG(lib/oem-companies/kg-mobility/source.ts)와 동일 패턴.
 * 회사별 보강: 해외 공장별 stacked bar 데이터 (factoryMonthly/factoryAnnual).
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
  FactoryModelMixPoint,
  HyundaiAnnualEarningsPoint,
  HyundaiEuRetailData,
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
  HyundaiVehicleTypeMixPoint,
  VehiclePowertrainMapRow,
} from '@/lib/types';
import {
  aggregateAnnualSeries,
  aggregateHyundaiAnnualEarnings,
  aggregateHyundaiEuRetail,
  aggregateHyundaiExportRegions,
  aggregateHyundaiFactoryMix,
  aggregateHyundaiFactoryMixAnnual,
  aggregateHyundaiFactoryModelMix,
  aggregateHyundaiIRSummary,
  aggregateHyundaiKoreaPlantAnnualStack,
  aggregateHyundaiKoreaPlantMonthlyStack,
  aggregateHyundaiQuarterlyEarnings,
  aggregateHyundaiRetailTopResult,
  aggregateHyundaiQuarterlyRegions,
  aggregateHyundaiRetailWholesale,
  aggregateHyundaiShipmentBreakdown,
  aggregateHyundaiUsMarketShare,
  aggregateHyundaiUsRetail,
  aggregateHyundaiVehicleTypeMix,
  aggregateHyundaiVehicleTypeMixAnnual,
  type HyundaiShipmentBreakdownRow,
  aggregateKpi,
  aggregateMonthlySeries,
  aggregatePtMix,
  aggregatePtMixAnnual,
  aggregateTopModels,
  attachPowertrains,
  listAllRegions,
  listFactoryCodes,
  listFactoryModelMixYears,
  listRegionsForFactory,
  listRetailYears,
  summarizeIRComparison,
} from './aggregate';

const COMPANY_SLUG = 'hyundai' as const;
const SUPABASE_PAGE_SIZE = 1000;

type AnonClient = ReturnType<typeof createSupabaseAnonClient>;

async function fetchAllHyundaiSales(
  supabase: AnonClient
): Promise<(HyundaiSaleRow & { collected_at: string })[]> {
  const all: (HyundaiSaleRow & { collected_at: string })[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('hyundai_sales')
      .select('*')
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) {
      logger.error({ err: error }, 'hyundai_sales 조회 실패');
      throw new Error(`hyundai_sales: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as (HyundaiSaleRow & { collected_at: string })[]));
    if (data.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return all;
}

async function fetchExportRegions(supabase: AnonClient): Promise<HyundaiExportRegionRow[]> {
  const { data, error } = await supabase
    .from('hyundai_export_regions')
    .select('period_type,year_period,source,region_name,sales_units')
    .range(0, 9999);
  if (error) {
    logger.error({ err: error }, 'hyundai_export_regions 조회 실패 — 빈 배열 반환');
    return [];
  }
  return (data ?? []) as unknown as HyundaiExportRegionRow[];
}

async function fetchHyundaiPowertrainMap(supabase: AnonClient): Promise<VehiclePowertrainMapRow[]> {
  const { data, error } = await supabase
    .from('vehicle_powertrain_map')
    .select('*')
    .eq('company_slug', COMPANY_SLUG);
  if (error) {
    logger.error({ err: error }, 'vehicle_powertrain_map(hyundai) 조회 실패 — 빈 배열 반환');
    return [];
  }
  return (data ?? []) as unknown as VehiclePowertrainMapRow[];
}

async function fetchQuarterlyEarnings(
  supabase: AnonClient
): Promise<HyundaiQuarterlyEarningsRow[]> {
  const { data, error } = await supabase
    .from('hyundai_quarterly_earnings')
    .select(
      'fiscal_year,fiscal_quarter,period_end_date,revenue_krw_bn,revenue_auto_krw_bn,revenue_finance_krw_bn,revenue_other_krw_bn,operating_income_krw_bn,operating_margin_pct,net_income_krw_bn,ebitda_krw_bn,global_wholesale_k_units,global_retail_k_units,domestic_wholesale_k_units,overseas_wholesale_k_units,ev_k_units,hev_k_units,phev_k_units,fcev_k_units,eco_total_k_units'
    )
    .order('fiscal_year', { ascending: true })
    .order('fiscal_quarter', { ascending: true });
  if (error) {
    logger.error({ err: error }, 'hyundai_quarterly_earnings 조회 실패 — 빈 배열 반환');
    return [];
  }
  return (data ?? []) as unknown as HyundaiQuarterlyEarningsRow[];
}

async function fetchRetailSales(supabase: AnonClient): Promise<HyundaiRetailSaleRow[]> {
  const all: HyundaiRetailSaleRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('hyundai_retail_sales')
      .select(
        'period_type,year_period,region,vehicle_type,vehicle_model,retail_units,market_share,industry_total'
      )
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) {
      logger.error({ err: error }, 'hyundai_retail_sales 조회 실패 — 빈 배열 반환');
      return [];
    }
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as HyundaiRetailSaleRow[]));
    if (data.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return all;
}

/** 한 공장 옵션의 데이터 — 기본 result + region 분기 (CompanyTopModelsTable.FactoryOption와 동일 형태). */
export interface HyundaiFactoryTopModelsEntry {
  result: CompanyTopModelsResult;
  /** 공장 내부 region 분기 (예: '내수'/'수출'). 데이터 존재하는 것만. 비어있으면 undefined. */
  regions?: { value: string; label: string; result: CompanyTopModelsResult }[];
}

/** TOP10 차종 표의 옵션별 사전 가공 결과 묶음 (드롭다운 옵션 1:1 매핑).
 *  - 'all' / 'domestic' / '내수' / '수출' + 각 해외 공장 코드 */
export interface HyundaiTopModelsByOption {
  all: CompanyTopModelsResult;
  domestic: CompanyTopModelsResult;
  내수: CompanyTopModelsResult;
  수출: CompanyTopModelsResult;
  /** 해외 공장 코드 → {result, regions?}. 데이터 없는 공장은 키 없음. region 분기는 데이터 존재할 때만 채워짐. */
  factories: Record<string, HyundaiFactoryTopModelsEntry>;
}

export interface HyundaiPageData {
  kpi: CompanyKpiSummary;
  monthlySeries: CompanyTimeSeriesPoint[];
  annualSeries: CompanyTimeSeriesPoint[];
  monthlyPtMix: CompanyPtMixPoint[];
  annualPtMix: CompanyPtMixPoint[];
  monthlyFactory: FactoryMixPoint[];
  annualFactory: FactoryMixPoint[];
  /** TOP10 차종 — 드롭다운 옵션별 사전 가공. */
  topModels: HyundaiTopModelsByOption;
  /** 1단계 '전체' 모드에서 사용 가능한 region 분기 (#7). 데이터 존재하는 region만. */
  topModelsAllRegions: { value: string; label: string; result: CompanyTopModelsResult }[];
  /** 해외 공장 코드 목록 (정렬, 데이터 존재). */
  factoryCodes: string[];
  /** 공장별 차종 mix — 연도별 사전 가공 (드롭다운 옵션 1:1). */
  factoryModelMixByYear: Record<string, FactoryModelMixPoint[]>;
  /** 공장별 차종 mix 가용 연도 (드롭다운 옵션). 오름차순. */
  factoryModelMixYears: string[];
  /** PC/RV/Genesis/CV/Other 분류 mix (월/연 토글) */
  monthlyVehicleTypeMix: HyundaiVehicleTypeMixPoint[];
  annualVehicleTypeMix: HyundaiVehicleTypeMixPoint[];
  /** 국내 내수 판매 추이 (factory='' AND region='내수' 한정, 월/연 토글) — C2 (deprecated, koreaPlantStack 사용 권장) */
  monthlyDomesticSeries: CompanyTimeSeriesPoint[];
  annualDomesticSeries: CompanyTimeSeriesPoint[];
  /** 국내 공장 출하 stacked (내수/수출 누적, 월/연 토글) — C2 v2 */
  monthlyKoreaPlantStack: HyundaiExportRegionPoint[];
  annualKoreaPlantStack: HyundaiExportRegionPoint[];
  /** export-by-region (한국 → 세부 region, 월/연 토글). 진행 중 연도는 'YYYY YTD' 라벨로 별도. */
  monthlyExportRegions: HyundaiExportRegionPoint[];
  annualExportRegions: HyundaiExportRegionPoint[];
  /** IR summary (사이트 9 region 연 합계) */
  irSummary: HyundaiExportRegionPoint[];
  /** Phase 2E — 분기별 IR region 도매 (천대, ir-quarterly) */
  quarterlyRegions: HyundaiQuarterlyRegionPoint[];
  /** IR vs DB 정합성 요약 (9-region 차트 footer에 직렬화) */
  irComparison: HyundaiIRComparisonSummary;
  /** Phase 2B — 분기별 IR 실적 (매출 + opm) */
  quarterlyEarnings: HyundaiQuarterlyEarningsPoint[];
  /** Phase 2D — 연간 IR 실적 (분기 합산 + 가중평균 opm). 진행 연도는 YTD. */
  annualEarnings: HyundaiAnnualEarningsPoint[];
  /** Phase 2C — US/EU retail vs wholesale 비교 카드 (기본=최근 완료 연도) */
  retailWholesale: HyundaiRetailWholesaleData;
  /** 연도별 retail vs wholesale 사전 가공 (#9 연도 드롭다운).
   *  US/EU 각각 연도→카드. 빈 연도는 키 없음. */
  retailWholesaleByYear: {
    us: Record<string, HyundaiRetailWholesaleRegionCard>;
    eu: Record<string, HyundaiRetailWholesaleRegionCard>;
  };
  /** US retail 데이터에 등장하는 연도 목록 (오름차순) — 드롭다운용. */
  usRetailYears: string[];
  /** EU retail 데이터에 등장하는 연도 목록 (오름차순) */
  euRetailYears: string[];
  /** Phase 2C — US 시장 점유율 시계열 (월별) */
  usMarketShare: HyundaiMarketSharePoint[];
  /** Phase 2C — EU 월별 retail 추이 + 차종 TOP. industry/share 없음. (기본=최근 완료 연도 TOP10) */
  euRetail: HyundaiEuRetailData;
  /** 연도별 EU retail TOP10 사전 가공 (#9). */
  euRetailByYear: Record<string, HyundaiEuRetailData>;
  /** 출하량 누적 (내수/수출/해외) — 사용자 명시 가로 막대. */
  shipmentBreakdown: HyundaiShipmentBreakdownRow[];
  /** Phase 2D — US retail 차종 TOP10 (Total/Industry/MarketShare 제외). 시계열은 MarketShareChart 참조. */
  usRetail: HyundaiEuRetailData;
  /** 연도별 US retail TOP10 사전 가공 (#9). */
  usRetailByYear: Record<string, HyundaiEuRetailData>;
  /** retail TOP10 통일 양식 — CompanyTopModelsTable 호환. 연도별 사전 가공. */
  usRetailTopByYear: Record<string, CompanyTopModelsResult>;
  euRetailTopByYear: Record<string, CompanyTopModelsResult>;
  totalRows: number;
  lastCollectedAt: string | null;
}

export async function getHyundaiData(): Promise<HyundaiPageData> {
  'use cache';
  cacheLife('days');
  cacheTag('oem-hyundai-sales');
  cacheTag('oem-hyundai-export-regions');
  cacheTag('oem-hyundai-quarterly');
  cacheTag('oem-hyundai-retail');
  cacheTag('vehicle-powertrain-map');

  const supabase = createSupabaseAnonClient();
  const [salesRows, ptMap, exportRegionRows, quarterlyRows, retailRows] = await Promise.all([
    fetchAllHyundaiSales(supabase),
    fetchHyundaiPowertrainMap(supabase),
    fetchExportRegions(supabase),
    fetchQuarterlyEarnings(supabase),
    fetchRetailSales(supabase),
  ]);

  const withPt = attachPowertrains(salesRows, ptMap);

  const lastCollectedAt = salesRows.reduce<string | null>(
    (max, r) => (max == null || r.collected_at > max ? r.collected_at : max),
    null
  );

  const annualSeries = aggregateAnnualSeries(withPt);

  // 공장 코드 + 옵션별 TOP10 사전 가공 (드롭다운 1:1).
  // #7: 각 해외 공장별 region(내수/수출) 분기도 가용 데이터가 있는 한 함께 계산.
  const factoryCodes = listFactoryCodes(withPt);
  const factoryTops: Record<string, HyundaiFactoryTopModelsEntry> = {};
  for (const code of factoryCodes) {
    const result = aggregateTopModels(withPt, 10, code);
    const regionValues = listRegionsForFactory(withPt, code);
    const regions = regionValues
      .filter((r) => r === '내수' || r === '수출')
      .map((r) => ({
        value: r,
        label: r,
        result: aggregateTopModels(withPt, 10, `factory:${code}:${r}`),
      }))
      .filter((entry) => entry.result.rows.length > 0);
    factoryTops[code] = regions.length > 0 ? { result, regions } : { result };
  }
  // #7: 1단계 '전체' 모드에서 사용 가능한 region 분기.
  const allRegionValues = listAllRegions(withPt)
    .filter((r) => r === '내수' || r === '수출')
    .map((r) => ({
      value: r,
      label: r,
      result: aggregateTopModels(withPt, 10, `all:${r}`),
    }))
    .filter((entry) => entry.result.rows.length > 0);

  const topModels: HyundaiTopModelsByOption = {
    all: aggregateTopModels(withPt, 10, 'all'),
    domestic: aggregateTopModels(withPt, 10, 'domestic'),
    내수: aggregateTopModels(withPt, 10, '내수'),
    수출: aggregateTopModels(withPt, 10, '수출'),
    factories: factoryTops,
  };

  // 공장×차종 mix 연도별 사전 가공 (#9)
  const factoryYears = listFactoryModelMixYears(withPt);
  const factoryModelMixByYear: Record<string, FactoryModelMixPoint[]> = {};
  for (const y of factoryYears) {
    factoryModelMixByYear[y] = aggregateHyundaiFactoryModelMix(withPt, 6, y);
  }

  return {
    kpi: aggregateKpi(withPt),
    monthlySeries: aggregateMonthlySeries(withPt),
    annualSeries,
    monthlyPtMix: aggregatePtMix(withPt),
    annualPtMix: aggregatePtMixAnnual(withPt),
    monthlyFactory: aggregateHyundaiFactoryMix(withPt),
    annualFactory: aggregateHyundaiFactoryMixAnnual(withPt),
    topModels,
    topModelsAllRegions: allRegionValues,
    factoryCodes,
    factoryModelMixByYear,
    factoryModelMixYears: factoryYears,
    monthlyVehicleTypeMix: aggregateHyundaiVehicleTypeMix(withPt),
    annualVehicleTypeMix: aggregateHyundaiVehicleTypeMixAnnual(withPt),
    monthlyDomesticSeries: aggregateMonthlySeries(withPt, 'domestic'),
    annualDomesticSeries: aggregateAnnualSeries(withPt, 'domestic'),
    monthlyKoreaPlantStack: aggregateHyundaiKoreaPlantMonthlyStack(withPt),
    annualKoreaPlantStack: aggregateHyundaiKoreaPlantAnnualStack(withPt),
    monthlyExportRegions: aggregateHyundaiExportRegions(exportRegionRows, 'month'),
    annualExportRegions: aggregateHyundaiExportRegions(exportRegionRows, 'annual'),
    irSummary: aggregateHyundaiIRSummary(exportRegionRows),
    quarterlyRegions: aggregateHyundaiQuarterlyRegions(exportRegionRows),
    irComparison: summarizeIRComparison(exportRegionRows, annualSeries),
    quarterlyEarnings: aggregateHyundaiQuarterlyEarnings(quarterlyRows),
    annualEarnings: aggregateHyundaiAnnualEarnings(quarterlyRows),
    retailWholesale: aggregateHyundaiRetailWholesale(retailRows, exportRegionRows),
    retailWholesaleByYear: {
      us: buildRetailWholesaleByYear(retailRows, exportRegionRows, 'US'),
      eu: buildRetailWholesaleByYear(retailRows, exportRegionRows, 'EU'),
    },
    shipmentBreakdown: aggregateHyundaiShipmentBreakdown(withPt),
    usRetailYears: listRetailYears(retailRows, 'US'),
    euRetailYears: listRetailYears(retailRows, 'EU'),
    usMarketShare: aggregateHyundaiUsMarketShare(retailRows),
    euRetail: aggregateHyundaiEuRetail(retailRows),
    euRetailByYear: buildRetailDataByYear(retailRows, 'EU'),
    usRetail: aggregateHyundaiUsRetail(retailRows),
    usRetailByYear: buildRetailDataByYear(retailRows, 'US'),
    usRetailTopByYear: buildRetailTopResultByYear(retailRows, 'US'),
    euRetailTopByYear: buildRetailTopResultByYear(retailRows, 'EU'),
    totalRows: salesRows.length,
    lastCollectedAt,
  };
}

/** US 또는 EU 의 retail vs wholesale 카드를 연도별로 사전 가공.
 *  데이터(retail 또는 wholesale)가 있는 연도만 키로 둔다. */
function buildRetailWholesaleByYear(
  retailRows: HyundaiRetailSaleRow[],
  irRows: HyundaiExportRegionRow[],
  region: 'US' | 'EU'
): Record<string, HyundaiRetailWholesaleRegionCard> {
  const years = listRetailYears(retailRows, region);
  const out: Record<string, HyundaiRetailWholesaleRegionCard> = {};
  for (const y of years) {
    const card =
      region === 'US'
        ? aggregateHyundaiRetailWholesale(retailRows, irRows, y).us
        : aggregateHyundaiRetailWholesale(retailRows, irRows, y).eu;
    if (card) out[y] = card;
  }
  return out;
}

/** US/EU retail TOP10 (HyundaiEuRetailData 형식) 을 연도별로 사전 가공. */
function buildRetailDataByYear(
  retailRows: HyundaiRetailSaleRow[],
  region: 'US' | 'EU'
): Record<string, HyundaiEuRetailData> {
  const years = listRetailYears(retailRows, region);
  const out: Record<string, HyundaiEuRetailData> = {};
  for (const y of years) {
    out[y] =
      region === 'US'
        ? aggregateHyundaiUsRetail(retailRows, y)
        : aggregateHyundaiEuRetail(retailRows, y);
  }
  return out;
}

/** retail TOP10 (CompanyTopModelsResult 양식) 을 연도별로 사전 가공 — 통일 표 양식용. */
function buildRetailTopResultByYear(
  retailRows: HyundaiRetailSaleRow[],
  region: 'US' | 'EU'
): Record<string, CompanyTopModelsResult> {
  const years = listRetailYears(retailRows, region);
  const out: Record<string, CompanyTopModelsResult> = {};
  for (const y of years) {
    out[y] = aggregateHyundaiRetailTopResult(retailRows, region, y);
  }
  return out;
}
