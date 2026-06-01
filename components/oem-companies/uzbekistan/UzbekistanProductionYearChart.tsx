'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { UzbekistanProductionYearPoint } from '@/lib/oem-companies/uzbekistan/source';

const ChartFallback = () => (
  <div className="flex h-[280px] w-full items-center justify-center text-xs text-muted-foreground">
    <div className="animate-pulse">차트 로딩 중...</div>
  </div>
);

const Inner = dynamic(() => import('./UzbekistanProductionYearChartInner'), {
  ssr: false,
  loading: ChartFallback,
});

interface Props {
  annual: UzbekistanProductionYearPoint[];
  title?: string;
  footer?: React.ReactNode;
  grouped?: boolean;
}

export default function UzbekistanProductionYearChart({
  annual,
  title = '연간 생산 (brand 별 stacked)',
  footer,
  grouped = false,
}: Props) {
  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Inner annual={annual} grouped={grouped} />
        {footer && <div className="mt-2 px-1 text-[11px] text-muted-foreground">{footer}</div>}
      </CardContent>
    </Card>
  );
}
