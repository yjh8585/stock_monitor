import UzbekistanBrandSeriesChart from '@/components/oem-companies/uzbekistan/UzbekistanBrandSeriesChart';
import UzbekistanCompanyMonthlyChart from '@/components/oem-companies/uzbekistan/UzbekistanCompanyMonthlyChart';
import UzbekistanModelYearTable from '@/components/oem-companies/uzbekistan/UzbekistanModelYearTable';
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
          출처: uzavtosanoat.uz (회사별 판매, 매월 보도자료 YTD 차분) + stat.uz (모델별 생산 YTD) +
          연간 생산(Statistical info) · {data.totalRows.toLocaleString('ko-KR')}행 · 최신 수집{' '}
          {data.lastCollectedAt?.slice(0, 10) ?? '-'} · 판매 회사 {data.companies.length}개:{' '}
          {data.companies.join(' / ')}
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
          {data.kpi.prevYearLabel && (
            <div className="rounded-lg border border-border p-4">
              <p className="text-xs text-muted-foreground">{data.kpi.prevYearLabel} 합계 (sales)</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {data.kpi.totalPrevYear.toLocaleString('ko-KR')}
                <span className="ml-1 text-sm text-muted-foreground">대</span>
              </p>
            </div>
          )}
          {data.kpi.ytdLabel && (
            <div className="rounded-lg border border-border p-4">
              <p className="text-xs text-muted-foreground">{data.kpi.ytdLabel} (sales, YTD)</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {data.kpi.ytdLatest.toLocaleString('ko-KR')}
                <span className="ml-1 text-sm text-muted-foreground">대</span>
              </p>
              {data.kpi.ytdYoyPct != null && (
                <p
                  className={`mt-1 text-sm tabular-nums ${
                    data.kpi.ytdYoyPct > 0 ? 'text-emerald-600' : 'text-rose-600'
                  }`}
                >
                  {data.kpi.ytdYoyPct > 0 ? '+' : ''}
                  {data.kpi.ytdYoyPct.toFixed(1)}% YoY vs 전년 동기
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* 회사별 sales (월/연 토글) */}
      <UzbekistanCompanyMonthlyChart
        monthly={data.monthlyByCompany}
        annual={data.annualByCompany}
        title="회사별 판매 (월/연 토글 · stacked)"
        footer="uzavtosanoat.uz 보도자료의 YTD 누계('реализовано'/'продано' = 판매)를 차분해 월별 도출. 중간 보도가 없는 달은 인접 발표의 증분을 구간 월수로 균등 분배(예: 6월 미발표 시 7월 발표분을 6·7월로 분배). 연초 첫 발표가 N월이면 1~N월 균등 분배. 생산('выпущено') 보도는 별도(생산 데이터)로 분리."
      />

      {/* 연간 production (Statistical info) */}
      {data.productionAnnualByBrand.length > 0 && (
        <UzbekistanProductionYearChart
          annual={data.productionAnnualByBrand}
          title="연간 생산 (uzavtosanoat Statistical Info · brand별)"
          footer="출처: uzavtosanoat.uz/en/page/statistical_information_and_analysis · 2016~2025 연간. Chevrolet (천대 → 대) / BYD (2024~) / LCV (Light Commercial Vehicles). 엔진(Powertrain)은 완성차가 아니므로 제외."
        />
      )}

      {/* Production KPI 카드 3장 (완성차만 — 엔진 제외) */}
      {data.productionKpi.chevroletLatest > 0 && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
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

      {/* Chevrolet 10년 시계열 (엔진 제외 — 완성차만) */}
      {data.chevroletSeries.length > 0 && (
        <UzbekistanBrandSeriesChart
          data={data.chevroletSeries}
          title="Chevrolet 연간 생산 시계열 (2016~2025, YoY)"
          color="#2563eb"
          footer="uzavtosanoat.uz Statistical Info · CHEVROLET cars 연간 production (천대 단위 → 대 환산). YoY는 우측 축."
        />
      )}

      {/* 차종별 생산량 연도별 표 (만년 + 최신 YTD) */}
      <UzbekistanModelYearTable
        data={data.productionModelYearTable}
        title="차종별 생산량 (연도별 + 최신연도 YTD)"
        footer="출처: stat.uz 통계위 보도자료(news-of-committee, 모델별 생산). 만년이 발표된 해(예: 2025)는 연간, 진행 중인 해는 최신 누계(1~N월 YTD). YoY는 동기간 기준. 'Damas/Labo'=Damas+특수승용 합산, 'Tank 500'=GWM. 수입(국가별) 항목은 제외."
      />

      {/* 차종(모델)별 생산량 — 연간 grouped */}
      {data.productionByModel.length > 0 && (
        <UzbekistanProductionYearChart
          annual={data.productionByModel}
          grouped
          title="차종별 연간 생산량 (stat.uz · 모델별)"
          footer="출처: stat.uz 통계위 보도자료. 모델을 x축으로 연간 생산량 비교(만년 발표연도만 — 현재 2025). 추가 연도 만년 기사가 수집되면 자동으로 다개년 grouped 비교로 표시."
        />
      )}

      {/* stat.uz 차종별 월별 생산 추이 */}
      {data.statUzMonthlyByModel.length > 0 && (
        <UzbekistanProductionYearChart
          annual={data.statUzMonthlyByModel}
          title="차종별 월별 생산 추이 (stat.uz · 모델별 stacked)"
          footer="출처: stat.uz 통계위 보도자료(월별 1~N월 누계 발표)를 차분해 월별 도출. Chevrolet=Cobalt/Damas-Labo/Tracker/Onix, KIA/Chery/Haval/BYD/Tank는 brand 자체. 중간 미발표월은 인접 발표 증분을 균등 분배."
        />
      )}
    </div>
  );
}
