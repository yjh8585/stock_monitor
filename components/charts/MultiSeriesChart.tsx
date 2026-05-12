'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type Time,
} from 'lightweight-charts';
import { useTheme } from 'next-themes';
import RangeToggle, { type RangeKey } from './RangeToggle';
import { sliceByRange } from '@/lib/seriesRange';
import type { SeriesPoint } from '@/lib/series';

export interface MultiSeriesItem {
  label: string;
  color: string;
  data: SeriesPoint[];
}

interface MultiSeriesChartProps {
  title: string;
  unit: string;
  source: string;
  series: MultiSeriesItem[];
  height?: number;
  initialRange?: RangeKey;
  /** 보조 priceScale(왼쪽 Y축)을 쓸 series 인덱스 목록. 비어있으면 단일 축. */
  secondaryFor?: readonly number[];
}

/** 다중 라인 차트(예: 국채 10Y/2Y) — 동일 단위, 범례 + 기간 토글.
 * secondaryFor를 넘기면 해당 인덱스의 series는 왼쪽 보조 Y축에 그려 가격대가 다른 두 종목을 비교하기 쉽다. */
export default function MultiSeriesChart({
  title,
  unit,
  source,
  series,
  height = 240,
  initialRange = '5y',
  secondaryFor,
}: MultiSeriesChartProps) {
  const useDualAxis = (secondaryFor?.length ?? 0) > 0;
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<ISeriesApi<'Line'>[]>([]);
  const [range, setRange] = useState<RangeKey>(initialRange);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const slicedAll = useMemo(
    () => series.map((s) => ({ ...s, data: sliceByRange(s.data, range) })),
    [series, range]
  );

  // 마지막 값 라벨 (각 series별)
  const lastValues = slicedAll.map((s) => s.data.at(-1)?.value);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { color: 'transparent' },
        textColor: isDark ? '#a1a1aa' : '#52525b',
      },
      grid: {
        vertLines: { color: isDark ? '#27272a' : '#f4f4f5' },
        horzLines: { color: isDark ? '#27272a' : '#f4f4f5' },
      },
      rightPriceScale: { borderColor: isDark ? '#3f3f46' : '#e4e4e7' },
      leftPriceScale: useDualAxis
        ? { visible: true, borderColor: isDark ? '#3f3f46' : '#e4e4e7' }
        : { visible: false },
      timeScale: {
        borderColor: isDark ? '#3f3f46' : '#e4e4e7',
        timeVisible: false,
      },
      crosshair: { mode: 1 },
      autoSize: false,
    });
    chartRef.current = chart;

    seriesRefs.current = series.map((s, i) =>
      chart.addSeries(LineSeries, {
        color: s.color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        priceScaleId: secondaryFor?.includes(i) ? 'left' : 'right',
      })
    );

    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRefs.current = [];
    };
    // 시리즈 라벨/색 자체는 props 변경 안 됨(서버에서 고정). isDark/height/축구성만 의존.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark, height, series.length, useDualAxis, secondaryFor?.join(',')]);

  useEffect(() => {
    slicedAll.forEach((s, i) => {
      const ref = seriesRefs.current[i];
      if (!ref) return;
      const points: LineData<Time>[] = s.data.map((p) => ({
        time: p.time as Time,
        value: p.value,
      }));
      ref.setData(points);
    });
    chartRef.current?.timeScale().fitContent();
  }, [slicedAll]);

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{title}</div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 tabular-nums mt-0.5">
            {series.map((s, i) => {
              const v = lastValues[i];
              return (
                <span key={s.label} className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full"
                    style={{ background: s.color }}
                  />
                  <span className="text-xs text-muted-foreground">{s.label}</span>
                  <span className="text-lg font-semibold text-foreground">
                    {v != null
                      ? `${v.toLocaleString('ko-KR', { maximumFractionDigits: 2 })} ${unit}`
                      : '—'}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
        <RangeToggle value={range} onChange={setRange} />
      </div>
      <div ref={containerRef} className="w-full" style={{ height }} />
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>단위: {unit}</span>
        <span>출처: {source}</span>
      </div>
    </div>
  );
}
