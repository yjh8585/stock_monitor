'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { UzbekistanModelYearCompare } from '@/lib/oem-companies/uzbekistan/source';

const ChartFallback = () => (
  <div className="flex h-[320px] w-full items-center justify-center text-xs text-muted-foreground">
    <div className="animate-pulse">차트 로딩 중...</div>
  </div>
);

const Inner = dynamic(() => import('./UzbekistanModelCompareChartInner'), {
  ssr: false,
  loading: ChartFallback,
});

interface Props {
  compare: UzbekistanModelYearCompare;
  title?: string;
  footer?: React.ReactNode;
}

/** 시리즈 라벨: YTD면 '(1~N월)' 부기, 만년이면 연도만. */
function seriesLabel(year: string, ytdMonth: number): string {
  return ytdMonth > 0 ? `${year} (1~${ytdMonth}월)` : year;
}

/**
 * 차종별 연간 생산량 — 연도 드롭다운 + 전년 동기 비교(grouped).
 * 최신 연도는 YTD(1~N월)이며, 전년도 같은 기간(1~N월)과 나란히 비교한다.
 */
export default function UzbekistanModelYearChart({
  compare,
  title = '차종별 연간 생산량',
  footer,
}: Props) {
  const { years, byYear } = compare;
  // 기본 선택 = 최신 연도(마지막, YTD).
  const [year, setYear] = useState<string>(() => years.at(-1)?.year ?? '');

  const view = useMemo(() => {
    const meta = years.find((y) => y.year === year);
    if (!meta) return null;
    return {
      models: byYear[year] ?? [],
      curLabel: seriesLabel(meta.year, meta.ytdMonth),
      prevLabel: seriesLabel(meta.prevYear, meta.ytdMonth),
      showPrev: meta.hasPrev,
    };
  }, [years, byYear, year]);

  if (years.length === 0) return null;

  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex items-center gap-2 text-sm">
          <label htmlFor="uz-model-year" className="text-muted-foreground">
            연도
          </label>
          <select
            id="uz-model-year"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          >
            {[...years].reverse().map((y) => (
              <option key={y.year} value={y.year}>
                {y.ytdMonth > 0 ? `${y.year} (1~${y.ytdMonth}월, YTD)` : y.year}
              </option>
            ))}
          </select>
        </div>
        {view && (
          <Inner
            models={view.models}
            curLabel={view.curLabel}
            prevLabel={view.prevLabel}
            showPrev={view.showPrev}
          />
        )}
        {footer && <div className="mt-2 px-1 text-[11px] text-muted-foreground">{footer}</div>}
      </CardContent>
    </Card>
  );
}
