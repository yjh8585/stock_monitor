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
 * 차트 1 — 분기 북미 출하 vs 소매 · 재고 증감.
 *
 * 항등식 **출하 − 소매 = 딜러 재고 증감**을 한 화면에 세운다. 출하가 소매를 계속 웃돌면
 * 딜러 재고가 쌓이고, 스텔란티스는 결국 출하를 줄여(감산) 되돌린다 — 그때 자사 매출도 함께 준다.
 *
 * 차트 2와 달리 **근사가 아니라 정확한 항등식**이다(출하·소매 모두 북미 시장 기준).
 * 대가는 주기: 출하가 분기 단위이고 최신 분기는 늘 비어 있다.
 */
export default function StellantisGapChart({
  points,
  projected,
  projectedNote,
  partialQuarterNote,
}: {
  points: GapPoint[];
  projected: GapPoint | null;
  projectedNote: string | null;
  partialQuarterNote: string | null;
}) {
  // 추정 분기는 실측 계열 뒤에 붙여 차트에만 그린다(통계·진단은 실측 points만 쓴다).
  const allPoints = projected ? [...points, projected] : points;
  return (
    <ChartSection title="1. 분기 북미 출하 vs 소매 · 재고 증감" unit="대">
      <p className="mb-2 text-sm text-muted-foreground">
        출하(도매, <b>Stellantis 공식 IR</b>) − 소매 판매(MarkLines 미국·캐나다·멕시코, 마세라티
        제외) = 딜러 재고 증감. 스텔란티스 공식 소매는 미국분만 공개돼 북미 스코프를 못 맞추므로,
        이미 공식 발표와 근사함이 확인된 MarkLines 소매를 씁니다.
      </p>
      <p className="mb-2 text-sm text-muted-foreground">
        출하는 <b>Stellantis IR 분기 릴리스의 절대값</b>을 우선 씁니다(2026년~ 지역별 표 제공). 빗금
        막대는 과거 반기·연간 보도자료에서 <b>차분 도출</b>한 출하입니다(Q2 = H1 − Q1, Q4 = FY − H1
        − Q3, ±1,000대 오차).
        {partialQuarterNote ? <> {partialQuarterNote}</> : null}
      </p>
      {projectedNote ? (
        <p className="mb-2 text-sm text-amber-700 dark:text-amber-400">
          ⚠️ 맨 오른쪽 분기(<b>빗금 소매 막대 + 속 빈 점</b>)는 <b>추정 포함 분기</b>입니다.{' '}
          {projectedNote} 이 분기는 아래 통계·진단 계산에서는 제외합니다(실측 완전 분기만 셉니다).
        </p>
      ) : null}
      <Inner points={allPoints} />
    </ChartSection>
  );
}
