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

interface SeriesChartProps {
  title: string;
  unit: string;
  source: string;
  data: SeriesPoint[];
  height?: number;
  color?: string;
  initialRange?: RangeKey;
}

/** 단일 라인 차트 + 기간 토글 + 단위/출처 footer */
export default function SeriesChart({
  title,
  unit,
  source,
  data,
  height = 240,
  color = '#2962FF',
  initialRange = '1y',
}: SeriesChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const [range, setRange] = useState<RangeKey>(initialRange);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const sliced = useMemo(() => sliceByRange(data, range), [data, range]);
  const last = sliced.at(-1);

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
      timeScale: {
        borderColor: isDark ? '#3f3f46' : '#e4e4e7',
        timeVisible: false,
      },
      crosshair: { mode: 1 },
      autoSize: false,
    });
    const series = chart.addSeries(LineSeries, {
      color,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chartRef.current = chart;
    seriesRef.current = series;

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
      seriesRef.current = null;
    };
  }, [isDark, color, height]);

  useEffect(() => {
    if (!seriesRef.current) return;
    const points: LineData<Time>[] = sliced.map((p) => ({
      time: p.time as Time,
      value: p.value,
    }));
    seriesRef.current.setData(points);
    chartRef.current?.timeScale().fitContent();
  }, [sliced]);

  const lastLabel = last
    ? `${last.value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })} ${unit}`
    : '—';

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-base font-medium truncate">{title}</div>
          <div className="text-xl font-semibold text-foreground tabular-nums mt-0.5">
            {lastLabel}
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
