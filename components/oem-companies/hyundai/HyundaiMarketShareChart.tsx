'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { HyundaiMarketSharePoint } from '@/lib/types';

interface Props {
  data: HyundaiMarketSharePoint[];
}

const ChartFallback = () => (
  <div className="h-[240px] md:h-[320px] bg-muted/20 animate-pulse rounded" />
);

const InnerChart = dynamic(() => import('./HyundaiMarketShareChartInner'), {
  ssr: false,
  loading: ChartFallback,
});

/** US 시장 점유율 시계열 — Phase 2C. */
export default function HyundaiMarketShareChart({ data }: Props) {
  if (!data.length) return null;
  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <CardTitle>미국 시장 점유율 (월별)</CardTitle>
      </CardHeader>
      <CardContent>
        <InnerChart data={data} />
        <p className="mt-2 px-1 text-[11px] leading-relaxed text-muted-foreground">
          출처: hyundai.com IR &middot; HMA 발표 미국 retail sales &middot; 점유율(%) = HMC 판매 /
          시장 전체
        </p>
      </CardContent>
    </Card>
  );
}
