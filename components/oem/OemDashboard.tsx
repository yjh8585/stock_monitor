'use client';

import type {
  OemSalesGroupCountryMonth,
  OemSalesGroupMonth,
  OemSalesGroupPtMonth,
  OemSalesTypeSegMonth,
} from '@/lib/types';
import KpiCards from './KpiCards';
import MarketTrendChart from './MarketTrendChart';
import Top30YtdChart from './Top30YtdChart';
import Top40YearlyTable from './Top40YearlyTable';
import Top10AnnualBars from './Top10AnnualBars';
import Top10MonthlyLines from './Top10MonthlyLines';
import PowertrainMix from './PowertrainMix';
import PowertrainTopOems from './PowertrainTopOems';
import CountryTop15 from './CountryTop15';
import EvLeadersChart from './EvLeadersChart';
import YoyWinnersLosers from './YoyWinnersLosers';
import TypeSegmentChart from './TypeSegmentChart';
import OemCountryHeatmap from './OemCountryHeatmap';

interface Props {
  groupMonth: OemSalesGroupMonth[];
  groupPtMonth: OemSalesGroupPtMonth[];
  groupCountryMonth: OemSalesGroupCountryMonth[];
  typeSegMonth: OemSalesTypeSegMonth[];
}

/** 13개 차트 섹션을 위→아래 순차로 배치 */
export default function OemDashboard({
  groupMonth,
  groupPtMonth,
  groupCountryMonth,
  typeSegMonth,
}: Props) {
  return (
    <div className="px-6 py-4 space-y-6 max-w-[1600px] mx-auto">
      <Section title="글로벌 시장 한눈에" subtitle="연간 합계 + YoY · 2026 YTD">
        <KpiCards groupMonth={groupMonth} />
      </Section>

      <Section title="글로벌 월별 판매량 추이" subtitle="2020.01~ 전체 시장 합계">
        <MarketTrendChart groupMonth={groupMonth} />
      </Section>

      <Section title="2026 YTD TOP30" subtitle="누적 판매량 + 전년 동기 대비 YoY">
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
        <CountryTop15 groupCountryMonth={groupCountryMonth} />
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
        <OemCountryHeatmap groupCountryMonth={groupCountryMonth} />
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
