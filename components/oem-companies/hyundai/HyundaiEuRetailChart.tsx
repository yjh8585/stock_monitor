'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { HyundaiEuRetailData } from '@/lib/types';

interface Props {
  data: HyundaiEuRetailData;
}

const ChartFallback = () => (
  <div className="h-[240px] md:h-[320px] bg-muted/20 animate-pulse rounded" />
);

const InnerChart = dynamic(() => import('./HyundaiEuRetailChartInner'), {
  ssr: false,
  loading: ChartFallback,
});

/** EU 월별 retail 추이(콤보 차트) — Phase 2C. industry/market_share 없음 → 점유율 차트 불가.
 *  차종 TOP10은 HyundaiEuRetailTopCard에서 분리 표시(#8 사용자 요청). */
export default function HyundaiEuRetailChart({ data }: Props) {
  if (data.monthlySeries.length === 0) return null;

  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <CardTitle>유럽 retail 추이 (월별)</CardTitle>
      </CardHeader>
      <CardContent>
        <InnerChart data={data.monthlySeries} />
        <p className="mt-2 px-1 text-[11px] leading-relaxed text-muted-foreground">
          출처: hyundai.com IR &middot; HME 발표 유럽 retail sales &middot; EU는 industry/시장점유율
          미발표(US와 차이).
        </p>
      </CardContent>
    </Card>
  );
}
