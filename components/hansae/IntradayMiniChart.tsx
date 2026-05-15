'use client';

/** 종목 카드 안에 들어가는 5분봉 미니 라인 차트. lightweight-charts 사용. */
import { useEffect, useRef } from 'react';
import { createChart, LineSeries, type IChartApi } from 'lightweight-charts';
import type { IntradayPoint } from '@/lib/hansae/data';

interface Props {
  data: IntradayPoint[];
  changePct: number | null;
  height?: number;
}

export default function IntradayMiniChart({ data, changePct, height = 80 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      height,
      width: containerRef.current.clientWidth,
      layout: { background: { color: 'transparent' }, textColor: '#999' },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { visible: false },
      timeScale: { visible: false },
      handleScroll: false,
      handleScale: false,
    });
    chartRef.current = chart;

    const color = (changePct ?? 0) >= 0 ? '#ef4444' : '#3b82f6'; // 한국 관례: 양봉 빨강
    const series = chart.addSeries(LineSeries, {
      color,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const seriesData = data.map((d) => ({
      time: Math.floor(new Date(d.ts).getTime() / 1000) as unknown as number,
      value: d.price,
    }));
    series.setData(
      seriesData as { time: number; value: number }[] as Parameters<typeof series.setData>[0]
    );

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        chart.applyOptions({ width: entry.contentRect.width });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [data, changePct, height]);

  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-[11px] text-muted-foreground"
        style={{ height }}
      >
        장중 데이터 없음
      </div>
    );
  }
  return <div ref={containerRef} style={{ width: '100%', height }} />;
}
