'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import type { HyundaiExportRegionPoint, HyundaiQuarterlyRegionPoint } from '@/lib/types';

const ChartFallback = () => (
  <div className="flex h-[320px] w-full items-center justify-center text-xs text-muted-foreground">
    <div className="animate-pulse">차트 로딩 중...</div>
  </div>
);

const Inner = dynamic(() => import('./HyundaiIRRegionsChartInner'), {
  ssr: false,
  loading: ChartFallback,
});

interface Props {
  /** 연간 region 합계 (ir-summary). 단위: 대. */
  annual: HyundaiExportRegionPoint[];
  /** 분기별 region (ir-quarterly). 단위: 천대. */
  quarterly: HyundaiQuarterlyRegionPoint[];
  title?: string;
  footer?: React.ReactNode;
}

/** 지역별 판매량 (IR, 도매 기준) — 연간/분기 토글 통합 차트 (사용자 요청 #8).
 *  기존 HyundaiExportRegionChart(IR 9-region) + HyundaiQuarterlyRegionsChart 통합. */
export default function HyundaiIRRegionsChart({
  annual,
  quarterly,
  title = '지역별 판매량 (IR, 도매 기준)',
  footer,
}: Props) {
  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Inner annual={annual} quarterly={quarterly} />
      </CardContent>
      {footer && (
        <CardFooter className="border-t px-6 py-3 text-[11px] text-muted-foreground">
          {footer}
        </CardFooter>
      )}
    </Card>
  );
}
