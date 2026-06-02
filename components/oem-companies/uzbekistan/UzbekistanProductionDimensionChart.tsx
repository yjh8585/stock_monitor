'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { UzbekistanProductionYearPoint } from '@/lib/oem-companies/uzbekistan/source';
import UzbekistanDimensionToggle, { type ProductionDimension } from './UzbekistanDimensionToggle';

const ChartFallback = () => (
  <div className="flex h-[280px] w-full items-center justify-center text-xs text-muted-foreground">
    <div className="animate-pulse">차트 로딩 중...</div>
  </div>
);

const Inner = dynamic(() => import('./UzbekistanProductionYearChartInner'), {
  ssr: false,
  loading: ChartFallback,
});

interface Props {
  byBrand: UzbekistanProductionYearPoint[];
  byCompany: UzbekistanProductionYearPoint[];
  title?: string;
  footer?: React.ReactNode;
}

/** 연간 생산 — 브랜드/회사 토글 stacked 막대 (토글 시 합계 연동). */
export default function UzbekistanProductionDimensionChart({
  byBrand,
  byCompany,
  title = '연간 생산',
  footer,
}: Props) {
  const [dimension, setDimension] = useState<ProductionDimension>('brand');
  const data = dimension === 'brand' ? byBrand : byCompany;
  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <UzbekistanDimensionToggle dimension={dimension} onChange={setDimension} />
        {/* 차원 전환 시 막대 set이 바뀌어 recharts 스택 등록 순서가 꼬이므로(앵커 합계 막대가
            바닥으로) key로 Inner를 remount해 등록 순서를 초기화한다. */}
        <Inner key={dimension} annual={data} showYoy />
        {footer && <div className="mt-2 px-1 text-[11px] text-muted-foreground">{footer}</div>}
      </CardContent>
    </Card>
  );
}
