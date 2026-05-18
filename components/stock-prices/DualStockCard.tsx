'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import MultiSeriesChart, { type MultiSeriesItem } from '@/components/charts/MultiSeriesChart';
import StockPairSelector from './StockPairSelector';
import type { StockCompany } from '@/lib/types';
import type { SeriesPoint } from '@/lib/series';

interface Props {
  title: string;
  unit: string;
  source: string;
  companies: readonly StockCompany[];
  /** 초기 선택 ticker. */
  defaultTickers?: readonly [string, string];
}

const PRIMARY_COLOR = '#2962FF';
const SECONDARY_COLOR = '#ef4444';

/** 한 카드 내에서 두 종목을 선택해 듀얼 Y축 라인 차트로 비교.
 *  시계열은 /api/stock-prices?id=... 로 클라이언트에서 받아 메모리 캐시. */
export default function DualStockCard({ title, unit, source, companies, defaultTickers }: Props) {
  const [selection, setSelection] = useState(() => {
    const findId = (ticker: string) =>
      companies.find((c) => c.ticker === ticker)?.id ?? companies[0]?.id ?? '';
    if (defaultTickers) {
      return { primary: findId(defaultTickers[0]), secondary: findId(defaultTickers[1]) };
    }
    return { primary: companies[0]?.id ?? '', secondary: companies[1]?.id ?? '' };
  });
  const [seriesCache, setSeriesCache] = useState<Record<string, SeriesPoint[]>>({});
  const inflightRef = useRef<Set<string>>(new Set());

  const { primary, secondary } = selection;

  useEffect(() => {
    const toFetch = [primary, secondary].filter(
      (id) => id && !seriesCache[id] && !inflightRef.current.has(id)
    );
    if (toFetch.length === 0) return;
    toFetch.forEach((id) => inflightRef.current.add(id));

    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        toFetch.map(async (id) => {
          try {
            const res = await fetch(`/api/stock-prices?id=${encodeURIComponent(id)}`, {
              cache: 'force-cache',
            });
            if (!res.ok) return [id, [] as SeriesPoint[]] as const;
            const data = (await res.json()) as { series: SeriesPoint[] };
            return [id, data.series ?? []] as const;
          } catch {
            return [id, [] as SeriesPoint[]] as const;
          } finally {
            inflightRef.current.delete(id);
          }
        })
      );
      if (cancelled) return;
      setSeriesCache((prev) => {
        const next = { ...prev };
        for (const [id, series] of entries) next[id] = series;
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [primary, secondary, seriesCache]);

  const series = useMemo<MultiSeriesItem[]>(() => {
    const items: MultiSeriesItem[] = [];
    const primaryCompany = companies.find((c) => c.id === primary);
    if (primaryCompany) {
      items.push({
        label: primaryCompany.name_kr,
        color: PRIMARY_COLOR,
        data: seriesCache[primary] ?? [],
      });
    }
    const secondaryCompany = companies.find((c) => c.id === secondary);
    if (secondaryCompany && secondary !== primary) {
      items.push({
        label: secondaryCompany.name_kr,
        color: SECONDARY_COLOR,
        data: seriesCache[secondary] ?? [],
      });
    }
    return items;
  }, [companies, primary, secondary, seriesCache]);

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">{title}</div>
        <StockPairSelector
          companies={companies}
          primary={primary}
          secondary={secondary}
          onPrimaryChange={(v) => setSelection((prev) => ({ ...prev, primary: v }))}
          onSecondaryChange={(v) => setSelection((prev) => ({ ...prev, secondary: v }))}
        />
      </div>
      {series.length > 0 ? (
        <MultiSeriesChart
          title=""
          unit={unit}
          source={source}
          series={series}
          height={320}
          initialRange="1y"
          secondaryFor={series.length === 2 ? [1] : undefined}
        />
      ) : (
        <div className="flex h-80 items-center justify-center text-sm text-muted-foreground">
          종목을 선택하세요
        </div>
      )}
    </div>
  );
}
