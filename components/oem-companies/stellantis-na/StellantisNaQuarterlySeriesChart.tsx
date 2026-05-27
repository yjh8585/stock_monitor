'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { StellantisNaBrandStackPoint } from '@/lib/types';

interface Props {
  quarterly: StellantisNaBrandStackPoint[];
  annual: StellantisNaBrandStackPoint[];
  title?: string;
}

const ChartFallback = () => (
  <div className="h-[240px] md:h-[320px] bg-muted/20 animate-pulse rounded" />
);

const Inner = dynamic(() => import('./StellantisNaQuarterlySeriesChartInner'), {
  ssr: false,
  loading: ChartFallback,
});

/** Stellantis NA 분기/연도별 brand stacked bar — 합계 라벨 + 분기/연 토글. */
export default function StellantisNaQuarterlySeriesChart({
  quarterly,
  annual,
  title = '분기별 도매 출하 (shipments · brand stacked)',
}: Props) {
  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Inner quarterly={quarterly} annual={annual} />
      </CardContent>
    </Card>
  );
}
