'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import type { HyundaiQuarterlyRegionPoint } from '@/lib/types';
import type { RegionsChartUnit } from './HyundaiQuarterlyRegionsChartInner';

const ChartFallback = () => (
  <div className="flex h-[280px] w-full items-center justify-center text-xs text-muted-foreground">
    <div className="animate-pulse">차트 로딩 중...</div>
  </div>
);

const Inner = dynamic(() => import('./HyundaiQuarterlyRegionsChartInner'), {
  ssr: false,
  loading: ChartFallback,
});

interface Props {
  data: HyundaiQuarterlyRegionPoint[];
  title?: string;
  footer?: React.ReactNode;
  /** 값 단위 — 기본 천대(지금 현대차 출력 그대로). 고객사 「지역·차종·점유율」 절이 억원·백만 USD 등으로 쓴다. */
  unit?: RegionsChartUnit;
}

/** 분기별 IR region 도매 stacked bar 차트 (기본 천대 단위).
 *  데이터 없을 때 안내 카드, 있을 때 inner 컴포넌트 dynamic import. */
export default function HyundaiQuarterlyRegionsChart({
  data,
  title = '지역별 분기 도매 판매 (IR PDF 기준)',
  footer,
  unit,
}: Props) {
  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex h-[240px] w-full items-center justify-center text-xs text-muted-foreground">
            분기 region 데이터 없음
          </div>
        ) : (
          <Inner data={data} unit={unit} />
        )}
      </CardContent>
      {footer && (
        <CardFooter className="border-t px-6 py-3 text-[11px] text-muted-foreground">
          {footer}
        </CardFooter>
      )}
    </Card>
  );
}
