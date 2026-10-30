'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { findLatestYm } from '@/components/oem/helpers';
import CompanyKpiCards from '@/components/oem-companies/common/CompanyKpiCards';
import CompanyPowertrainMixChart from '@/components/oem-companies/common/CompanyPowertrainMixChart';
import CompanyTopModelsTable from '@/components/oem-companies/common/CompanyTopModelsTable';
import KgDomesticExportSplit from '@/components/oem-companies/kg-mobility/KgDomesticExportSplit';
import UzbekistanDimensionToggle from '@/components/oem-companies/uzbekistan/UzbekistanDimensionToggle';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  EXPORT_TOP_MODELS,
  PRODUCTION_TOP_MODELS,
  type ChinaDim,
} from '@/lib/oem-companies/china/aggregate';
import type { ChinaData } from '@/lib/oem-companies/china/source';
import type { OemSalesGroupMonth } from '@/lib/types';

// 새 차트를 만들지 않고 「전체」 탭·회사 탭 차트를 그대로 쓴다(사용자 지시 2026-10-30 · 짝짓기 표 = 계획서 「화면」).
// recharts 차트는 클라이언트 번들에서만 — 전체 탭 OemDashboard 와 같은 lazy 패턴(chart-guide §6 제안 5)
const ChartFallback = () => (
  <div className="h-[220px] md:h-[400px] bg-muted/20 animate-pulse rounded" />
);
const Top30YtdChart = dynamic(() => import('@/components/oem/Top30YtdChart'), {
  ssr: false,
  loading: ChartFallback,
});
const Top40YearlyTable = dynamic(() => import('@/components/oem/Top40YearlyTable'), {
  ssr: false,
  loading: ChartFallback,
});
const YoyWinnersLosers = dynamic(() => import('@/components/oem/YoyWinnersLosers'), {
  ssr: false,
  loading: ChartFallback,
});
const TypeSegmentChart = dynamic(() => import('@/components/oem/TypeSegmentChart'), {
  ssr: false,
  loading: ChartFallback,
});

const DIM_OPTIONS = [
  { value: 'group', label: '중국 모회사' },
  { value: 'brand', label: '브랜드' },
] as const satisfies readonly { value: ChinaDim; label: string }[];
const DIM_ENTITY: Record<ChinaDim, string> = { group: '모회사', brand: '브랜드' };

/** OemDashboard 와 같은 YTD 꼬리표 — 차트 안쪽(Top30YtdChart)도 같은 year 로 같은 달을 찾는다 */
function ytdSuffix(rows: OemSalesGroupMonth[], year: number): string {
  const ym = findLatestYm(rows, year);
  return ym ? ` (1~${ym % 100}월)` : '';
}

/**
 * /oem/china 본문 — 절 순서와 짝지은 기존 차트는 계획서 「화면」 표.
 * 연도는 시계(currentYear·targetYear)가 아니라 **데이터 앵커**(p)로 정해 차트에 넘긴다 — 중국 엑셀은 한 달 넘게
 * 늦게 와서 1~2월엔 시계 기준 연도의 데이터가 아직 없고, 제목과 차트가 서로 다른 해를 말하게 된다.
 */
export default function ChinaDashboard({ data }: { data: ChinaData }) {
  const { periods: p } = data;
  const prodSuffix = useMemo(
    () => ytdSuffix(data.productionGroupMonth.group, p.year),
    [data.productionGroupMonth, p.year]
  );
  const exportSuffix = useMemo(
    () => ytdSuffix(data.exportGroupMonth.group, p.year),
    [data.exportGroupMonth, p.year]
  );
  // 12월까지 찼으면 YTD 칸 = 연간이라 표가 YTD 칸을 숨기게 라벨을 넘기지 않는다(aggregate topModels 와 짝)
  const ytdPeriodLabel = p.month < 12 ? p.ytdLabel : undefined;
  const tagMixStart = data.exportTagMix.annual[0]?.period;

  return (
    <div className="px-6 py-4 space-y-6 max-w-[1600px] mx-auto">
      <CompanyKpiCards kpi={data.kpi} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <KgDomesticExportSplit
          monthly={data.flows.monthly}
          annual={data.flows.annual}
          title="내수(추정) · 수출"
          footer={`막대 전체 = 승용 생산. 내수 = 생산 − 수출 — 재고 증감·수입차를 반영하지 않은 추정치다.${
            p.month < 12 ? ` ${p.year}년 막대는 ${p.ytdLabel} 누계.` : ''
          }`}
        />
        <CompanyPowertrainMixChart
          monthly={data.ptMix.monthly}
          annual={data.ptMix.annual}
          title="승용 생산 PowerTrain Mix"
          footer="MarkLines 엑셀의 HV/PHV/EV 열 기준 — 빈칸은 ICE, MHV(마일드 하이브리드)는 HV, 「HV/EV」처럼 둘 이상이면 전동화가 높은 쪽으로 센다."
        />
      </div>

      <Section
        title={`${p.year} YTD${prodSuffix} 승용 생산 TOP30`}
        subtitle="누적 생산량 + 전년 동기 대비 YoY"
        footer="모회사가 없는(n.a.) 외자 단독 법인은 브랜드 이름으로 한 줄씩 넣었다 — Tesla 등."
      >
        <DimTabs>
          {(dim) => (
            <Top30YtdChart
              groupMonth={data.productionGroupMonth[dim]}
              metricLabel="생산량"
              entityLabel={DIM_ENTITY[dim]}
              year={p.year}
            />
          )}
        </DimTabs>
      </Section>

      <Section
        title={`${p.fullYear} 승용 생산 TOP40 — 순위 등락`}
        subtitle={`${p.fullYear - 1} vs ${p.fullYear} 비교`}
      >
        <DimTabs>
          {(dim) => (
            <Top40YearlyTable
              groupMonth={data.productionGroupMonth[dim]}
              entityLabel={DIM_ENTITY[dim]}
              year={p.fullYear}
            />
          )}
        </DimTabs>
      </Section>

      <Section
        title="YoY 승자와 패자"
        subtitle={`${p.fullYear - 1}→${p.fullYear} 승용 생산 성장률 TOP10 / BOTTOM10`}
      >
        <DimTabs>
          {(dim) => (
            <YoyWinnersLosers groupMonth={data.productionGroupMonth[dim]} year={p.fullYear} />
          )}
        </DimTabs>
      </Section>

      {/* 도넛 2개는 전체 탭처럼 한 줄을 다 쓴다 — 반쪽 폭이면 조각 이름이 잘린다(2026-10-30 헤드리스 실측) */}
      <Section
        title="승용 생산 차종 구조"
        subtitle={`Type/Segment별 비중 (${p.fullYear}년)`}
        footer="MarkLines 승용차 엑셀의 Type·Segment 열 그대로."
      >
        <TypeSegmentChart typeSegMonth={data.typeSegMonth} year={p.fullYear} />
      </Section>

      <CompanyTopModelsTable
        dataAll={data.productionTopModels}
        title={`승용 생산 모델 TOP${PRODUCTION_TOP_MODELS}`}
        latestPeriodLabel={`${p.fullYear}년`}
        prevPeriodLabel={`${p.fullYear - 1}년`}
        ytdPeriodLabel={ytdPeriodLabel}
        hideGroupSelect
        hideUnifiedNote
      />

      <Section
        title={`${p.year} YTD${exportSuffix} 승용 수출 TOP30`}
        subtitle="누적 수출량 + 전년 동기 대비 YoY"
      >
        <DimTabs>
          {(dim) => (
            <Top30YtdChart
              groupMonth={data.exportGroupMonth[dim]}
              metricLabel="수출량"
              entityLabel={DIM_ENTITY[dim]}
              year={p.year}
            />
          )}
        </DimTabs>
      </Section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <CompanyTopModelsTable
          dataAll={data.exportTopModels}
          title={`승용 수출 모델 TOP${EXPORT_TOP_MODELS}`}
          latestPeriodLabel={`${p.fullYear}년`}
          prevPeriodLabel={`${p.fullYear - 1}년`}
          ytdPeriodLabel={ytdPeriodLabel}
          hideGroupSelect
          hideUnifiedNote
        />
        <CompanyPowertrainMixChart
          monthly={data.exportTagMix.monthly}
          annual={data.exportTagMix.annual}
          title={`승용 수출 EV 표기 Mix${tagMixStart ? ` (${tagMixStart}~)` : ''}`}
          footer="수출 엑셀의 EV 열은 모델에 붙은 표기라 물량이 동력원별로 나뉘지 않는다 — Multi = 표기가 둘 이상인 모델(예 EV/PHV)의 수출 전체, Unknown = 표기 없음(대부분 내연기관차로 보이나 확인되지 않음)."
        />
      </div>
    </div>
  );
}

/** 모회사/브랜드 토글(결정 6) — 우즈베키스탄 탭의 브랜드/회사 토글을 그대로 쓴다. 상태는 칸마다 따로 */
function DimTabs({ children }: { children: (dim: ChinaDim) => React.ReactNode }) {
  const [dim, setDim] = useState<ChinaDim>('group');
  return (
    <div>
      <UzbekistanDimensionToggle dimension={dim} onChange={setDim} options={DIM_OPTIONS} />
      {children(dim)}
    </div>
  );
}

/** 회사 탭 공용 차트(CompanyPowertrainMixChart 등)와 같은 카드 껍데기 */
function Section({
  title,
  subtitle,
  footer,
  children,
}: {
  title: string;
  subtitle?: string;
  footer?: string;
  children: React.ReactNode;
}) {
  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
        {subtitle && <CardDescription>{subtitle}</CardDescription>}
      </CardHeader>
      <CardContent>
        {children}
        {footer && <div className="mt-2 px-1 text-[11px] text-muted-foreground">{footer}</div>}
      </CardContent>
    </Card>
  );
}
