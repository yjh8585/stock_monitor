'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CompanyPtMixPoint } from '@/lib/types';

interface Props {
  quarterly: CompanyPtMixPoint[];
  annual: CompanyPtMixPoint[];
  title?: string;
}

const ChartFallback = () => (
  <div className="h-[240px] md:h-[320px] bg-muted/20 animate-pulse rounded" />
);

const Inner = dynamic(() => import('./StellantisNaPtMixChartInner'), {
  ssr: false,
  loading: ChartFallback,
});

/** Stellantis NA PT mix — 100% stacked, 분기/연 토글.
 *  공통 CompanyPowertrainMixChart는 '월간' 라벨이 하드코딩이라 분기용 별도 컴포넌트. */
export default function StellantisNaPtMixChart({
  quarterly,
  annual,
  title = 'PowerTrain Mix (ICE/PHEV/EV)',
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
