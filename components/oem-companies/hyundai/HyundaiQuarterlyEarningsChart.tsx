'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { CustomerEarningsPoint } from '@/lib/customers/types';
import type { HyundaiAnnualEarningsPoint, HyundaiQuarterlyEarningsPoint } from '@/lib/types';

interface Props {
  data: HyundaiQuarterlyEarningsPoint[] | CustomerEarningsPoint[];
  annual: HyundaiAnnualEarningsPoint[] | CustomerEarningsPoint[];
  /** 매출 막대 칸 — 현대 IR = revenue_krw_bn(기본), 고객사(financials) = revenue_bn. 둘 다 십억 단위. */
  revenueKey?: 'revenue_krw_bn' | 'revenue_bn';
  /** 매출 표기 통화(기본 KRW = 조원 표기). 서버→클라이언트로 함수를 못 넘겨 문자열로 받는다. */
  currency?: string;
  /** 영업이익률 축을 음수까지 연다(적자 회사). 기본 false = 0 부터. */
  allowNegativeMargin?: boolean;
  /** 제목 가운데 말(기본 'IR 실적' → 「분기별 IR 실적 (매출 + 영업이익률)」). */
  titleLabel?: string;
  /** 출처 문구 앞부분(기본 = hyundai.com IR 문구). */
  sourceNote?: string;
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
export default function HyundaiQuarterlyEarningsChart({
  data,
  annual,
  revenueKey = 'revenue_krw_bn',
  currency = 'KRW',
  allowNegativeMargin = false,
  titleLabel = 'IR 실적',
  sourceNote = 'hyundai.com IR · 분기별 실적 발표 자료(PDF)',
}: Props) {
  const [mode, setMode] = useState<ViewMode>('quarter');
  if (!data.length && !annual.length) return null;

  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>
            {mode === 'quarter' ? '분기별' : '연간'} {titleLabel} (매출 + 영업이익률)
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
        {mode === 'quarter' ? (
          <InnerQuarterly
            data={data}
            revenueKey={revenueKey}
            currency={currency}
            allowNegativeMargin={allowNegativeMargin}
          />
        ) : (
          <InnerAnnual
            data={annual}
            revenueKey={revenueKey}
            currency={currency}
            allowNegativeMargin={allowNegativeMargin}
          />
        )}
        <p className="mt-2 px-1 text-[11px] leading-relaxed text-muted-foreground">
          출처: {sourceNote} &middot;{' '}
          {mode === 'quarter'
            ? currency === 'KRW'
              ? '매출 단위: 조원, 영업이익률(%)'
              : `매출 단위: ${currency} bn, 영업이익률(%)`
            : '연간 = 4분기 합산(불완전 연도는 YTD 표시), 영업이익률 = 영업이익 합/매출 합 가중평균'}
        </p>
      </CardContent>
    </Card>
  );
}
