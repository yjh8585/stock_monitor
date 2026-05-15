'use client';

import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import type {
  ModelMonthlySeries,
  OemModelOutlook,
  OemSalesGroupMonth,
  OemSalesGroupPtMonth,
  OemSalesTypeSegMonth,
} from '@/lib/types';
import type { UsaOemTimeSeriesData } from './UsaOemTrendChart';
import KpiCards from './KpiCards';
import ModelOutlookCards from './ModelOutlookCards';
import { findLatestYm } from './helpers';
import type { CountryTop15Row } from './CountryTop15';
import type { OemCountryMatrix } from './OemCountryHeatmap';

const YTD_YEAR = 2026;

// 차트 컴포넌트는 모두 recharts 의존 — 클라이언트 번들 최소화 위해 동적 import.
// KpiCards는 가벼운 div 카드라 정적 import.
const ChartFallback = () => (
  <div className="h-[220px] md:h-[400px] bg-muted/20 animate-pulse rounded" />
);

const MarketTrendChart = dynamic(() => import('./MarketTrendChart'), {
  ssr: false,
  loading: ChartFallback,
});
const Top30YtdChart = dynamic(() => import('./Top30YtdChart'), {
  ssr: false,
  loading: ChartFallback,
});
const Top40YearlyTable = dynamic(() => import('./Top40YearlyTable'), {
  ssr: false,
  loading: ChartFallback,
});
const Top10AnnualBars = dynamic(() => import('./Top10AnnualBars'), {
  ssr: false,
  loading: ChartFallback,
});
const Top10MonthlyLines = dynamic(() => import('./Top10MonthlyLines'), {
  ssr: false,
  loading: ChartFallback,
});
const PowertrainMix = dynamic(() => import('./PowertrainMix'), {
  ssr: false,
  loading: ChartFallback,
});
const PowertrainTopOems = dynamic(() => import('./PowertrainTopOems'), {
  ssr: false,
  loading: ChartFallback,
});
const CountryTop15 = dynamic(() => import('./CountryTop15'), {
  ssr: false,
  loading: ChartFallback,
});
const EvLeadersChart = dynamic(() => import('./EvLeadersChart'), {
  ssr: false,
  loading: ChartFallback,
});
const YoyWinnersLosers = dynamic(() => import('./YoyWinnersLosers'), {
  ssr: false,
  loading: ChartFallback,
});
const TypeSegmentChart = dynamic(() => import('./TypeSegmentChart'), {
  ssr: false,
  loading: ChartFallback,
});
const OemCountryHeatmap = dynamic(() => import('./OemCountryHeatmap'), {
  ssr: false,
  loading: ChartFallback,
});
const ModelNorthAmericaCharts = dynamic(() => import('./ModelNorthAmericaCharts'), {
  ssr: false,
  loading: ChartFallback,
});
const UsaOemTrendChart = dynamic(() => import('./UsaOemTrendChart'), {
  ssr: false,
  loading: ChartFallback,
});

interface Props {
  groupMonth: OemSalesGroupMonth[];
  groupPtMonth: OemSalesGroupPtMonth[];
  typeSegMonth: OemSalesTypeSegMonth[];
  countryTop15: CountryTop15Row[];
  oemCountryMatrix: OemCountryMatrix;
  usaOemSeries: UsaOemTimeSeriesData;
  naModelSeries: ModelMonthlySeries[];
  outlooks: OemModelOutlook[];
}

/** 13개 차트 섹션을 위→아래 순차로 배치 (+ 북미 차종 콤보 차트/AI 평가 카드) */
export default function OemDashboard({
  groupMonth,
  groupPtMonth,
  typeSegMonth,
  countryTop15,
  oemCountryMatrix,
  usaOemSeries,
  naModelSeries,
  outlooks,
}: Props) {
  const latestMonth2026 = useMemo(() => {
    const ym = findLatestYm(groupMonth, YTD_YEAR);
    return ym ? ym % 100 : null;
  }, [groupMonth]);
  const ytdSuffix = latestMonth2026 ? ` (1~${latestMonth2026}월)` : '';

  return (
    <div className="px-6 py-4 space-y-6 max-w-[1600px] mx-auto">
      <Section title="글로벌 시장 한눈에" subtitle={`연간 합계 + YoY · 2026 YTD${ytdSuffix}`}>
        <KpiCards groupMonth={groupMonth} />
      </Section>

      <Section title="글로벌 월별 판매량 추이" subtitle="2020.01~ 전체 시장 합계">
        <MarketTrendChart groupMonth={groupMonth} />
      </Section>

      <Section title={`2026 YTD${ytdSuffix} TOP30`} subtitle="누적 판매량 + 전년 동기 대비 YoY">
        <Top30YtdChart groupMonth={groupMonth} />
      </Section>

      <Section title="2025 TOP40 — 순위 등락" subtitle="2024 vs 2025 비교">
        <Top40YearlyTable groupMonth={groupMonth} />
      </Section>

      <Section title="TOP10 OEM 연간 판매량" subtitle="2020~2026 연도별 비교">
        <Top10AnnualBars groupMonth={groupMonth} />
      </Section>

      <Section title="TOP10 OEM 월별 판매량 추이" subtitle="시간별 점유 변화">
        <Top10MonthlyLines groupMonth={groupMonth} />
      </Section>

      <Section title="PowerTrain Mix 추이" subtitle="ICE/HV/PHEV/EV/FCV 시장 점유율 변화">
        <PowertrainMix groupPtMonth={groupPtMonth} />
      </Section>

      <Section title="PowerTrain별 OEM TOP10" subtitle="각 PowerTrain에서 강한 OEM (2025년)">
        <PowertrainTopOems groupPtMonth={groupPtMonth} />
      </Section>

      <Section title="국가별 판매량 TOP15" subtitle="2025년 시장 규모">
        <CountryTop15 rows={countryTop15} />
      </Section>

      <Section
        title="EV 대전 — TOP10 EV 판매량 + EV 비율"
        subtitle="2025년 EV+PHEV 합계 / 전체 대비 비율"
      >
        <EvLeadersChart groupPtMonth={groupPtMonth} />
      </Section>

      <Section title="YoY 승자와 패자" subtitle="2024→2025 성장률 TOP10 / BOTTOM10">
        <YoyWinnersLosers groupMonth={groupMonth} />
      </Section>

      <Section title="시장 차종 구조" subtitle="Type/Segment별 비중 (2025년)">
        <TypeSegmentChart typeSegMonth={typeSegMonth} />
      </Section>

      <Section
        title="TOP10 OEM × TOP10 국가 매트릭스"
        subtitle="OEM이 어느 국가에서 강한가 (2025년)"
      >
        <OemCountryHeatmap data={oemCountryMatrix} />
      </Section>

      <Section
        title="미국 시장 OEM TOP10 월별 추이"
        subtitle="과거~현재 시계열 · 판매량(대) + 미국 전체 대비 점유율 · 클릭으로 ON/OFF"
      >
        <UsaOemTrendChart series={usaOemSeries} />
      </Section>

      <Section title="북미 핵심 차종 월별 판매 추이" subtitle="USA · 막대=판매량 / 라인=YoY %">
        <ModelNorthAmericaCharts series={naModelSeries} />
      </Section>

      <Section
        title="북미 핵심 차종 — AI 시장 평가"
        subtitle="Claude Haiku 4.5 종합 판단 (주 1회 자동 갱신)"
      >
        <ModelOutlookCards outlooks={outlooks} />
      </Section>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card overflow-hidden">
      <header className="px-4 py-3 border-b border-border bg-muted/30">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
