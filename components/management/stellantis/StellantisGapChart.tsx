'use client';

import dynamic from 'next/dynamic';
import { ChartSection } from '@/components/management/plan/_selectors';
import type { GapPoint } from '@/lib/stellantis-forecast/types';
import { ChartFallback } from './ChartFallback';

const Inner = dynamic(() => import('./StellantisGapChartInner'), {
  ssr: false,
  loading: () => <ChartFallback size="lg" />,
});

/**
 * 차트 1 — 북미 출하 vs 소매 · 재고 증감.
 *
 * 항등식 **출하 − 소매 = 딜러 재고 증감**을 한 화면에 세운다. 출하가 소매를 계속 웃돌면
 * 딜러 재고가 쌓이고, 스텔란티스는 결국 출하를 줄여(감산) 되돌린다 — 그때 자사 매출도 함께 준다.
 */
export default function StellantisGapChart({ points }: { points: GapPoint[] }) {
  return (
    <ChartSection title="1. 북미 출하 vs 소매 · 재고 증감" unit="대">
      <p className="mb-2 text-sm text-muted-foreground">
        출하(도매, Stellantis IR) − 소매 판매(MarkLines 미국·캐나다·멕시코, 마세라티 제외) = 딜러
        재고 증감. 빗금 막대는 반기·연간 보도자료에서 <b>차분 도출</b>한 출하(±1,000대 오차)입니다.
      </p>
      <Inner points={points} />
    </ChartSection>
  );
}
