import CompanyKpiCards from '@/components/oem-companies/common/CompanyKpiCards';
import CompanyTopModelsTable from '@/components/oem-companies/common/CompanyTopModelsTable';
import StellantisNaBrandMixChart from '@/components/oem-companies/stellantis-na/StellantisNaBrandMixChart';
import StellantisNaPtMixChart from '@/components/oem-companies/stellantis-na/StellantisNaPtMixChart';
import StellantisNaQuarterlySeriesChart from '@/components/oem-companies/stellantis-na/StellantisNaQuarterlySeriesChart';
import { STELLANTIS_NA_BRANDS } from '@/lib/oem-companies/stellantis-na/aggregate';
import { getStellantisNaData } from '@/lib/oem-companies/stellantis-na/source';

/**
 * Stellantis NA (FCA US LLC) 분기 판매 대시보드.
 * 출처: prnewswire.com FCA US LLC publisher의 분기당 1개 보도자료 HTML.
 * 데이터: stellantis_na_sales (분기 데이터만, 단일 region='US').
 */
export default async function StellantisNaPage() {
  const data = await getStellantisNaData();

  if (data.totalRows === 0) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h2 className="text-base font-semibold">Stellantis USA</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          분기별 차종 판매 · 출처: prnewswire.com FCA US LLC 보도자료
        </p>
        <div className="mt-6 rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm font-medium">데이터 수집 대기 중</p>
          <p className="mt-1 text-xs text-muted-foreground">
            최초 backfill 후 KPI · 분기 추이 · 브랜드 mix · PT mix · 차종 TOP10이 표시됩니다.
          </p>
        </div>
      </div>
    );
  }

  // brand 1단계 드롭다운 — 'all' + 6 brand. region 2단계 없음 (단일 'US').
  const brandFilterOptions = STELLANTIS_NA_BRANDS.map((b) => ({
    value: b,
    label: b,
    result: data.topModels.brands[b],
  }));

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-base font-semibold">Stellantis USA (FCA US LLC)</h2>
        <p className="text-xs text-muted-foreground">
          분기별 brand·차종 미국 총 판매 (소매+플릿, 최종고객 인도 기준) · 출처: prnewswire.com
          보도자료 · {data.totalRows.toLocaleString('ko-KR')}행 · 최신 수집{' '}
          {data.lastCollectedAt?.slice(0, 10) ?? '-'} · 단일 region=US (캐나다 미수집) · brand
          6종(Jeep/Ram/Chrysler/Dodge/Fiat/Alfa Romeo, Maserati 별도)
        </p>
      </div>

      <CompanyKpiCards kpi={data.kpi} />

      <StellantisNaQuarterlySeriesChart
        quarterly={data.quarterlyBrandStack}
        annual={data.annualBrandStack}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <StellantisNaBrandMixChart
          quarterly={data.quarterlyBrandStack}
          annual={data.annualBrandStack}
        />
        <StellantisNaPtMixChart quarterly={data.quarterlyPtMix} annual={data.annualPtMix} />
      </div>

      <CompanyTopModelsTable
        dataAll={data.topModels.all}
        flatRegions={brandFilterOptions}
        title="차종 TOP10 (미국 총 판매 · brand 필터)"
        latestPeriodLabel={data.kpi.latestYearLabel.replace(/\s*실적\s*$/, '')}
        prevPeriodLabel={data.kpi.prevYearLabel.replace(/\s*실적\s*$/, '')}
        ytdPeriodLabel={data.kpi.ytdLabel}
        hideUnifiedNote
      />
      <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
        ※ 2024년 데이터에는{' '}
        <span className="font-medium text-foreground">Ram LD PU / Ram HD PU</span>가 분리 표기되지
        않고 통합 표기 &quot;Ram P/U&quot; 합계 약{' '}
        <span className="font-medium text-foreground">373,120</span>대로 보고됨 (2024년부터 LD/HD
        분리). 분리 표기 이후 연도(2025+)와 직접 비교 시 참고.
      </p>
      <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
        ※ <span className="font-medium text-foreground">Voyager</span>는 Pacifica의 하위 트림으로
        동일 차종이라 <span className="font-medium text-foreground">Pacifica에 합산</span>했다(보도
        자료도 2026Q2부터 통합 표기). 2026Q2부터 발행 주체가 FCA US LLC → Stellantis로 이관됨.
      </p>
    </div>
  );
}
