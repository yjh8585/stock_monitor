import UzbekistanBrandSeriesChart from '@/components/oem-companies/uzbekistan/UzbekistanBrandSeriesChart';
import UzbekistanCompanyMonthlyChart from '@/components/oem-companies/uzbekistan/UzbekistanCompanyMonthlyChart';
import UzbekistanModelYearChart from '@/components/oem-companies/uzbekistan/UzbekistanModelYearChart';
import UzbekistanModelYearTable from '@/components/oem-companies/uzbekistan/UzbekistanModelYearTable';
import UzbekistanProductionDimensionChart from '@/components/oem-companies/uzbekistan/UzbekistanProductionDimensionChart';
import UzbekistanShareDimensionChart from '@/components/oem-companies/uzbekistan/UzbekistanShareDimensionChart';
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

      {/* 판매 점유율 — 판매 차트 바로 아래 (100% stacked, 회사/브랜드 토글) */}
      {data.companySalesShare.length > 0 && (
        <UzbekistanShareDimensionChart
          byBrand={data.salesShareByBrand}
          byCompany={data.companySalesShare}
          title="판매 점유율 (uzavtosanoat · 회사/브랜드 토글)"
          footer="uzavtosanoat.uz 보도자료 YTD 누계(연 누계). 회사 기준: UzAuto Motors / Khorezm Auto / ADM Jizzakh / BYD Uzbekistan Factory / SamAuto / Asaka Motors 등. 브랜드 기준: Chevrolet(UzAuto+Khorezm) / BYD / KIA·Chery·Haval(=ADM Jizzakh, 회사 합산이라 브랜드 분해 불가) / 그 외는 회사명 유지."
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

      {/* 연간 생산 — 차종(stat.uz) 기준, 회사/브랜드 토글 stacked (생산 KPI 카드 아래) */}
      {(data.productionByBrandYear.length > 0 || data.productionByCompanyYear.length > 0) && (
        <UzbekistanProductionDimensionChart
          byBrand={data.productionByBrandYear}
          byCompany={data.productionByCompanyYear}
          title="연간 생산 (차종 기준 · 회사/브랜드 토글)"
          footer="출처: stat.uz 통계위 만년 보도자료(차종별 생산, 2021~2025). 회사 기준: Chevrolet(Damas/Labo=Khorezm Auto, 그 외=UzAuto Motors) / BYD=BYD Uzbekistan Factory / KIA·Chery·Haval=ADM Jizzakh / LADA·Tank=기타. 범례를 끄면 합계가 따라 변동."
        />
      )}

      {/* 시장점유율 (생산 기준) — 차종(stat.uz) 기준, 회사/브랜드 토글 100% stacked */}
      {(data.productionShareByBrand.length > 0 || data.productionShareByCompany.length > 0) && (
        <UzbekistanShareDimensionChart
          byBrand={data.productionShareByBrand}
          byCompany={data.productionShareByCompany}
          title="시장점유율 (생산 기준)"
          footer="출처: stat.uz 통계위 만년 보도자료(차종별 생산, 2021~2025) 연도별 100% 정규화. 회사 기준 매핑은 '연간 생산' 차트와 동일."
        />
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

      {/* 차종별 연간 생산량 — 연도 드롭다운 + 전년 동기 비교 */}
      <UzbekistanModelYearChart
        compare={data.productionModelCompare}
        title="차종별 연간 생산량 (stat.uz · 모델별, 전년 비교)"
        footer="출처: stat.uz 통계위 보도자료. 드롭다운으로 연도 선택 → 차종별로 당해·전년을 나란히 비교. 최신 연도는 YTD(1~N월)이며 전년도 같은 기간(1~N월)과 비교. 호버 시 YoY 표시."
      />
    </div>
  );
}
