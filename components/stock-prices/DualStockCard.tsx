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
}

const PRIMARY_COLOR = '#2962FF';
const SECONDARY_COLOR = '#ef4444';

/** 한 카드 내에서 두 종목을 선택해 듀얼 Y축 라인 차트로 비교.
 *  시계열은 /api/stock-prices?id=... 로 클라이언트에서 받아 메모리 캐시. */
export default function DualStockCard({ title, unit, source, companies }: Props) {
  const storageKey = `stock-pair-${title}`;
  const [selection, setSelection] = useState({
    primary: companies[0]?.id ?? '',
    secondary: companies[1]?.id ?? '',
  });
  const [seriesCache, setSeriesCache] = useState<Record<string, SeriesPoint[]>>({});
  const inflightRef = useRef<Set<string>>(new Set());

  const { primary, secondary } = selection;

  // 마운트 시 localStorage에서 선택값 복원 (단일 상태 업데이트로 cascading render 방지)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved) as { primary: string; secondary: string };
      // localStorage는 브라우저 전용 외부 시스템 — useEffect에서 setState는 의도된 패턴
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelection((prev) => ({
        primary: companies.find((c) => c.id === parsed.primary) ? parsed.primary : prev.primary,
        secondary: companies.find((c) => c.id === parsed.secondary) ? parsed.secondary : prev.secondary,
      }));
    } catch {
      // 손상된 데이터 무시
    }
  // companies 배열은 서버에서 내려온 고정값이므로 의존성에서 제외
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

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
          onPrimaryChange={(v) => {
            setSelection((prev) => ({ ...prev, primary: v }));
            localStorage.setItem(storageKey, JSON.stringify({ primary: v, secondary }));
          }}
          onSecondaryChange={(v) => {
            setSelection((prev) => ({ ...prev, secondary: v }));
            localStorage.setItem(storageKey, JSON.stringify({ primary, secondary: v }));
          }}
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
