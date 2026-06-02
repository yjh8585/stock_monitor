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
import type { StellantisNaBrandStackPoint } from '@/lib/types';
import { GRID_STROKE_OPACITY } from '../common/chartStyle';
import { useHiddenSeries } from '../common/useHiddenSeries';
import {
  STELLANTIS_NA_BRAND_COLORS,
  sortBrandsByTotal,
} from '@/lib/oem-companies/stellantis-na/aggregate';

interface Props {
  quarterly: StellantisNaBrandStackPoint[];
  annual: StellantisNaBrandStackPoint[];
}

type ViewMode = 'year' | 'quarter';

interface ChartRow {
  period_label: string;
  total: number;
  /** brand별 비중(%) + 절대값 units (tooltip용). */
  [key: string]: number | string;
}

/** points → 비중(%) + units(tooltip 보조) 행. */
function toPctRows(points: StellantisNaBrandStackPoint[], brands: string[]): ChartRow[] {
  return points.map((p) => {
    const row: ChartRow = { period_label: p.period_label, total: p.total };
    const totalSafe = p.total > 0 ? p.total : 1;
    for (const b of brands) {
      const v = p.brands[b] ?? 0;
      row[b] = (v / totalSafe) * 100;
      row[`${b}_units`] = v;
    }
    return row;
  });
}

export default function StellantisNaBrandMixChartInner({ quarterly, annual }: Props) {
  const [mode, setMode] = useState<ViewMode>('year');
  const height = useChartHeight(240, 280, 320);
  const { isHidden, legendProps } = useHiddenSeries();

  const data = mode === 'year' ? annual : quarterly;

  const { chartData, brandOrder } = useMemo(() => {
    const order = sortBrandsByTotal(data);
    const rows = toPctRows(data, order);
    return { chartData: rows, brandOrder: order };
  }, [data]);

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
          data={chartData}
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
            width={50}
          />
          <Tooltip
            contentStyle={TOOLTIP_CONTENT_STYLE}
            formatter={(value, name, item) => {
              const pct = Number(value ?? 0);
              const key = String(name);
              const units =
                (item?.payload as Record<string, number> | undefined)?.[`${key}_units`] ?? 0;
              return [`${units.toLocaleString('ko-KR')}대 (${pct.toFixed(1)}%)`, key];
            }}
            itemSorter={(item) => -(item.value as number)}
          />
          <Legend
            layout="horizontal"
            verticalAlign="top"
            align="center"
            wrapperStyle={{ fontSize: '16px', paddingBottom: 8 }}
            itemSorter={null}
            {...legendProps}
          />
          {brandOrder.map((b) => (
            <Area
              key={b}
              type="monotone"
              dataKey={b}
              name={b}
              stackId="brand"
              stroke={STELLANTIS_NA_BRAND_COLORS[b] ?? '#94a3b8'}
              fill={STELLANTIS_NA_BRAND_COLORS[b] ?? '#94a3b8'}
              fillOpacity={0.85}
              isAnimationActive={false}
              hide={isHidden(b)}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
