'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { partialYearNote } from '@/lib/oem-companies/kia/aggregate';
import type { KiaRetailRegionPoint } from '@/lib/oem-companies/kia/aggregate';

const ChartFallback = () => (
  <div className="flex h-[280px] w-full items-center justify-center text-xs text-muted-foreground">
    <div className="animate-pulse">차트 로딩 중...</div>
  </div>
);

const Inner = dynamic(() => import('./KiaRetailRegionChartInner'), {
  ssr: false,
  loading: ChartFallback,
});

interface Props {
  monthly: KiaRetailRegionPoint[];
  annual: KiaRetailRegionPoint[];
  title?: string;
  footer?: React.ReactNode;
  showTotalLabels?: boolean;
  hideLabelsOnMonth?: boolean;
  /** 제목 옆 추가 안내 (예: '2021~2023 해외 전용'). */
  extraNote?: React.ReactNode;
}

/** 기아 지역별 retail 판매량 (12 region) stacked bar + 월/연 토글. */
export default function KiaRetailRegionChart({
  monthly,
  annual,
  title = '지역별 판매량 (retail · 12 region)',
  footer,
  showTotalLabels = true,
  hideLabelsOnMonth = true,
  extraNote,
}: Props) {
  const note = partialYearNote(annual);
  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <CardTitle>{title}</CardTitle>
          {note && (
            <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-500">
              {note}
            </span>
          )}
          {extraNote && (
            <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-500">
              {extraNote}
            </span>
          )}
        </div>
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
