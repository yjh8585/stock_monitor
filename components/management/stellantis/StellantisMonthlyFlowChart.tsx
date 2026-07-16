'use client';

import dynamic from 'next/dynamic';
import { ChartSection } from '@/components/management/plan/_selectors';
import { monthLabel } from '@/lib/stellantis-forecast/aggregate';
import type { MonthlyFlowPoint } from '@/lib/stellantis-forecast/types';
import { ChartFallback } from './ChartFallback';

const Inner = dynamic(() => import('./StellantisMonthlyFlowChartInner'), {
  ssr: false,
  loading: () => <ChartFallback size="lg" />,
});

/**
 * 차트 2 — 월별 북미 생산 vs 소매 · 재고 증감.
 *
 * MarkLines 단일 소스라 **월별로 즉시** 갱신된다(차트 1의 분기 출하는 항상 한 분기 이상 늦다).
 * 대신 `생산 − 소매`는 항등식이 아니라 근사다 — 아래 각주로 그 한계를 밝힌다.
 */
export default function StellantisMonthlyFlowChart({
  points,
  lastCompleteMonth,
}: {
  points: MonthlyFlowPoint[];
  lastCompleteMonth: number | null;
}) {
  return (
    <ChartSection title="2. 월별 북미 생산 vs 소매 · 재고 증감" unit="대">
      <p className="mb-2 text-sm text-muted-foreground">
        생산(MarkLines 미국·캐나다·멕시코 <b>공장</b>) − 소매 판매(MarkLines 미국·캐나다·멕시코{' '}
        <b>시장</b>, 마세라티 제외) = 파이프라인 재고 증감.
        {lastCompleteMonth !== null ? (
          <>
            {' '}
            3개국이 모두 채워진 <b>{monthLabel(lastCompleteMonth)}</b>까지만 표시합니다 —
            MarkLines는 국가별 도착 시점이 달라 최신 월을 그대로 합산하면 소매가 과소집계됩니다.
          </>
        ) : null}
      </p>
      <p className="mb-2 text-sm text-muted-foreground">
        ⚠️ 생산은 <b>만든 나라</b>, 소매는 <b>팔린 나라</b> 기준이라 북미 밖 수출입이 갭에 섞입니다.
        절대 수준(2024.01~2026.05 실측 북미 생산 = 북미 소매의 +3.1%)이 아니라 <b>방향</b>으로
        읽으십시오. 정확한 항등식은 차트 1입니다.
      </p>
      <Inner points={points} />
    </ChartSection>
  );
}
