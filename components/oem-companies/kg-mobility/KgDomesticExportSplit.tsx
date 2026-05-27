'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { KgRegionSeriesPoint } from '@/lib/oem-companies/kg-mobility/aggregate';

interface Props {
  monthly: KgRegionSeriesPoint[];
  annual: KgRegionSeriesPoint[];
}

const ChartFallback = () => (
  <div className="h-[240px] md:h-[320px] bg-muted/20 animate-pulse rounded" />
);

const InnerChart = dynamic(() => import('./KgDomesticExportSplitInner'), {
  ssr: false,
  loading: ChartFallback,
});

/** KG 전용: 내수/수출 stacked bar (연/월 토글, 합계 line 없음). */
export default function KgDomesticExportSplit({ monthly, annual }: Props) {
  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <CardTitle>내수/수출 분리</CardTitle>
      </CardHeader>
      <CardContent>
        <InnerChart monthly={monthly} annual={annual} />
      </CardContent>
    </Card>
  );
}
