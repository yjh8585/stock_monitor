'use client';

/**
 * 오늘 분봉 가격(상단 pane) + 외국인/기관/개인 잠정 누적(하단 pane).
 * - lightweight-charts v5 pane API 사용 (paneIndex 인자).
 * - 시간축 공유 → 가격 등락과 수급 변화 시점 정렬해서 읽기.
 * - 아래 코멘트 영역: buildIntradayCommentary 결과 2~3줄.
 */
import { useEffect, useRef } from 'react';
import { createChart, LineSeries, type IChartApi } from 'lightweight-charts';
import type { IntradayPoint, IntradaySupplyPoint } from '@/lib/hansae/data';
import { buildIntradayCommentary } from '@/lib/hansae/intradayCommentary';

interface Props {
  intraday: IntradayPoint[];
  supply: IntradaySupplyPoint[];
  height?: number;
}

const SUPPLY_SERIES = [
  { key: 'foreignNet' as const, color: '#f59e0b', label: '외국인' },
  { key: 'institutionNet' as const, color: '#10b981', label: '기관' },
  { key: 'individualNet' as const, color: '#0ea5e9', label: '개인' },
];

export default function IntradayCombinedChart({ intraday, supply, height = 360 }: Props) {
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

    // ── pane 0: 가격 라인
    const priceSeries = chart.addSeries(
      LineSeries,
      {
        color: '#000000',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        title: '가격',
      },
      0,
    );
    const priceData = intraday
      .map((d) => ({
        time: Math.floor(new Date(d.ts).getTime() / 1000) as unknown as number,
        value: d.price,
      }))
      .sort((a, b) => (a.time as unknown as number) - (b.time as unknown as number))
      .filter((p, i, arr) => i === 0 || p.time !== arr[i - 1].time);
    priceSeries.setData(priceData as Parameters<typeof priceSeries.setData>[0]);

    // ── pane 1: 외국인/기관/개인 누적 라인
    for (const s of SUPPLY_SERIES) {
      const series = chart.addSeries(
        LineSeries,
        {
          color: s.color,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          title: s.label,
        },
        1,
      );
      const points = supply
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

    // pane 높이 조정 (가격 60% / 수급 40%)
    try {
      const panes = chart.panes();
      if (panes.length >= 2) {
        panes[0].setHeight(Math.round(height * 0.6));
        panes[1].setHeight(Math.round(height * 0.4));
      }
    } catch {
      // pane API 없으면 기본 분배 사용
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) chart.applyOptions({ width: entry.contentRect.width });
    });
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [intraday, supply, height]);

  const commentary = buildIntradayCommentary(intraday, supply);

  if (intraday.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-muted-foreground"
        style={{ height }}
      >
        장중 데이터 없음
      </div>
    );
  }
  return (
    <div className="w-full">
      <div ref={containerRef} style={{ width: '100%', height }} />
      {commentary && (
        <div className="mt-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm">
          <div className="font-medium">{commentary.headline}</div>
          <div className="text-muted-foreground mt-0.5">{commentary.detail}</div>
          {commentary.cause && (
            <div className="text-muted-foreground mt-0.5">↳ {commentary.cause}</div>
          )}
        </div>
      )}
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        <span>● 가격(검정)</span>
        <span className="text-amber-600">● 외국인</span>
        <span className="text-emerald-600">● 기관</span>
        <span className="text-sky-600">● 개인</span>
        <span>· 수급은 KIS 잠정 슬롯 갱신(09:30/11:20/13:20/14:30)</span>
      </div>
    </div>
  );
}
