import CompanyKpiCards from '@/components/oem-companies/common/CompanyKpiCards';
import CompanyPowertrainMixChart from '@/components/oem-companies/common/CompanyPowertrainMixChart';
import CompanyTimeSeriesChart from '@/components/oem-companies/common/CompanyTimeSeriesChart';
import KiaDomesticByModelChart from '@/components/oem-companies/kia/KiaDomesticByModelChart';
import KiaExportRegionChart from '@/components/oem-companies/kia/KiaExportRegionChart';
import KiaExportTypeMixChart from '@/components/oem-companies/kia/KiaExportTypeMixChart';
import KiaFactoryChart from '@/components/oem-companies/kia/KiaFactoryChart';
import KiaRetailRegionChart from '@/components/oem-companies/kia/KiaRetailRegionChart';
import KiaTopModelsCard from '@/components/oem-companies/kia/KiaTopModelsCard';
import { getKiaData } from '@/lib/oem-companies/kia/source';

/** 기아(/oem/kia) 차종/공장/지역별 판매 대시보드 (월 데이터, 연/월 토글). */
export default async function KiaPage() {
  const data = await getKiaData();

  if (data.totalRows === 0) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <h2 className="text-base font-semibold">기아</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          월별 차종 + 해외 공장 + 지역별 수출 · 출처: worldwide.kia.com IR 라이브러리 엑셀
        </p>
        <div className="mt-6 rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm font-medium">데이터 수집 대기 중</p>
          <p className="mt-1 text-xs text-muted-foreground">
            최초 backfill 후 KPI · 시계열 · PT mix · 해외 공장별 · 지역별 수출 · 차종 TOP10이
            표시됩니다.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-base font-semibold">기아</h2>
        <p className="text-xs text-muted-foreground">
          월별 차종 + 해외 공장 + 지역별 수출 · 출처: worldwide.kia.com IR ·{' '}
          {data.totalRows.toLocaleString('ko-KR')}행 · 최신 수집{' '}
          {data.lastCollectedAt?.slice(0, 10) ?? '-'}
        </p>
      </div>

      <CompanyKpiCards kpi={data.kpi} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CompanyTimeSeriesChart
          monthly={data.monthlySeries}
          annual={data.annualSeries}
          title="출하량 추이 (도매 wholesale, 한국+해외 공장)"
        />
        <CompanyPowertrainMixChart
          monthly={data.monthlyPtMix}
          annual={data.annualPtMix}
          title="PowerTrain Mix (출하 기준 · EV 매핑)"
        />
      </div>

      {/* 지역별 판매량 (retail) — 공장별 출하 앞에 위치 (사용자 명시) */}
      <KiaRetailRegionChart
        monthly={data.monthlyRetailRegions}
        annual={data.annualRetailRegions}
        title="지역별 판매량 (retail · 12 region, 현지판매실적)"
        footer="현지판매실적.xlsx · 12 region(Korea/U.S.A/Canada/Mexico/Europe/Eastern Europe/Latin America/Middle East/Africa/Asia Pacific/India/China) × plant. 도매 출하(wholesale)와 달리 실제 소비자 인도 시점 기준. ⚠️ IR이 현지판매실적을 2024년부터 게시 — 2021~2023은 데이터 없음(빈 막대), 도매 출하(kia_sales)는 2021부터 가용."
        hideLabelsOnMonth
      />

      <KiaFactoryChart
        monthly={data.monthlyFactory}
        annual={data.annualFactory}
        hideLabelsOnMonth
      />

      {/* 국내 내수 출하 — 한국 출하 → 지역별 수출 앞에 위치 (사용자 명시) */}
      <KiaDomesticByModelChart
        monthly={data.monthlyDomesticByModel}
        annual={data.annualDomesticByModel}
        title="국내 내수 출하 (모델별 stacked · 도매 wholesale)"
        footer="차종별판매실적.xlsx Domestic section · 한국 시장 도매 출하. TOP12 모델 + Others 합산. 진행 중 연도는 'YYYY YTD'."
        hideLabelsOnMonth
      />

      <KiaExportRegionChart
        monthly={data.monthlyExportRegions}
        annual={data.annualExportRegions}
        title="한국 출하 → 지역별 수출 (export-by-region)"
        footer="지역별수출실적.xlsx · 한국 공장에서 수출된 차량의 region 분해 (sales-by-model '수출' Total과 동일 합계) · 2024년은 IR이 1~10월만 게시함 (출처 자체 누락, 11~12월 데이터 없음) · 진행 중 연도는 'YYYY YTD'로 별도 표시"
        hideLabelsOnMonth
      />

      <KiaExportTypeMixChart
        monthly={data.monthlyExportTypeMix}
        annual={data.annualExportTypeMix}
        title="수출 차종 Type Mix (승용/RV/상용/특장/CKD)"
        footer="지역별수출실적.xlsx · 차종 type 8종을 6 카테고리로 정규화 (CKD는 일반/특장 분리, 2024+). 2021~2022는 CKD 통합 표기 → 일반으로 합산."
      />

      {/* 차종 TOP10 — 출하량(wholesale) ↔ 판매량(retail) 토글 + plant 드롭다운 */}
      <KiaTopModelsCard
        wholesaleByFactory={data.topModelsByFactory}
        retailByPlant={data.topRetailByPlant}
        factoryOptions={data.factoryOptions}
        retailPlants={data.retailPlants}
        latestPeriodLabel={data.kpi.latestYearLabel.replace(/\s*실적\s*$/, '')}
        prevPeriodLabel={data.kpi.prevYearLabel.replace(/\s*실적\s*$/, '')}
        ytdPeriodLabel={data.kpi.ytdLabel}
      />
    </div>
  );
}
