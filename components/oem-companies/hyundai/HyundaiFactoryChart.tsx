'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { FactoryMixPoint } from '@/lib/types';

interface Props {
  monthly: FactoryMixPoint[];
  annual: FactoryMixPoint[];
}

const ChartFallback = () => (
  <div className="h-[240px] md:h-[320px] bg-muted/20 animate-pulse rounded" />
);

const InnerChart = dynamic(() => import('./HyundaiFactoryChartInner'), {
  ssr: false,
  loading: ChartFallback,
});

/** 현대차 전용: 해외 공장별 stacked bar (연/월 토글). */
export default function HyundaiFactoryChart({ monthly, annual }: Props) {
  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <CardTitle>해외 공장별 출하량 (도매)</CardTitle>
      </CardHeader>
      <CardContent>
        <InnerChart monthly={monthly} annual={annual} />
      </CardContent>
    </Card>
  );
}
