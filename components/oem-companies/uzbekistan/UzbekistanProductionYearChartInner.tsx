'use client';

import { useMemo } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { OEM_COLORS } from '@/components/oem/helpers';
import { useChartHeight } from '@/lib/useChartHeight';
import type { UzbekistanProductionYearPoint } from '@/lib/oem-companies/uzbekistan/source';
import { DATA_LABEL_STYLE, GRID_STROKE_OPACITY } from '../common/chartStyle';
import { useHiddenSeries } from '../common/useHiddenSeries';

interface Props {
  annual: UzbekistanProductionYearPoint[];
}

function fmtUnitsTick(n: number): string {
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return n.toLocaleString('ko-KR');
}

function fmtTotalLabel(value: unknown): string {
  if (value == null) return '';
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return n.toLocaleString('ko-KR');
}

function sortBrandsByTotal(data: UzbekistanProductionYearPoint[]): string[] {
  const totals = new Map<string, number>();
  for (const p of data) {
    for (const [name, v] of Object.entries(p.brands)) {
      totals.set(name, (totals.get(name) ?? 0) + v);
    }
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
}

export default function UzbekistanProductionYearChartInner({ annual }: Props) {
  const height = useChartHeight(240, 280, 320);
  const { isHidden, legendProps } = useHiddenSeries();

  const { brands, chartData } = useMemo(() => {
    const names = sortBrandsByTotal(annual);
    const rows = annual.map((d) => ({
      period_label: d.period_label,
      total: d.total,
      ...Object.fromEntries(names.map((n) => [n, d.brands[n] ?? 0])),
    }));
    return { brands: names, chartData: rows };
  }, [annual]);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={chartData} margin={{ top: 28, right: 20, bottom: 10, left: 10 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          className="stroke-border"
          strokeOpacity={GRID_STROKE_OPACITY}
        />
        <XAxis
          dataKey="period_label"
          className="text-sm"
          tick={{ fontSize: 14 }}
          interval="preserveStartEnd"
        />
        <YAxis tickFormatter={fmtUnitsTick} className="text-sm" width={60} />
        <Tooltip
          cursor={{ fill: 'var(--muted)' }}
          contentStyle={{
            backgroundColor: 'var(--card)',
            border: '1px solid var(--border)',
            fontSize: '15px',
          }}
          formatter={(value, name, item) => {
            const v = Number(value ?? 0);
            const total = Number((item?.payload as { total?: number } | undefined)?.total ?? 0);
            const pct = total > 0 ? (v / total) * 100 : 0;
            return [`${v.toLocaleString('ko-KR')}대 (${pct.toFixed(1)}%)`, String(name)];
          }}
          itemSorter={(item) => -(item.value as number)}
        />
        <Legend
          layout="horizontal"
          verticalAlign="top"
          align="center"
          wrapperStyle={{ fontSize: '14px', paddingBottom: 16 }}
          itemSorter={null}
          {...legendProps}
        />
        {brands.map((b, i) => {
          const isLast = i === brands.length - 1;
          return (
            <Bar
              key={b}
              dataKey={b}
              name={b}
              stackId="brand"
              fill={OEM_COLORS[i % OEM_COLORS.length]}
              isAnimationActive={false}
              radius={isLast ? [3, 3, 0, 0] : undefined}
              hide={isHidden(b)}
            />
          );
        })}
        <Line
          type="linear"
          dataKey="total"
          stroke="transparent"
          dot={false}
          activeDot={false}
          isAnimationActive={false}
          legendType="none"
        >
          <LabelList
            dataKey="total"
            position="top"
            formatter={fmtTotalLabel}
            style={DATA_LABEL_STYLE}
          />
        </Line>
      </ComposedChart>
    </ResponsiveContainer>
  );
}
