'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CompanyTimeSeriesPoint } from '@/lib/types';
import type { TimeSeriesSecondary } from './CompanyTimeSeriesChartInner';

interface Props {
  /** 월별 시계열 (mode='month' 시 표시). */
  monthly: CompanyTimeSeriesPoint[];
  /** 연도별 시계열 (mode='year' 시 표시, 기본). */
  annual: CompanyTimeSeriesPoint[];
  /** 카드 제목. 기본 "출하량 추이 (도매 wholesale)". */
  title?: string;
  /** 비교용 두 번째 계열(고객사 페이지의 회사 발표 물량). 없으면 지금 동작 그대로. */
  secondary?: TimeSeriesSecondary;
  /** 연/월 토글을 숨기고 막대만(분기 값만 있는 계열). 기본 false — 지금 동작 그대로. */
  hideModeToggle?: boolean;
  /** 막대·영역 툴팁 이름(두 번째 계열이 없을 때). 기본 「출하량」. */
  seriesLabel?: string;
}

// recharts 의존을 클라이언트 번들에서만 로드 → SSR 비용 절감 + 초기 페이로드 축소.
const ChartFallback = () => (
  <div className="h-[240px] md:h-[320px] bg-muted/20 animate-pulse rounded" />
);

const TimeSeriesInner = dynamic(() => import('./CompanyTimeSeriesChartInner'), {
  ssr: false,
  loading: ChartFallback,
});

/**
 * 회사별 판매 시계열 차트 (연/월 토글).
 * 연간(기본): BarChart, 월간: AreaChart(gradient).
 * 토글 상태/UI는 Inner 컴포넌트가 보유 (client only).
 */
export default function CompanyTimeSeriesChart({
  monthly,
  annual,
  title = '출하량 추이 (도매 wholesale)',
  secondary,
  hideModeToggle,
  seriesLabel,
}: Props) {
  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <TimeSeriesInner
          monthly={monthly}
          annual={annual}
          secondary={secondary}
          hideModeToggle={hideModeToggle}
          seriesLabel={seriesLabel}
        />
      </CardContent>
    </Card>
  );
}
