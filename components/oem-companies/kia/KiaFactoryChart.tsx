'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { FactoryMixPoint } from '@/lib/types';

interface Props {
  monthly: FactoryMixPoint[];
  annual: FactoryMixPoint[];
  /** 월간 모드에서 합계 라벨 숨김. */
  hideLabelsOnMonth?: boolean;
}

const ChartFallback = () => (
  <div className="h-[240px] md:h-[320px] bg-muted/20 animate-pulse rounded" />
);

const InnerChart = dynamic(() => import('./KiaFactoryChartInner'), {
  ssr: false,
  loading: ChartFallback,
});

/** Kia 전용: 공장별 출하량 stacked bar (한국 1 + 해외 5, 연/월 토글). */
export default function KiaFactoryChart({ monthly, annual, hideLabelsOnMonth }: Props) {
  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <CardTitle>공장별 출하량 (한국 + 해외 5 plant)</CardTitle>
      </CardHeader>
      <CardContent>
        <InnerChart monthly={monthly} annual={annual} hideLabelsOnMonth={hideLabelsOnMonth} />
      </CardContent>
    </Card>
  );
}
