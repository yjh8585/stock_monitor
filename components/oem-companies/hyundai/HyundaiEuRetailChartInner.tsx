'use client';

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useChartHeight } from '@/lib/useChartHeight';
import type { HyundaiEuRetailPoint } from '@/lib/types';
import { GRID_STROKE_OPACITY } from '../common/chartStyle';
import { useHiddenSeries } from '../common/useHiddenSeries';

interface Props {
  data: HyundaiEuRetailPoint[];
}

function fmtUnitsTick(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(0)}만`;
  return n.toLocaleString('ko-KR');
}

function fmtPctTick(n: number): string {
  return `${n.toFixed(0)}%`;
}

/** EU 월별 retail bar(좌축) + YoY% line(우축). Legend 클릭으로 시리즈 hide/show (#1). */
export default function HyundaiEuRetailChartInner({ data }: Props) {
  const height = useChartHeight(260, 300, 340);
  const { isHidden, legendProps } = useHiddenSeries();

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 10, right: 24, bottom: 10, left: 10 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          className="stroke-border"
          strokeOpacity={GRID_STROKE_OPACITY}
        />
        <XAxis
          dataKey="period_label"
          className="text-sm"
          tick={{ fontSize: 12 }}
          interval="preserveStartEnd"
          minTickGap={24}
        />
        <YAxis
          yAxisId="left"
          tickFormatter={fmtUnitsTick}
          className="text-sm"
          width={60}
          label={{ value: '월별 retail(대)', angle: -90, position: 'insideLeft', fontSize: 11 }}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tickFormatter={fmtPctTick}
          className="text-sm"
          width={50}
          label={{ value: 'YoY(%)', angle: 90, position: 'insideRight', fontSize: 11 }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--card)',
            border: '1px solid var(--border)',
            fontSize: '14px',
          }}
          formatter={(value, name) => {
            if (value == null) return ['—', String(name)];
            const v = Number(value);
            if (name === '월 retail') return [`${v.toLocaleString('ko-KR')}대`, '월 retail'];
            if (name === 'YoY %') return [`${v.toFixed(1)}%`, 'YoY %'];
            return [`${v.toLocaleString('ko-KR')}`, String(name)];
          }}
        />
        <Legend
          layout="horizontal"
          verticalAlign="top"
          align="center"
          wrapperStyle={{ fontSize: '14px', paddingBottom: 8 }}
          {...legendProps}
        />
        <Bar
          yAxisId="left"
          dataKey="retail_units"
          name="월 retail"
          fill="#2563eb"
          isAnimationActive={false}
          radius={[2, 2, 0, 0]}
          hide={isHidden('retail_units')}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="yoy_pct"
          name="YoY %"
          stroke="#dc2626"
          strokeWidth={2}
          dot={{ r: 2, fill: '#dc2626' }}
          isAnimationActive={false}
          connectNulls
          hide={isHidden('yoy_pct')}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
