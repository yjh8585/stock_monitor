'use client';

import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useChartHeight } from '@/lib/useChartHeight';
import type { ShipmentStackedRow } from './ShipmentStackedHBarChart';
import { DATA_LABEL_STYLE, GRID_STROKE_OPACITY } from './chartStyle';
import { useHiddenSeries } from './useHiddenSeries';

interface Props {
  data: ShipmentStackedRow[];
}

const COLORS = {
  domestic: '#1e3a5f', // 진한 남색
  export: '#22c55e', // 녹색
  overseas: '#bbf7d0', // 연녹색
};

function fmtUnitsTick(n: number): string {
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return n.toLocaleString('ko-KR');
}

function fmtInside(value: unknown): string {
  if (value == null) return '';
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return n.toLocaleString('ko-KR');
}

function fmtTotal(value: unknown): string {
  if (value == null) return '';
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return n.toLocaleString('ko-KR');
}

export default function ShipmentStackedHBarChartInner({ data }: Props) {
  const height = useChartHeight(280, 360, 440);
  const { isHidden, legendProps } = useHiddenSeries();

  const chartData = useMemo(
    () =>
      data.map((d) => ({
        period_label: d.period_label,
        domestic: d.domestic,
        export: d.export,
        overseas: d.overseas,
        total: d.domestic + d.export + d.overseas,
      })),
    [data]
  );

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        layout="vertical"
        data={chartData}
        margin={{ top: 10, right: 80, bottom: 20, left: 50 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          className="stroke-border"
          strokeOpacity={GRID_STROKE_OPACITY}
          horizontal={false}
        />
        <XAxis type="number" tickFormatter={fmtUnitsTick} className="text-sm" />
        <YAxis
          type="category"
          dataKey="period_label"
          className="text-sm"
          tick={{ fontSize: 14 }}
          width={60}
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)' }}
          contentStyle={{
            backgroundColor: 'var(--card)',
            border: '1px solid var(--border)',
            fontSize: '14px',
          }}
          formatter={(value, name, item) => {
            const v = Number(value ?? 0);
            const total = Number((item?.payload as { total?: number } | undefined)?.total ?? 0);
            const pct = total > 0 ? (v / total) * 100 : 0;
            const label =
              name === 'domestic'
                ? '내수'
                : name === 'export'
                  ? '수출'
                  : name === 'overseas'
                    ? '해외'
                    : String(name);
            return [`${v.toLocaleString('ko-KR')}대 (${pct.toFixed(1)}%)`, label];
          }}
          itemSorter={(item) => -(item.value as number)}
        />
        <Legend
          wrapperStyle={{ fontSize: '14px' }}
          {...legendProps}
          formatter={(v) =>
            v === 'domestic' ? '내수' : v === 'export' ? '수출' : v === 'overseas' ? '해외' : v
          }
        />
        <Bar
          dataKey="domestic"
          name="domestic"
          stackId="ship"
          fill={COLORS.domestic}
          isAnimationActive={false}
          hide={isHidden('domestic')}
        >
          <LabelList
            dataKey="domestic"
            position="center"
            formatter={fmtInside}
            style={{ fill: '#fff', fontSize: 13, fontWeight: 600 }}
          />
        </Bar>
        <Bar
          dataKey="export"
          name="export"
          stackId="ship"
          fill={COLORS.export}
          isAnimationActive={false}
          hide={isHidden('export')}
        >
          <LabelList
            dataKey="export"
            position="center"
            formatter={fmtInside}
            style={{ fill: '#fff', fontSize: 13, fontWeight: 600 }}
          />
        </Bar>
        <Bar
          dataKey="overseas"
          name="overseas"
          stackId="ship"
          fill={COLORS.overseas}
          isAnimationActive={false}
          hide={isHidden('overseas')}
          radius={[0, 3, 3, 0]}
        >
          <LabelList
            dataKey="overseas"
            position="center"
            formatter={fmtInside}
            style={{ fill: '#1e3a5f', fontSize: 13, fontWeight: 600 }}
          />
          <LabelList
            dataKey="total"
            position="right"
            formatter={fmtTotal}
            style={DATA_LABEL_STYLE}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
