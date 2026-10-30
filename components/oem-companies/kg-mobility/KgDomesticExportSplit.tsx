'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { KgRegionSeriesPoint } from '@/lib/oem-companies/kg-mobility/aggregate';

interface Props {
  monthly: KgRegionSeriesPoint[];
  annual: KgRegionSeriesPoint[];
  /** 카드 제목 — 기본 「내수/수출 분리」. 중국 탭은 「내수(추정) · 수출」 */
  title?: string;
  /** 차트 아래 각주 — CompanyPowertrainMixChart 의 footer 와 같은 모양 */
  footer?: React.ReactNode;
}

const ChartFallback = () => (
  <div className="h-[240px] md:h-[320px] bg-muted/20 animate-pulse rounded" />
);

const InnerChart = dynamic(() => import('./KgDomesticExportSplitInner'), {
  ssr: false,
  loading: ChartFallback,
});

/** KG 전용: 내수/수출 stacked bar (연/월 토글, 합계 line 없음). */
export default function KgDomesticExportSplit({
  monthly,
  annual,
  title = '내수/수출 분리',
  footer,
}: Props) {
  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <InnerChart monthly={monthly} annual={annual} />
        {footer && <div className="mt-2 px-1 text-[11px] text-muted-foreground">{footer}</div>}
      </CardContent>
    </Card>
  );
}
