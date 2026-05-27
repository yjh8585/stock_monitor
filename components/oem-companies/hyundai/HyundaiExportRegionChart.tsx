'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { HyundaiExportRegionPoint } from '@/lib/types';

const ChartFallback = () => (
  <div className="flex h-[280px] w-full items-center justify-center text-xs text-muted-foreground">
    <div className="animate-pulse">차트 로딩 중...</div>
  </div>
);

const Inner = dynamic(() => import('./HyundaiExportRegionChartInner'), {
  ssr: false,
  loading: ChartFallback,
});

interface Props {
  monthly: HyundaiExportRegionPoint[];
  annual: HyundaiExportRegionPoint[];
  title?: string;
  footer?: React.ReactNode;
  /** 막대 위 합계 라벨 표시 (9-region 차트에 사용). */
  showTotalLabels?: boolean;
  hideLabelsOnMonth?: boolean;
}

/** 한국 → 세부 region별 수출 stacked bar + 월/연 토글. */
export default function HyundaiExportRegionChart({
  monthly,
  annual,
  title = '지역별 수출 (한국 출하)',
  footer,
  showTotalLabels = false,
  hideLabelsOnMonth = false,
}: Props) {
  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Inner
          monthly={monthly}
          annual={annual}
          showTotalLabels={showTotalLabels}
          hideLabelsOnMonth={hideLabelsOnMonth}
        />
        {footer && <div className="mt-2 px-1 text-[11px] text-muted-foreground">{footer}</div>}
      </CardContent>
    </Card>
  );
}
