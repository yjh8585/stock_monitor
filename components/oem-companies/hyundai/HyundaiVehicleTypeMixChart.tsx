'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { HyundaiVehicleTypeMixPoint } from '@/lib/types';

const ChartFallback = () => (
  <div className="flex h-[280px] w-full items-center justify-center text-xs text-muted-foreground">
    <div className="animate-pulse">차트 로딩 중...</div>
  </div>
);

const Inner = dynamic(() => import('./HyundaiVehicleTypeMixChartInner'), {
  ssr: false,
  loading: ChartFallback,
});

interface Props {
  monthly: HyundaiVehicleTypeMixPoint[];
  annual: HyundaiVehicleTypeMixPoint[];
  title?: string;
}

/** 차종 type mix (PC/RV/Genesis/CV/Other) 100% stacked area + 월/연 토글. */
export default function HyundaiVehicleTypeMixChart({
  monthly,
  annual,
  title = '차종 Type Mix',
}: Props) {
  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Inner monthly={monthly} annual={annual} />
      </CardContent>
    </Card>
  );
}
