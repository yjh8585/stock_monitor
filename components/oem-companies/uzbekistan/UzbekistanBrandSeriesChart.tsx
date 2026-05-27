'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { UzbekistanBrandSeriesPoint } from '@/lib/oem-companies/uzbekistan/source';

const ChartFallback = () => (
  <div className="flex h-[280px] w-full items-center justify-center text-xs text-muted-foreground">
    <div className="animate-pulse">차트 로딩 중...</div>
  </div>
);

const Inner = dynamic(() => import('./UzbekistanBrandSeriesChartInner'), {
  ssr: false,
  loading: ChartFallback,
});

interface Props {
  data: UzbekistanBrandSeriesPoint[];
  title: string;
  color?: string;
  unitLabel?: string;
  footer?: React.ReactNode;
}

/** 단일 brand 연간 시계열 (Bar + YoY Line). */
export default function UzbekistanBrandSeriesChart({
  data,
  title,
  color = '#2563eb',
  unitLabel = '대',
  footer,
}: Props) {
  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Inner data={data} color={color} unitLabel={unitLabel} />
        {footer && <div className="mt-2 px-1 text-[11px] text-muted-foreground">{footer}</div>}
      </CardContent>
    </Card>
  );
}
