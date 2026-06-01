'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CompanyPtMixPoint } from '@/lib/types';

interface Props {
  monthly: CompanyPtMixPoint[];
  annual: CompanyPtMixPoint[];
  title?: string;
  footer?: React.ReactNode;
}

const ChartFallback = () => (
  <div className="h-[240px] md:h-[320px] bg-muted/20 animate-pulse rounded" />
);

const MixChartInner = dynamic(() => import('./CompanyPowertrainMixChartInner'), {
  ssr: false,
  loading: ChartFallback,
});

/**
 * 회사별 PowerTrain mix — 100% stacked AreaChart, 연/월 토글.
 * Unknown 비중이 크면 vehicle_powertrain_map 시드가 필요하다는 신호.
 */
export default function CompanyPowertrainMixChart({
  monthly,
  annual,
  title = 'PowerTrain Mix',
  footer,
}: Props) {
  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <MixChartInner monthly={monthly} annual={annual} />
        {footer && <div className="mt-2 px-1 text-[11px] text-muted-foreground">{footer}</div>}
      </CardContent>
    </Card>
  );
}
