import CompanyKpiCards from '@/components/oem-companies/common/CompanyKpiCards';
import CompanyPowertrainMixChart from '@/components/oem-companies/common/CompanyPowertrainMixChart';
import CompanyTimeSeriesChart from '@/components/oem-companies/common/CompanyTimeSeriesChart';
import CompanyTopModelsTable, {
  type FactoryOption,
} from '@/components/oem-companies/common/CompanyTopModelsTable';
import HyundaiEuRetailChart from '@/components/oem-companies/hyundai/HyundaiEuRetailChart';
import HyundaiEuRetailTopCard from '@/components/oem-companies/hyundai/HyundaiEuRetailTopCard';
import HyundaiExportRegionChart from '@/components/oem-companies/hyundai/HyundaiExportRegionChart';
import HyundaiFactoryChart from '@/components/oem-companies/hyundai/HyundaiFactoryChart';
import HyundaiFactoryModelMixChart from '@/components/oem-companies/hyundai/HyundaiFactoryModelMixChart';
import HyundaiIRRegionsChart from '@/components/oem-companies/hyundai/HyundaiIRRegionsChart';
import HyundaiMarketShareChart from '@/components/oem-companies/hyundai/HyundaiMarketShareChart';
import HyundaiQuarterlyEarningsChart from '@/components/oem-companies/hyundai/HyundaiQuarterlyEarningsChart';
import { HyundaiRetailWholesaleRegionCard } from '@/components/oem-companies/hyundai/HyundaiRetailWholesaleCard';
import HyundaiUsRetailTopCard from '@/components/oem-companies/hyundai/HyundaiUsRetailTopCard';
import HyundaiVehicleTypeMixChart from '@/components/oem-companies/hyundai/HyundaiVehicleTypeMixChart';
import { getHyundaiData } from '@/lib/oem-companies/hyundai/source';

/** IR 정합성 요약 문구 — IR Regions 통합 차트 footer. */
function buildIrFooterText(
  latestYear: string | null,
  latestIr: number,
  latestDb: number,
  latestDiff: number,
  latestPct: number | null
): string {
  const base =
    '연간(ir-summary, 9 region 도매 합) ↔ 분기(ir-quarterly, IR PDF p.5~6 region 분기 도매)를 토글로 비교. 단위: 연간=대, 분기=천대. 2021-2022는 8 region(러시아 포함).';
  if (latestYear == null) return base;
  const fmt = (n: number) => n.toLocaleString('ko-KR');
  const pct = latestPct == null ? '' : ` (${latestPct >= 0 ? '+' : ''}${latestPct.toFixed(3)}%)`;
  const match =
    Math.abs(latestDiff) < 1000
      ? '거의 일치'
      : `${latestDiff >= 0 ? '+' : ''}${fmt(latestDiff)}대${pct}`;
  return `${base} · 정합성(연간): ${latestYear}년 IR ${fmt(latestIr)}대 vs DB ${fmt(latestDb)}대 — ${match}`;
}

/** 현대차 차종/공장별 판매 대시보드 (월 데이터, 연/월 토글). */
export default async function HyundaiPage() {
  const data = await getHyundaiData();

  if (data.totalRows === 0) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <h2 className="text-base font-semibold">현대차</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          월별 차종 판매 + 해외 공장별 판매 · 출처: hyundai.com IR 자료실 엑셀
        </p>
        <div className="mt-6 rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm font-medium">데이터 수집 대기 중</p>
          <p className="mt-1 text-xs text-muted-foreground">
            최초 backfill 후 KPI · 시계열 · PT mix · 해외 공장별 · 차종 TOP10이 표시됩니다.
          </p>
        </div>
      </div>
    );
  }

  const irFooter = buildIrFooterText(
    data.irComparison.latestYear,
    data.irComparison.latestIrTotal,
    data.irComparison.latestDbTotal,
    data.irComparison.latestDiff,
    data.irComparison.latestDiffPct
  );

  // CompanyTopModelsTable의 factoryOptions 형식으로 변환 (#7 region 분기 포함).
  const factoryOptions: Record<string, FactoryOption> = {};
  for (const [code, entry] of Object.entries(data.topModels.factories)) {
    factoryOptions[code] = entry.regions
      ? { result: entry.result, regions: entry.regions }
      : entry.result;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-base font-semibold">현대차</h2>
        <p className="text-xs text-muted-foreground">
          월별 차종 판매 + 해외 공장별 · 출처: hyundai.com IR ·{' '}
          {data.totalRows.toLocaleString('ko-KR')}행 · 최신 수집{' '}
          {data.lastCollectedAt?.slice(0, 10) ?? '-'}
        </p>
      </div>

      <CompanyKpiCards kpi={data.kpi} />

      <HyundaiQuarterlyEarningsChart data={data.quarterlyEarnings} annual={data.annualEarnings} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CompanyTimeSeriesChart
          monthly={data.monthlySeries}
          annual={data.annualSeries}
          title="출하량 추이 (도매 wholesale, 한국+해외 공장)"
        />
        <CompanyPowertrainMixChart
          monthly={data.monthlyPtMix}
          annual={data.annualPtMix}
          title="PowerTrain Mix (출하 기준)"
        />
      </div>

      <HyundaiVehicleTypeMixChart
        monthly={data.monthlyVehicleTypeMix}
        annual={data.annualVehicleTypeMix}
        title="차종 Type Mix (PC/RV/Genesis/CV)"
      />

      {/* C2 v2 — 국내 공장 출하 추이 (내수+수출 stacked). factory='' AND region IN ('내수','수출'). */}
      <HyundaiExportRegionChart
        monthly={data.monthlyKoreaPlantStack}
        annual={data.annualKoreaPlantStack}
        title="국내 공장 출하량 (내수 출하 + 수출 출하)"
        footer="한국 공장 ex-factory shipment = 내수(한국 시장 도매) + 수출(전 해외 도매). 진행 중 연도는 'YYYY YTD'로 별도 표시."
        showTotalLabels
        hideLabelsOnMonth
      />

      {/* 배치: 국내 공장 → 한국 출하 → 해외 공장 (사용자 명시). */}
      <HyundaiExportRegionChart
        monthly={data.monthlyExportRegions}
        annual={data.annualExportRegions}
        title="한국 출하 → 지역별 수출 (export-by-region)"
        footer="hmc-export-by-region.xlsx · 한국 공장에서 수출된 차량의 세부 지역별 분해 (sales-by-model의 '수출' Total과 동일 합계, 도매 출하 기준) · 진행 중 연도는 'YYYY YTD'로 별도 표시"
        showTotalLabels
        hideLabelsOnMonth
      />

      <HyundaiFactoryChart monthly={data.monthlyFactory} annual={data.annualFactory} />

      {/* #8 — IR 9 region 연간 + 분기 ir-quarterly 통합 (동일 데이터의 두 형태). */}
      <HyundaiIRRegionsChart
        annual={data.irSummary}
        quarterly={data.quarterlyRegions}
        footer={irFooter}
      />

      <HyundaiFactoryModelMixChart
        dataByYear={data.factoryModelMixByYear}
        availableYears={data.factoryModelMixYears}
        latestYearLabel={data.kpi.latestYearLabel}
      />

      <CompanyTopModelsTable
        dataAll={data.topModels.all}
        dataKoreaShip={data.topModels.domestic}
        koreaShipRegions={[
          { value: '내수', label: '내수', result: data.topModels.내수 },
          { value: '수출', label: '수출', result: data.topModels.수출 },
        ]}
        allRegions={data.topModelsAllRegions}
        factoryOptions={factoryOptions}
        title="차종 TOP10 (도매 출하 기준 · 전체=한국+해외 공장, 국내=한국 공장 ex-factory, 공장별 region 분기 가능)"
        latestPeriodLabel={data.kpi.latestYearLabel.replace(/\s*실적\s*$/, '')}
        prevPeriodLabel={data.kpi.prevYearLabel.replace(/\s*실적\s*$/, '')}
        ytdPeriodLabel={data.kpi.ytdLabel}
      />

      {/* C8 v2 — 사용자 명시 순서: 미국 row 전체 → 유럽 row 전체. */}

      {/* 1) 미국 (HMA) — Retail vs Wholesale */}
      <HyundaiRetailWholesaleRegionCard
        region="US"
        label="미국 (HMA)"
        defaultCard={data.retailWholesale.us}
        byYear={data.retailWholesaleByYear.us}
        years={data.usRetailYears}
      />

      {/* 2) 미국 시장 점유율 (월별) — 한 줄 단독 */}
      <HyundaiMarketShareChart data={data.usMarketShare} />

      {/* 3) 미국 retail 차종 TOP10 — 한 줄 단독 */}
      <HyundaiUsRetailTopCard byYear={data.usRetailTopByYear} years={data.usRetailYears} />

      {/* 4) 유럽 (HME) — Retail vs Wholesale */}
      <HyundaiRetailWholesaleRegionCard
        region="EU"
        label="유럽 (HME)"
        defaultCard={data.retailWholesale.eu}
        byYear={data.retailWholesaleByYear.eu}
        years={data.euRetailYears}
      />

      {/* 5) 유럽 retail 월별 추이 + 6) 유럽 차종 TOP10 */}
      <HyundaiEuRetailChart data={data.euRetail} />
      <HyundaiEuRetailTopCard byYear={data.euRetailTopByYear} years={data.euRetailYears} />
    </div>
  );
}
