'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { UzbekistanShareRow } from '@/lib/oem-companies/uzbekistan/source';
import UzbekistanDimensionToggle, { type ProductionDimension } from './UzbekistanDimensionToggle';

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
  byBrand: UzbekistanShareRow[];
  byCompany: UzbekistanShareRow[];
  title?: string;
  footer?: React.ReactNode;
}

/** 시장점유율 (생산 기준) — 브랜드/회사 토글 100% stacked 막대. */
export default function UzbekistanShareDimensionChart({
  byBrand,
  byCompany,
  title = '시장점유율 (생산 기준)',
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
        {/* 차원 전환 시 막대 set 변경으로 스택 순서가 꼬이지 않도록 key로 remount. */}
        <Inner key={dimension} data={data} />
        {footer && <div className="mt-2 px-1 text-[11px] text-muted-foreground">{footer}</div>}
      </CardContent>
    </Card>
  );
}
