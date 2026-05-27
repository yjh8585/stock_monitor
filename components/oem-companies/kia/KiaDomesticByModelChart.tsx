'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { KiaDomesticByModelPoint } from '@/lib/oem-companies/kia/aggregate';

const ChartFallback = () => (
  <div className="flex h-[280px] w-full items-center justify-center text-xs text-muted-foreground">
    <div className="animate-pulse">차트 로딩 중...</div>
  </div>
);

const Inner = dynamic(() => import('./KiaDomesticByModelChartInner'), {
  ssr: false,
  loading: ChartFallback,
});

interface Props {
  monthly: KiaDomesticByModelPoint[];
  annual: KiaDomesticByModelPoint[];
  title?: string;
  footer?: React.ReactNode;
  hideLabelsOnMonth?: boolean;
}

/** 국내 내수 출하 모델별 stacked bar (한국 시장 도매 wholesale). */
export default function KiaDomesticByModelChart({
  monthly,
  annual,
  title = '국내 내수 출하 (모델별, 도매 wholesale)',
  footer,
  hideLabelsOnMonth = true,
}: Props) {
  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Inner monthly={monthly} annual={annual} hideLabelsOnMonth={hideLabelsOnMonth} />
        {footer && <div className="mt-2 px-1 text-[11px] text-muted-foreground">{footer}</div>}
      </CardContent>
    </Card>
  );
}
