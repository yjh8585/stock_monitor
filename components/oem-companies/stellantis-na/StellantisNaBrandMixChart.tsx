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

const Inner = dynamic(() => import('./StellantisNaBrandMixChartInner'), {
  ssr: false,
  loading: ChartFallback,
});

/** Stellantis NA brand mix — 100% stacked AreaChart, 분기/연 토글. */
export default function StellantisNaBrandMixChart({
  quarterly,
  annual,
  title = '브랜드 mix (점유율)',
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
