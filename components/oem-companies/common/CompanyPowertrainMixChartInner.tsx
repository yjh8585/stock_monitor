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
import { useChartHeight } from '@/lib/useChartHeight';
import type { CompanyPtMixPoint } from '@/lib/types';
import { GRID_STROKE_OPACITY } from './chartStyle';
import { useHiddenSeries } from './useHiddenSeries';

interface Props {
  monthly: CompanyPtMixPoint[];
  annual: CompanyPtMixPoint[];
}

type ViewMode = 'year' | 'month';

/**
 * PT 키 + 색상 + Area stack 순서.
 * 색상 사양 (사용자 피드백 #7):
 *  ICE=#94a3b8 / HV=#fbbf24 / PHEV=#fb923c / EV=#22c55e / FCEV=#06b6d4 / Multi=#eab308 / Unknown=#cbd5e1
 */
const PT_SERIES = [
  { key: 'ICE', color: '#94a3b8' },
  { key: 'HV', color: '#fbbf24' },
  { key: 'PHEV', color: '#fb923c' },
  { key: 'EV', color: '#22c55e' },
  { key: 'FCEV', color: '#06b6d4' },
  { key: 'Multi', color: '#eab308' },
  { key: 'Unknown', color: '#cbd5e1' },
] as const;

interface ChartRow {
  period_label: string;
  total: number;
  /** PT별 비중 % (스택용, 합계 100). */
  ICE: number;
  HV: number;
  PHEV: number;
  EV: number;
  FCEV: number;
  Multi: number;
  Unknown: number;
}

/** CompanyPtMixPoint[] → 비중(%) 매핑. total=0 행은 0%. */
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

type PtKey = (typeof PT_SERIES)[number]['key'];

/** 합계 큰 PT 우선 — Legend/stack 모두 같은 순서 (#5). */
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

export default function CompanyPowertrainMixChartInner({ monthly, annual }: Props) {
  const [mode, setMode] = useState<ViewMode>('year');
  const height = useChartHeight(240, 280, 320);
  const { isHidden, legendProps } = useHiddenSeries();

  const data = useMemo<ChartRow[]>(
    () => toPctRows(mode === 'year' ? annual : monthly),
    [mode, monthly, annual]
  );
  const ptOrder = useMemo(
    () => sortPtByTotal(mode === 'year' ? annual : monthly),
    [mode, monthly, annual]
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
        className="flex items-center gap-2 mb-3 text-sm"
      >
        <button
          role="tab"
          type="button"
          aria-selected={mode === 'year'}
          onClick={() => setMode('year')}
          className={`px-3 py-1 rounded-md border transition-colors ${
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
          aria-selected={mode === 'month'}
          onClick={() => setMode('month')}
          className={`px-3 py-1 rounded-md border transition-colors ${
            mode === 'month'
              ? 'border-foreground bg-foreground text-background'
              : 'border-border text-muted-foreground hover:bg-muted'
          }`}
        >
          월간
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
            vertical={mode === 'month'}
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
            contentStyle={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              fontSize: '16px',
            }}
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
              hide={isHidden(key)}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
