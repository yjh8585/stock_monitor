'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
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

/** 보기 하나 — 고객사 「지역·차종·점유율」 절의 분기/연간(올해 누계 포함) 전환. note = 그 보기의 카드 아래 한 줄. */
export interface RegionsChartView {
  key: string;
  label: string;
  data: HyundaiQuarterlyRegionPoint[];
  note: string | null;
}

interface Props {
  data: HyundaiQuarterlyRegionPoint[];
  title?: string;
  footer?: React.ReactNode;
  /** 값 단위 — 기본 천대(지금 현대차 출력 그대로). 고객사 「지역·차종·점유율」 절이 억원·백만 USD 등으로 쓴다. */
  unit?: RegionsChartUnit;
  /** 보기가 둘 이상이면 머리에 전환 버튼(실적 차트의 분기/연간 버튼과 같은 모양) — 주면 data 대신 고른 보기를 그린다. */
  views?: RegionsChartView[];
}

/** 분기별 IR region 도매 stacked bar 차트 (기본 천대 단위).
 *  데이터 없을 때 안내 카드, 있을 때 inner 컴포넌트 dynamic import. */
export default function HyundaiQuarterlyRegionsChart({
  data,
  title = '지역별 분기 도매 판매 (IR PDF 기준)',
  footer,
  unit,
  views,
}: Props) {
  const [selected, setSelected] = useState(0);
  const view = views?.[Math.min(selected, views.length - 1)];
  const shown = view ? view.data : data;
  const note = view?.note ?? null;
  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{view ? `${view.label} ${title}` : title}</CardTitle>
          {views && views.length > 1 && (
            <div role="tablist" aria-label="기간 단위" className="flex items-center gap-1 text-sm">
              {views.map((v, i) => (
                <button
                  key={v.key}
                  role="tab"
                  type="button"
                  aria-selected={v === view}
                  onClick={() => setSelected(i)}
                  className={cn(
                    'rounded-md border px-3 py-1 transition-colors',
                    v === view
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border text-muted-foreground hover:bg-muted'
                  )}
                >
                  {v.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {shown.length === 0 ? (
          <div className="flex h-[240px] w-full items-center justify-center text-xs text-muted-foreground">
            분기 region 데이터 없음
          </div>
        ) : (
          <Inner data={shown} unit={unit} />
        )}
      </CardContent>
      {(footer || note) && (
        <CardFooter className="border-t px-6 py-3 text-[11px] text-muted-foreground">
          {footer ?? note}
        </CardFooter>
      )}
    </Card>
  );
}
