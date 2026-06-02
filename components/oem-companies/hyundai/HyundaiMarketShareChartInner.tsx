'use client';

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TOOLTIP_CONTENT_STYLE_SM } from '@/components/charts/chartTheme';
import { useChartHeight } from '@/lib/useChartHeight';
import type { HyundaiMarketSharePoint } from '@/lib/types';
import { GRID_STROKE_OPACITY } from '../common/chartStyle';
import { useHiddenSeries } from '../common/useHiddenSeries';

interface Props {
  data: HyundaiMarketSharePoint[];
}

function fmtPctTick(n: number): string {
  return `${n.toFixed(1)}%`;
}

function fmtUnitsTick(n: number): string {
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(0)}만`;
  return n.toLocaleString('ko-KR');
}

/** US 시장 점유율(%) line + 시장 전체(industry_total) area, 듀얼 축. */
export default function HyundaiMarketShareChartInner({ data }: Props) {
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
          label={{ value: '시장 전체(대)', angle: -90, position: 'insideLeft', fontSize: 11 }}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tickFormatter={fmtPctTick}
          className="text-sm"
          width={50}
          domain={[0, 'auto']}
          label={{ value: 'HMC 점유율(%)', angle: 90, position: 'insideRight', fontSize: 11 }}
        />
        <Tooltip
          contentStyle={TOOLTIP_CONTENT_STYLE_SM}
          formatter={(value, name, item) => {
            if (value == null) return ['—', String(name)];
            const v = Number(value);
            if (name === 'HMC 점유율') {
              const payload = item?.payload as HyundaiMarketSharePoint | undefined;
              const hmc = payload?.hmc_retail ?? null;
              const hmcLabel = hmc != null ? ` (HMC ${hmc.toLocaleString('ko-KR')}대)` : '';
              return [`${v.toFixed(2)}%${hmcLabel}`, 'HMC 점유율'];
            }
            if (name === '시장 전체') {
              return [`${v.toLocaleString('ko-KR')}대`, '시장 전체'];
            }
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
        <Area
          yAxisId="left"
          type="monotone"
          dataKey="industry_total"
          name="시장 전체"
          stroke="#94a3b8"
          fill="#94a3b8"
          fillOpacity={0.25}
          isAnimationActive={false}
          connectNulls
          hide={isHidden('industry_total')}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="market_share_pct"
          name="HMC 점유율"
          stroke="#16a34a"
          strokeWidth={2}
          dot={{ r: 2, fill: '#16a34a' }}
          isAnimationActive={false}
          connectNulls
          hide={isHidden('market_share_pct')}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
