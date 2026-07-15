'use client';

import dynamic from 'next/dynamic';
import { ChartSection } from '@/components/management/plan/_selectors';
import type { LagResult, RevenueVsRetailPoint } from '@/lib/stellantis-forecast/types';
import { ChartFallback } from './ChartFallback';

const Inner = dynamic(() => import('./StellantisRevenueVsRetailChartInner'), {
  ssr: false,
  loading: () => <ChartFallback size="lg" />,
});

/**
 * 시차 부제 문구 — 부호에 따라 선행/후행/동행이 갈린다.
 *
 * `buildRevenueVsRetail`은 `소매[t + lag]`를 자사 매출[t] 옆에 놓는다. 즉 lag>0(자사 매출 선행)이면
 * 미래 소매를 **앞당겨** 겹치고, lag<0이면 과거 소매를 **늦춰** 겹친다. 문구를 이 동작 그대로 쓴다.
 */
function lagCaption(lag: LagResult | null): string {
  if (lag === null) {
    return '시차를 채택할 만한 표본이 없어 정렬 없이(같은 달끼리) 겹쳐 그립니다.';
  }
  const { lagMonths, r, n } = lag;
  const evidence = `YoY 증감률 상관계수 r = ${r.toFixed(2)} · 표본 ${n}개월`;
  if (lagMonths === 0) {
    return `시차 0개월 — 자사 매출과 스텔란티스 소매가 같은 달에 함께 움직입니다 (${evidence}).`;
  }
  if (lagMonths > 0) {
    return `자사 매출이 스텔란티스 북미 소매보다 ${lagMonths}개월 선행 — 소매를 ${lagMonths}개월 앞당겨 정렬했습니다 (${evidence}).`;
  }
  return `자사 매출이 스텔란티스 북미 소매보다 ${-lagMonths}개월 후행 — 소매를 ${-lagMonths}개월 늦춰 정렬했습니다 (${evidence}).`;
}

/** 차트 2 제목 — 탐지된 시차를 제목에서부터 밝힌다(무엇을 밀어 맞췄는지 모르면 오독한다). */
function chartTitle(lag: LagResult | null): string {
  if (lag === null || lag.lagMonths === 0) {
    return '2. 자사 매출 vs 스텔란티스 북미 소매';
  }
  const dir = lag.lagMonths > 0 ? '선행' : '후행';
  return `2. 자사 매출 vs 스텔란티스 북미 소매 (자사 매출 ${Math.abs(lag.lagMonths)}개월 ${dir} 정렬)`;
}

export default function StellantisRevenueVsRetailChart({
  points,
  lag,
}: {
  points: RevenueVsRetailPoint[];
  lag: LagResult | null;
}) {
  return (
    <ChartSection title={chartTitle(lag)} unit="자사 매출 억원 · 소매 대">
      <p className="mb-2 text-sm text-muted-foreground">
        {lagCaption(lag)} 자사 매출이 소매에 선행할수록, 지금의 소매·재고 흐름이 앞으로 자사 매출에
        어떻게 도달할지 미리 읽을 수 있습니다.
      </p>
      <Inner points={points} />
    </ChartSection>
  );
}
