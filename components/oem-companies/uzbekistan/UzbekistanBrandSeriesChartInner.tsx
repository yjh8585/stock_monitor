'use client';

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
import { useChartHeight } from '@/lib/useChartHeight';
import type { UzbekistanBrandSeriesPoint } from '@/lib/oem-companies/uzbekistan/source';
import { DATA_LABEL_STYLE, GRID_STROKE_OPACITY } from '../common/chartStyle';

interface Props {
  data: UzbekistanBrandSeriesPoint[];
  color?: string;
  unitLabel?: string;
}

function fmtUnitsTick(n: number): string {
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return n.toLocaleString('ko-KR');
}

function fmtBarLabel(value: unknown): string {
  if (value == null) return '';
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return n.toLocaleString('ko-KR');
}

function fmtYoy(v: unknown): string {
  if (v == null) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

export default function UzbekistanBrandSeriesChartInner({
  data,
  color = '#2563eb',
  unitLabel = '대',
}: Props) {
  const height = useChartHeight(240, 280, 320);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 28, right: 60, bottom: 10, left: 10 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          className="stroke-border"
          strokeOpacity={GRID_STROKE_OPACITY}
        />
        <XAxis dataKey="period_label" className="text-sm" tick={{ fontSize: 14 }} />
        <YAxis yAxisId="left" tickFormatter={fmtUnitsTick} className="text-sm" width={60} />
        <YAxis
          yAxisId="right"
          orientation="right"
          tickFormatter={(v) => `${v}%`}
          className="text-sm"
          width={50}
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)' }}
          contentStyle={{
            backgroundColor: 'var(--card)',
            border: '1px solid var(--border)',
            fontSize: '14px',
          }}
          formatter={(value, name) => {
            if (name === 'YoY') return [fmtYoy(value), 'YoY'];
            return [`${Number(value ?? 0).toLocaleString('ko-KR')} ${unitLabel}`, '생산'];
          }}
        />
        <Legend wrapperStyle={{ fontSize: '14px', paddingBottom: 8 }} />
        <Bar
          yAxisId="left"
          dataKey="units"
          name="생산"
          fill={color}
          radius={[3, 3, 0, 0]}
          isAnimationActive={false}
        >
          <LabelList
            dataKey="units"
            position="top"
            formatter={fmtBarLabel}
            style={DATA_LABEL_STYLE}
          />
        </Bar>
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="yoy_pct"
          name="YoY"
          stroke="#dc2626"
          strokeWidth={2}
          dot={{ r: 3, fill: '#dc2626' }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
