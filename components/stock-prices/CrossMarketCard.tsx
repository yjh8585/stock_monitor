'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import MultiSeriesChart, { type MultiSeriesItem } from '@/components/charts/MultiSeriesChart';
import StockPairSelector from './StockPairSelector';
import type { StockCompany } from '@/lib/types';
import type { SeriesPoint } from '@/lib/series';

interface Props {
  primaryCompanies: readonly StockCompany[];
  secondaryCompanies: readonly StockCompany[];
  defaultPrimaryTicker?: string;
  defaultSecondaryTicker?: string;
}

const PRIMARY_COLOR = '#2962FF';
const SECONDARY_COLOR = '#ef4444';

/** 국내×해외 듀얼 Y축 비교 카드.
 *  좌축 = 국내(KRW), 우축 = 해외(USD). */
export default function CrossMarketCard({
  primaryCompanies,
  secondaryCompanies,
  defaultPrimaryTicker,
  defaultSecondaryTicker,
}: Props) {
  const [selection, setSelection] = useState(() => {
    const findPrimary = (ticker: string) =>
      primaryCompanies.find((c) => c.ticker === ticker)?.id ?? primaryCompanies[0]?.id ?? '';
    const findSecondary = (ticker: string) =>
      secondaryCompanies.find((c) => c.ticker === ticker)?.id ?? secondaryCompanies[0]?.id ?? '';
    return {
      primary: defaultPrimaryTicker
        ? findPrimary(defaultPrimaryTicker)
        : (primaryCompanies[0]?.id ?? ''),
      secondary: defaultSecondaryTicker
        ? findSecondary(defaultSecondaryTicker)
        : (secondaryCompanies[0]?.id ?? ''),
    };
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
        for (const [id, s] of entries) next[id] = s;
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [primary, secondary, seriesCache]);

  const series = useMemo<MultiSeriesItem[]>(() => {
    const items: MultiSeriesItem[] = [];
    const primaryCompany = primaryCompanies.find((c) => c.id === primary);
    if (primaryCompany) {
      items.push({
        label: primaryCompany.name_kr,
        color: PRIMARY_COLOR,
        data: seriesCache[primary] ?? [],
      });
    }
    const secondaryCompany = secondaryCompanies.find((c) => c.id === secondary);
    if (secondaryCompany) {
      items.push({
        label: secondaryCompany.name_kr,
        color: SECONDARY_COLOR,
        data: seriesCache[secondary] ?? [],
      });
    }
    return items;
  }, [primaryCompanies, secondaryCompanies, primary, secondary, seriesCache]);

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-base font-semibold">국내×해외</div>
        <StockPairSelector
          companies={primaryCompanies}
          secondaryCompanies={secondaryCompanies}
          primary={primary}
          secondary={secondary}
          onPrimaryChange={(v) => setSelection((prev) => ({ ...prev, primary: v }))}
          onSecondaryChange={(v) => setSelection((prev) => ({ ...prev, secondary: v }))}
        />
      </div>
      {series.length > 0 ? (
        <MultiSeriesChart
          title=""
          unit="KRW / USD"
          source="KRX / Yahoo Finance"
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
