'use client';

import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TOOLTIP_CONTENT_STYLE } from '@/components/charts/chartTheme';
import { useChartHeight } from '@/lib/useChartHeight';
import type { CompanyPtMixPoint } from '@/lib/types';
import { GRID_STROKE_OPACITY } from '../common/chartStyle';
import { useHiddenSeries } from '../common/useHiddenSeries';

interface Props {
  quarterly: CompanyPtMixPoint[];
  annual: CompanyPtMixPoint[];
}

type ViewMode = 'year' | 'quarter';

/** PT 색상 + stack 순서 — 공통 CompanyPowertrainMixChart와 동일. */
const PT_SERIES = [
  { key: 'ICE', color: '#94a3b8' },
  { key: 'HV', color: '#fbbf24' },
  { key: 'PHEV', color: '#fb923c' },
  { key: 'EV', color: '#22c55e' },
  { key: 'FCEV', color: '#06b6d4' },
  { key: 'Multi', color: '#eab308' },
  { key: 'Unknown', color: '#cbd5e1' },
] as const;

type PtKey = (typeof PT_SERIES)[number]['key'];

interface ChartRow {
  period_label: string;
  total: number;
  ICE: number;
  HV: number;
  PHEV: number;
  EV: number;
  FCEV: number;
  Multi: number;
  Unknown: number;
}

function toPctRows(points: CompanyPtMixPoint[]): ChartRow[] {
  return points.map((p) => {
    const row: ChartRow = {
      period_label: p.period_label,
      total: p.total,
      ICE: 0,
      HV: 0,
      PHEV: 0,
      EV: 0,
      FCEV: 0,
      Multi: 0,
      Unknown: 0,
    };
    if (p.total <= 0) return row;
    for (const { key } of PT_SERIES) {
      row[key] = (p[key] / p.total) * 100;
    }
    return row;
  });
}

function sortPtByTotal(rows: CompanyPtMixPoint[]): PtKey[] {
  const totals = new Map<PtKey, number>();
  for (const { key } of PT_SERIES) totals.set(key, 0);
  for (const r of rows) {
    for (const { key } of PT_SERIES) {
      totals.set(key, (totals.get(key) ?? 0) + r[key]);
    }
  }
  return PT_SERIES.map((s) => s.key).sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
}

/** Stellantis NA PT mix Inner — 분기/연 토글. Unknown 큼 → 매핑 보강 신호. */
export default function StellantisNaPtMixChartInner({ quarterly, annual }: Props) {
  const [mode, setMode] = useState<ViewMode>('year');
  const height = useChartHeight(240, 280, 320);
  const { isHidden, legendProps } = useHiddenSeries();

  const data = useMemo<ChartRow[]>(
    () => toPctRows(mode === 'year' ? annual : quarterly),
    [mode, quarterly, annual]
  );
  const ptOrder = useMemo(
    () => sortPtByTotal(mode === 'year' ? annual : quarterly),
    [mode, quarterly, annual]
  );
  const colorByKey = useMemo(() => {
    const m: Record<string, string> = {};
    for (const { key, color } of PT_SERIES) m[key] = color;
    return m;
  }, []);

  return (
    <div>
      <div
        role="tablist"
        aria-label="기간 단위 선택"
        className="mb-3 flex items-center gap-2 text-sm"
      >
        <button
          role="tab"
          type="button"
          aria-selected={mode === 'year'}
          onClick={() => setMode('year')}
          className={`rounded-md border px-3 py-1 transition-colors ${
            mode === 'year'
              ? 'border-foreground bg-foreground text-background'
              : 'border-border text-muted-foreground hover:bg-muted'
          }`}
        >
          연간
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={mode === 'quarter'}
          onClick={() => setMode('quarter')}
          className={`rounded-md border px-3 py-1 transition-colors ${
            mode === 'quarter'
              ? 'border-foreground bg-foreground text-background'
              : 'border-border text-muted-foreground hover:bg-muted'
          }`}
        >
          분기
        </button>
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <AreaChart
          data={data}
          margin={{ top: 10, right: 20, bottom: 10, left: 10 }}
          stackOffset="expand"
        >
          <CartesianGrid
            strokeDasharray="3 3"
            className="stroke-border"
            strokeOpacity={GRID_STROKE_OPACITY}
            vertical={mode === 'quarter'}
          />
          <XAxis
            dataKey="period_label"
            className="text-sm"
            tick={{ fontSize: 14 }}
            interval="preserveStartEnd"
            minTickGap={20}
          />
          <YAxis
            tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
            className="text-sm"
            width={60}
          />
          <Tooltip
            formatter={(v, name) => [`${Number(v).toFixed(1)}%`, String(name)]}
            itemSorter={(item) => -(item.value as number)}
            contentStyle={TOOLTIP_CONTENT_STYLE}
          />
          <Legend
            layout="horizontal"
            verticalAlign="top"
            align="center"
            wrapperStyle={{ fontSize: '16px', paddingBottom: 8 }}
            itemSorter={null}
            {...legendProps}
          />
          {ptOrder.map((key) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              name={key}
              stackId="pt"
              stroke={colorByKey[key]}
              fill={colorByKey[key]}
              fillOpacity={0.85}
              isAnimationActive={false}
              hide={isHidden(key)}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
