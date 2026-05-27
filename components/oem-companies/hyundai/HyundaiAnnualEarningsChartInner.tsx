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
import type { HyundaiAnnualEarningsPoint } from '@/lib/types';
import { DATA_LABEL_STYLE, GRID_STROKE_OPACITY, Y_AXIS_PADDED_DOMAIN } from '../common/chartStyle';
import { useHiddenSeries } from '../common/useHiddenSeries';

interface Props {
  data: HyundaiAnnualEarningsPoint[];
}

function fmtRevenueTick(n: number): string {
  return `${(n / 1000).toFixed(0)}조`;
}

function fmtOpmTick(n: number): string {
  return `${n.toFixed(1)}%`;
}

/** 매출 막대 위 데이터 라벨 — bn → 조원. */
function fmtRevenueLabel(value: unknown): string {
  if (value == null) return '';
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '';
  return `${(n / 1000).toFixed(1)}조`;
}

/** 연간 실적 ComposedChart — 분기 합산(YTD 포함) + 가중평균 opm. */
export default function HyundaiAnnualEarningsChartInner({ data }: Props) {
  const height = useChartHeight(260, 300, 340);
  const { isHidden, legendProps } = useHiddenSeries();

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 32, right: 24, bottom: 10, left: 10 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          className="stroke-border"
          strokeOpacity={GRID_STROKE_OPACITY}
          vertical={false}
        />
        <XAxis
          dataKey="period_label"
          className="text-sm"
          tick={{ fontSize: 13 }}
          interval="preserveStartEnd"
          minTickGap={10}
        />
        <YAxis
          yAxisId="left"
          tickFormatter={fmtRevenueTick}
          className="text-sm"
          width={50}
          domain={Y_AXIS_PADDED_DOMAIN}
          label={{ value: '매출(조원)', angle: -90, position: 'insideLeft', fontSize: 11 }}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tickFormatter={fmtOpmTick}
          className="text-sm"
          width={50}
          domain={[0, 'auto']}
          label={{ value: '영업이익률(%)', angle: 90, position: 'insideRight', fontSize: 11 }}
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)' }}
          contentStyle={{
            backgroundColor: 'var(--card)',
            border: '1px solid var(--border)',
            fontSize: '14px',
          }}
          formatter={(value, name, item) => {
            if (value == null) return ['—', String(name)];
            const v = Number(value);
            const payload = item?.payload as HyundaiAnnualEarningsPoint | undefined;
            const ytdSuffix = payload?.is_ytd ? ` (YTD: ${payload.quarters_used}분기)` : '';
            if (name === '매출') {
              const tn = v / 1000;
              return [
                `${v.toLocaleString('ko-KR')} 십억원 (≈${tn.toFixed(1)}조원)${ytdSuffix}`,
                '매출',
              ];
            }
            if (name === '영업이익률') {
              return [`${v.toFixed(2)}%${ytdSuffix}`, '영업이익률'];
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
        <Bar
          yAxisId="left"
          dataKey="revenue_krw_bn"
          name="매출"
          fill="#2563eb"
          isAnimationActive={false}
          radius={[3, 3, 0, 0]}
          hide={isHidden('revenue_krw_bn')}
        >
          <LabelList
            dataKey="revenue_krw_bn"
            position="top"
            formatter={fmtRevenueLabel}
            style={DATA_LABEL_STYLE}
          />
        </Bar>
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="operating_margin_pct"
          name="영업이익률"
          stroke="#dc2626"
          strokeWidth={2}
          dot={{ r: 3, fill: '#dc2626' }}
          isAnimationActive={false}
          connectNulls
          hide={isHidden('operating_margin_pct')}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
