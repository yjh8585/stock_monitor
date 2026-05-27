'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { UzbekistanShareRow } from '@/lib/oem-companies/uzbekistan/source';

const ChartFallback = () => (
  <div className="flex h-[280px] w-full items-center justify-center text-xs text-muted-foreground">
    <div className="animate-pulse">차트 로딩 중...</div>
  </div>
);

const Inner = dynamic(() => import('./UzbekistanShareChartInner'), {
  ssr: false,
  loading: ChartFallback,
});

interface Props {
  data: UzbekistanShareRow[];
  title: string;
  footer?: React.ReactNode;
}

/** 100% stacked bar (share) — brand 또는 회사. */
export default function UzbekistanShareChart({ data, title, footer }: Props) {
  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Inner data={data} />
        {footer && <div className="mt-2 px-1 text-[11px] text-muted-foreground">{footer}</div>}
      </CardContent>
    </Card>
  );
}
