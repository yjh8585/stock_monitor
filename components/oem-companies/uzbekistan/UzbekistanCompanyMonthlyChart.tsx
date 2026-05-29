'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { UzbekistanCompanyMonthlyPoint } from '@/lib/oem-companies/uzbekistan/source';

const ChartFallback = () => (
  <div className="flex h-[280px] w-full items-center justify-center text-xs text-muted-foreground">
    <div className="animate-pulse">차트 로딩 중...</div>
  </div>
);

const Inner = dynamic(() => import('./UzbekistanCompanyMonthlyChartInner'), {
  ssr: false,
  loading: ChartFallback,
});

interface Props {
  monthly: UzbekistanCompanyMonthlyPoint[];
  annual: UzbekistanCompanyMonthlyPoint[];
  title?: string;
  footer?: React.ReactNode;
}

export default function UzbekistanCompanyMonthlyChart({
  monthly,
  annual,
  title = '회사별 sales (월/연 토글)',
  footer,
}: Props) {
  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Inner monthly={monthly} annual={annual} />
        {footer && <div className="mt-2 px-1 text-[11px] text-muted-foreground">{footer}</div>}
      </CardContent>
    </Card>
  );
}
