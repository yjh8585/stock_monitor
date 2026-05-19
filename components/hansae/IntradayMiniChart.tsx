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
      grid: {
        vertLines: { color: 'rgba(127,127,127,0.08)' },
        horzLines: { color: 'rgba(127,127,127,0.08)' },
      },
      rightPriceScale: { visible: true, borderVisible: false },
      // 같은 일자 안의 5분봉이 다수일 때 일자 라벨이 반복 표시되는 것을 피하기 위해
      // timeVisible 을 켠다 — lightweight-charts 가 자동으로 같은 날에서는 시각(HH:mm)을
      // 표시하고 날짜가 바뀌는 지점에서만 일자 라벨을 노출한다.
      timeScale: {
        visible: true,
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: true,
      handleScale: true,
    });
    chartRef.current = chart;

    const series = chart.addSeries(LineSeries, {
      color: '#000000',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const seriesData = data
      .map((d) => ({
        time: Math.floor(new Date(d.ts).getTime() / 1000) as unknown as number,
        value: d.price,
      }))
      // time 동일하면 lightweight-charts가 throw → 중복 제거 + 정렬
      .sort((a, b) => (a.time as unknown as number) - (b.time as unknown as number))
      .filter((p, i, arr) => i === 0 || p.time !== arr[i - 1].time);
    series.setData(
      seriesData as { time: number; value: number }[] as Parameters<typeof series.setData>[0]
    );
    chart.timeScale().fitContent();

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
        className="flex items-center justify-center text-sm text-muted-foreground"
        style={{ height }}
      >
        장중 데이터 없음
      </div>
    );
  }
  return <div ref={containerRef} style={{ width: '100%', height }} />;
}
