'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { HyundaiAnnualEarningsPoint, HyundaiQuarterlyEarningsPoint } from '@/lib/types';

interface Props {
  data: HyundaiQuarterlyEarningsPoint[];
  annual: HyundaiAnnualEarningsPoint[];
}

type ViewMode = 'quarter' | 'annual';

const ChartFallback = () => (
  <div className="h-[240px] md:h-[320px] bg-muted/20 animate-pulse rounded" />
);

const InnerQuarterly = dynamic(() => import('./HyundaiQuarterlyEarningsChartInner'), {
  ssr: false,
  loading: ChartFallback,
});

const InnerAnnual = dynamic(() => import('./HyundaiAnnualEarningsChartInner'), {
  ssr: false,
  loading: ChartFallback,
});

/** 분기/연간 IR 실적 (매출 bar + 영업이익률 line) 토글 차트 — Phase 2B/2D. */
export default function HyundaiQuarterlyEarningsChart({ data, annual }: Props) {
  const [mode, setMode] = useState<ViewMode>('quarter');
  if (!data.length && !annual.length) return null;

  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>
            {mode === 'quarter' ? '분기별' : '연간'} IR 실적 (매출 + 영업이익률)
          </CardTitle>
          <div
            role="tablist"
            aria-label="실적 기간 단위"
            className="flex items-center gap-1 text-sm"
          >
            <button
              role="tab"
              type="button"
              aria-selected={mode === 'quarter'}
              onClick={() => setMode('quarter')}
              className={cn(
                'rounded-md border px-3 py-1 transition-colors',
                mode === 'quarter'
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border text-muted-foreground hover:bg-muted'
              )}
            >
              분기
            </button>
            <button
              role="tab"
              type="button"
              aria-selected={mode === 'annual'}
              onClick={() => setMode('annual')}
              className={cn(
                'rounded-md border px-3 py-1 transition-colors',
                mode === 'annual'
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border text-muted-foreground hover:bg-muted'
              )}
            >
              연간
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {mode === 'quarter' ? <InnerQuarterly data={data} /> : <InnerAnnual data={annual} />}
        <p className="mt-2 px-1 text-[11px] leading-relaxed text-muted-foreground">
          출처: hyundai.com IR &middot; 분기별 실적 발표 자료(PDF) &middot;{' '}
          {mode === 'quarter'
            ? '매출 단위: 조원, 영업이익률(%)'
            : '연간 = 4분기 합산(불완전 연도는 YTD 표시), 영업이익률 = 영업이익 합/매출 합 가중평균'}
        </p>
      </CardContent>
    </Card>
  );
}
