'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { KiaExportRegionPoint } from '@/lib/oem-companies/kia/aggregate';

const ChartFallback = () => (
  <div className="flex h-[280px] w-full items-center justify-center text-xs text-muted-foreground">
    <div className="animate-pulse">차트 로딩 중...</div>
  </div>
);

const Inner = dynamic(() => import('./KiaExportRegionChartInner'), {
  ssr: false,
  loading: ChartFallback,
});

interface Props {
  monthly: KiaExportRegionPoint[];
  annual: KiaExportRegionPoint[];
  title?: string;
  footer?: React.ReactNode;
  /** 막대 위 합계 라벨 표시 여부. */
  showTotalLabels?: boolean;
  /** 월간 모드에서 합계 라벨 숨김. */
  hideLabelsOnMonth?: boolean;
}

/** 기아 한국 출하 → 지역별 수출 (10 region) stacked bar + 월/연 토글. */
export default function KiaExportRegionChart({
  monthly,
  annual,
  title = '한국 출하 → 지역별 수출 (export-by-region)',
  footer,
  showTotalLabels = true,
  hideLabelsOnMonth = true,
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
