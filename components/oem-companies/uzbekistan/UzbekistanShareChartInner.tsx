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
import { TOOLTIP_CONTENT_STYLE_SM } from '@/components/charts/chartTheme';
import { OEM_COLORS } from '@/components/oem/helpers';
import { useChartHeight } from '@/lib/useChartHeight';
import type { UzbekistanShareRow } from '@/lib/oem-companies/uzbekistan/source';
import { GRID_STROKE_OPACITY } from '../common/chartStyle';
import { useHiddenSeries } from '../common/useHiddenSeries';

interface Props {
  data: UzbekistanShareRow[];
}

function sortByLatest(data: UzbekistanShareRow[]): string[] {
  if (data.length === 0) return [];
  const last = data[data.length - 1].shares;
  return Object.keys(last).sort((a, b) => (last[b] ?? 0) - (last[a] ?? 0));
}

function fmtPct(v: unknown): string {
  if (v == null) return '';
  const n = Number(v);
  if (!Number.isFinite(n) || n < 5) return '';
  return `${n.toFixed(0)}%`;
}

export default function UzbekistanShareChartInner({ data }: Props) {
  const height = useChartHeight(240, 280, 320);
  const { isHidden, legendProps } = useHiddenSeries();
  const { keys, chartData } = useMemo(() => {
    const k = sortByLatest(data);
    const rows = data.map((d) => ({
      period_label: d.period_label,
      total: d.total,
      ...Object.fromEntries(k.map((kk) => [kk, d.shares[kk] ?? 0])),
    }));
    return { keys: k, chartData: rows };
  }, [data]);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} margin={{ top: 20, right: 20, bottom: 10, left: 10 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          className="stroke-border"
          strokeOpacity={GRID_STROKE_OPACITY}
          vertical={false}
        />
        <XAxis dataKey="period_label" className="text-sm" tick={{ fontSize: 14 }} />
        <YAxis tickFormatter={(v) => `${v}%`} domain={[0, 100]} className="text-sm" width={50} />
        <Tooltip
          cursor={{ fill: 'var(--muted)' }}
          contentStyle={TOOLTIP_CONTENT_STYLE_SM}
          formatter={(value, name) => [`${Number(value ?? 0).toFixed(1)}%`, String(name)]}
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
        {keys.map((k, i) => (
          <Bar
            key={k}
            dataKey={k}
            name={k}
            stackId="share"
            fill={OEM_COLORS[i % OEM_COLORS.length]}
            isAnimationActive={false}
            hide={isHidden(k)}
          >
            <LabelList
              dataKey={k}
              position="center"
              formatter={fmtPct}
              style={{ fill: '#fff', fontSize: 12, fontWeight: 600 }}
            />
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
