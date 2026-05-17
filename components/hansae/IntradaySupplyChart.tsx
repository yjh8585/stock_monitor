'use client';

/** 오늘 분 단위 잠정 누적 순매수 추세 차트.
 *  3개 라인(외국인/기관/개인) — stock_supply_demand_intraday 스냅샷. */
import { useEffect, useRef } from 'react';
import { createChart, LineSeries } from 'lightweight-charts';
import type { IntradaySupplyPoint } from '@/lib/hansae/data';

interface Props {
  data: IntradaySupplyPoint[];
  height?: number;
}

const SERIES = [
  { key: 'foreignNet' as const, color: '#f59e0b', label: '외국인' },
  { key: 'institutionNet' as const, color: '#10b981', label: '기관' },
  { key: 'individualNet' as const, color: '#0ea5e9', label: '개인' },
];

export default function IntradaySupplyChart({ data, height = 240 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      height,
      width: containerRef.current.clientWidth,
      layout: { background: { color: 'transparent' }, textColor: '#999' },
      grid: {
        vertLines: { color: 'rgba(127,127,127,0.08)' },
        horzLines: { color: 'rgba(127,127,127,0.08)' },
      },
      rightPriceScale: { visible: true, borderVisible: false },
      timeScale: {
        visible: true,
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: false,
      handleScale: false,
    });

    for (const s of SERIES) {
      const series = chart.addSeries(LineSeries, {
        color: s.color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        title: s.label,
      });
      const points = data
        .map((d) => {
          const v = d[s.key];
          if (v === null) return null;
          return {
            time: Math.floor(new Date(d.snapshotTs).getTime() / 1000) as unknown as number,
            value: v,
          };
        })
        .filter((p): p is { time: number; value: number } => p !== null)
        .sort((a, b) => (a.time as unknown as number) - (b.time as unknown as number))
        .filter((p, i, arr) => i === 0 || p.time !== arr[i - 1].time);
      series.setData(points as Parameters<typeof series.setData>[0]);
    }
    chart.timeScale().fitContent();

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) chart.applyOptions({ width: entry.contentRect.width });
    });
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [data, height]);

  if (data.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center text-sm text-muted-foreground gap-1"
        style={{ height }}
      >
        <span>오늘 장중 잠정 수급 데이터 없음</span>
        <span>(평일 09:00~15:35 cron이 5분마다 채웁니다)</span>
      </div>
    );
  }
  return <div ref={containerRef} style={{ width: '100%', height }} />;
}
