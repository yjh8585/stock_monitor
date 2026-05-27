import CompanyKpiCards from '@/components/oem-companies/common/CompanyKpiCards';
import CompanyPowertrainMixChart from '@/components/oem-companies/common/CompanyPowertrainMixChart';
import CompanyTimeSeriesChart from '@/components/oem-companies/common/CompanyTimeSeriesChart';
import CompanyTopModelsTable from '@/components/oem-companies/common/CompanyTopModelsTable';
import KgDomesticExportSplit from '@/components/oem-companies/kg-mobility/KgDomesticExportSplit';
import { getKgMobilityData } from '@/lib/oem-companies/kg-mobility/source';

/** KG모빌리티 차종별 판매 대시보드 (월 데이터, 연/월 토글). */
export default async function KgMobilityPage() {
  const data = await getKgMobilityData();

  if (data.totalRows === 0) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <h2 className="text-base font-semibold">KG모빌리티</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          월별 차종 판매 데이터 · 출처: kg-mobility.com IR 자료실 엑셀
        </p>
        <div className="mt-6 rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm font-medium">데이터 수집 대기 중</p>
          <p className="mt-1 text-xs text-muted-foreground">
            최초 backfill 후 KPI · 시계열 · PT mix · 차종 TOP10이 표시됩니다.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-base font-semibold">KG모빌리티</h2>
        <p className="text-xs text-muted-foreground">
          월별 차종 출하량 (도매 wholesale, 평택공장 ex-factory) · 출처: kg-mobility.com IR ·{' '}
          {data.totalRows.toLocaleString('ko-KR')}행 · 최신 수집{' '}
          {data.lastCollectedAt?.slice(0, 10) ?? '-'}
        </p>
      </div>

      <CompanyKpiCards kpi={data.kpi} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CompanyTimeSeriesChart
          monthly={data.monthlySeries}
          annual={data.annualSeries}
          title="출하량 추이 (도매 wholesale)"
        />
        <CompanyPowertrainMixChart
          monthly={data.monthlyPtMix}
          annual={data.annualPtMix}
          title="PowerTrain Mix (출하 기준)"
        />
      </div>

      <KgDomesticExportSplit monthly={data.monthlyRegionSeries} annual={data.annualRegionSeries} />

      <CompanyTopModelsTable
        dataAll={data.topModelsAll}
        flatRegions={[
          { value: '내수', label: '내수', result: data.topModelsDomestic },
          { value: '수출', label: '수출', result: data.topModelsExport },
        ]}
        title="차종 TOP10 (도매 출하 기준)"
        latestPeriodLabel={data.kpi.latestYearLabel.replace(/\s*실적\s*$/, '')}
        prevPeriodLabel={data.kpi.prevYearLabel.replace(/\s*실적\s*$/, '')}
        ytdPeriodLabel={data.kpi.ytdLabel}
        hideUnifiedNote
      />
      <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
        ※ 차종명 통일:{' '}
        <span className="font-medium text-foreground">
          R/Sports = Rexton Sports / R/Sports KHAN = Rexton Sports Khan / Musso sports / Musso Khan
        </span>{' '}
        는 모두 <span className="font-medium text-foreground">Musso</span>로 합산 (2026년 IR 표기
        통합 기준). Musso EV는 별도.
      </p>
    </div>
  );
}
