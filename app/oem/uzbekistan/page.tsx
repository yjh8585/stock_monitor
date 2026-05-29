import UzbekistanBrandSeriesChart from '@/components/oem-companies/uzbekistan/UzbekistanBrandSeriesChart';
import UzbekistanCompanyMonthlyChart from '@/components/oem-companies/uzbekistan/UzbekistanCompanyMonthlyChart';
import UzbekistanProductionYearChart from '@/components/oem-companies/uzbekistan/UzbekistanProductionYearChart';
import UzbekistanShareChart from '@/components/oem-companies/uzbekistan/UzbekistanShareChart';
import { getUzbekistanData } from '@/lib/oem-companies/uzbekistan/source';

/**
 * 우즈베키스탄 자동차 시장 대시보드 (PR6).
 * 데이터: uzbekistan_auto_stats (kind=sales|production, source_type=uzavtosanoat|stat-uz).
 */
export default async function UzbekistanPage() {
  const data = await getUzbekistanData();

  if (data.totalRows === 0) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h2 className="text-base font-semibold">우즈베키스탄 자동차 시장</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          uzavtosanoat.uz 회사별 sales (매월) + stat.uz brand·model production (분기)
        </p>
        <div className="mt-6 rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm font-medium">데이터 수집 대기 중</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-base font-semibold">우즈베키스탄 자동차 시장</h2>
        <p className="text-xs text-muted-foreground">
          출처: uzavtosanoat.uz · 회사별 sales (매월 보도자료, YTD 차분) + 연간 production
          (Statistical info) · {data.totalRows.toLocaleString('ko-KR')}행 · 최신 수집{' '}
          {data.lastCollectedAt?.slice(0, 10) ?? '-'} · 회사 6개: UzAuto Motors / Khorezm Auto / ADM
          Jizzakh / BYD Uzbekistan Factory / SamAuto / Asaka Motors
        </p>
      </div>

      {/* KPI 카드 */}
      {data.kpi.latestYearLabel && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs text-muted-foreground">{data.kpi.latestYearLabel} 합계 (sales)</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {data.kpi.totalLatestYear.toLocaleString('ko-KR')}
              <span className="ml-1 text-sm text-muted-foreground">대</span>
            </p>
            {data.kpi.yoyPct != null && (
              <p
                className={`mt-1 text-sm tabular-nums ${
                  data.kpi.yoyPct > 0 ? 'text-emerald-600' : 'text-rose-600'
                }`}
              >
                {data.kpi.yoyPct > 0 ? '+' : ''}
                {data.kpi.yoyPct.toFixed(1)}% YoY vs {data.kpi.prevYearLabel}
              </p>
            )}
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs text-muted-foreground">{data.kpi.prevYearLabel} 합계 (sales)</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {data.kpi.totalPrevYear.toLocaleString('ko-KR')}
              <span className="ml-1 text-sm text-muted-foreground">대</span>
            </p>
          </div>
          {data.kpi.ytdLabel && (
            <div className="rounded-lg border border-border p-4">
              <p className="text-xs text-muted-foreground">{data.kpi.ytdLabel} (sales)</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {data.kpi.ytdLatest.toLocaleString('ko-KR')}
                <span className="ml-1 text-sm text-muted-foreground">대</span>
              </p>
            </div>
          )}
        </div>
      )}

      {/* 회사별 sales (월/연 토글) */}
      <UzbekistanCompanyMonthlyChart
        monthly={data.monthlyByCompany}
        annual={data.annualByCompany}
        title="회사별 sales (월/연 토글 · 6 enterprises stacked)"
        footer="uzavtosanoat.uz 매월 14~18일 보도자료의 YTD 누계를 차분 → 월별 도출. 일부 월 보도자료가 timeout으로 누락될 수 있음 (별도 재수집 시 보완). 차분 결과 음수는 발표 정정/조정으로 가정."
      />

      {/* 연간 production (Statistical info) */}
      {data.productionAnnualByBrand.length > 0 && (
        <UzbekistanProductionYearChart
          annual={data.productionAnnualByBrand}
          title="연간 생산 (uzavtosanoat Statistical Info · brand별)"
          footer="출처: uzavtosanoat.uz/en/page/statistical_information_and_analysis · 2016~2025 연간. Chevrolet (천대 → 대) / BYD (2024~) / LCV (Light Commercial Vehicles) / Engines (천대 → 대)."
        />
      )}

      {/* Production KPI 카드 4장 */}
      {data.productionKpi.chevroletLatest > 0 && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs text-muted-foreground">
              Chevrolet 생산 {data.productionKpi.chevroletLatestLabel}
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {data.productionKpi.chevroletLatest.toLocaleString('ko-KR')}
              <span className="ml-1 text-sm text-muted-foreground">대</span>
            </p>
            {data.productionKpi.chevroletYoy != null && (
              <p
                className={`mt-1 text-xs tabular-nums ${
                  data.productionKpi.chevroletYoy > 0 ? 'text-emerald-600' : 'text-rose-600'
                }`}
              >
                {data.productionKpi.chevroletYoy > 0 ? '+' : ''}
                {data.productionKpi.chevroletYoy.toFixed(1)}% YoY
              </p>
            )}
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs text-muted-foreground">
              BYD 생산 {data.productionKpi.bydLatestLabel}
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {data.productionKpi.bydLatest.toLocaleString('ko-KR')}
              <span className="ml-1 text-sm text-muted-foreground">대</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">2024 신규 진입</p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs text-muted-foreground">자동차 합 (Chev+BYD)</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {data.productionKpi.carTotalLatest.toLocaleString('ko-KR')}
              <span className="ml-1 text-sm text-muted-foreground">대</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {data.productionKpi.chevroletLatestLabel}
            </p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs text-muted-foreground">
              엔진 생산 {data.productionKpi.enginesLatestLabel}
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {data.productionKpi.enginesLatest.toLocaleString('ko-KR')}
              <span className="ml-1 text-sm text-muted-foreground">대</span>
            </p>
            {data.productionKpi.enginesYoy != null && (
              <p
                className={`mt-1 text-xs tabular-nums ${
                  data.productionKpi.enginesYoy > 0 ? 'text-emerald-600' : 'text-rose-600'
                }`}
              >
                {data.productionKpi.enginesYoy > 0 ? '+' : ''}
                {data.productionKpi.enginesYoy.toFixed(1)}% YoY
              </p>
            )}
          </div>
        </div>
      )}

      {/* 자동차 brand share (Chevrolet vs BYD 100%) + 회사 sales share */}
      {(data.carBrandShare.length > 0 || data.companySalesShare.length > 0) && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {data.carBrandShare.length > 0 && (
            <UzbekistanShareChart
              data={data.carBrandShare}
              title="자동차 brand 점유율 (Chevrolet vs BYD, 100%)"
              footer="uzavtosanoat.uz Statistical Info 연간 production · BYD 2024 신규 진입 후 점유율 변화."
            />
          )}
          {data.companySalesShare.length > 0 && (
            <UzbekistanShareChart
              data={data.companySalesShare}
              title="회사별 sales 점유율 (uzavtosanoat, 100%)"
              footer="uzavtosanoat.uz 보도자료 YTD 누계 (연 누계). 6 회사: UzAuto Motors / Khorezm Auto / ADM Jizzakh / BYD Uzbekistan Factory / SamAuto / Asaka Motors."
            />
          )}
        </div>
      )}

      {/* Chevrolet 10년 시계열 + Engines */}
      {data.chevroletSeries.length > 0 && (
        <UzbekistanBrandSeriesChart
          data={data.chevroletSeries}
          title="Chevrolet 연간 생산 시계열 (2016~2025, YoY)"
          color="#2563eb"
          footer="uzavtosanoat.uz Statistical Info · CHEVROLET cars 연간 production (천대 단위 → 대 환산). YoY는 우측 축."
        />
      )}
      {data.enginesSeries.length > 0 && (
        <UzbekistanBrandSeriesChart
          data={data.enginesSeries}
          title="엔진 연간 생산 시계열 (2016~2025, YoY)"
          color="#7c3aed"
          footer="uzavtosanoat.uz Statistical Info · Engines 연간 production. UzAuto Motors Powertrain 등 엔진 생산 합계."
        />
      )}

      {/* stat.uz 월별 production (모델별) */}
      {data.statUzMonthlyByModel.length > 0 && (
        <UzbekistanProductionYearChart
          annual={data.statUzMonthlyByModel}
          title="stat.uz 월별 production (모델별 stacked · 1~N월 YTD 차분)"
          footer="출처: stat.uz 산업 보도자료 PDF (매월 25~26일 1~N월 YTD 누계 발표) → YTD 차분으로 월별 도출. Chevrolet=Cobalt/Damas/Labo/Tracker/Onix, KIA/Chery/Haval/BYD는 brand 자체. Грузовые автомобили = LCV. 첫 발표 데이터는 평균 분할로 적재 (1월 발표 이전이면 1~N월 균등)."
        />
      )}
    </div>
  );
}
