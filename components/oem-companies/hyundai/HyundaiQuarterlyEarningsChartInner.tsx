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
import { TOOLTIP_CONTENT_STYLE_SM } from '@/components/charts/chartTheme';
import { useChartHeight } from '@/lib/useChartHeight';
import type { CustomerEarningsPoint } from '@/lib/customers/types';
import type { HyundaiQuarterlyEarningsPoint } from '@/lib/types';
import { DATA_LABEL_STYLE, GRID_STROKE_OPACITY, Y_AXIS_PADDED_DOMAIN } from '../common/chartStyle';
import { revenueFormat } from '../common/revenueFormat';
import { useHiddenSeries } from '../common/useHiddenSeries';

interface Props {
  data: HyundaiQuarterlyEarningsPoint[] | CustomerEarningsPoint[];
  /** 매출 막대 칸 — 현대 IR = revenue_krw_bn, 고객사(financials) = revenue_bn. 둘 다 십억 단위. */
  revenueKey?: 'revenue_krw_bn' | 'revenue_bn';
  /** 매출 표기 통화(기본 KRW = 조원 표기). */
  currency?: string;
  /** 영업이익률 축을 음수까지 연다(적자 회사). 기본 false = 0 부터. */
  allowNegativeMargin?: boolean;
}

function fmtOpmTick(n: number): string {
  return `${n.toFixed(1)}%`;
}

/** 분기 매출 + 영업이익률 듀얼 축 ComposedChart.
 *  bar: revenueKey (왼쪽 Y축, 십억 단위 → 통화별 표기는 revenueFormat)
 *  line: operating_margin_pct (오른쪽 Y축, %)
 *  recharts는 NULL 데이터에 대해 자동으로 점 생략. */
export default function HyundaiQuarterlyEarningsChartInner({
  data,
  revenueKey = 'revenue_krw_bn',
  currency = 'KRW',
  allowNegativeMargin = false,
}: Props) {
  const fmt = revenueFormat(currency);
  // 배열 유니온(A[] | B[])은 ComposedChart 제네릭이 못 받아 원소 유니온 배열로 넓힌다(캐스트 아님).
  const rows: readonly (HyundaiQuarterlyEarningsPoint | CustomerEarningsPoint)[] = data;
  const height = useChartHeight(260, 300, 340);
  const { isHidden, legendProps } = useHiddenSeries();

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={{ top: 32, right: 24, bottom: 10, left: 10 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          className="stroke-border"
          strokeOpacity={GRID_STROKE_OPACITY}
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
          tickFormatter={fmt.tick}
          className="text-sm"
          width={50}
          domain={Y_AXIS_PADDED_DOMAIN}
          label={{ value: fmt.axisLabel, angle: -90, position: 'insideLeft', fontSize: 11 }}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tickFormatter={fmtOpmTick}
          className="text-sm"
          width={50}
          domain={allowNegativeMargin ? ['auto', 'auto'] : [0, 'auto']}
          label={{ value: '영업이익률(%)', angle: 90, position: 'insideRight', fontSize: 11 }}
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)' }}
          contentStyle={TOOLTIP_CONTENT_STYLE_SM}
          formatter={(value, name) => {
            if (value == null) return ['—', String(name)];
            const v = Number(value);
            if (name === '매출') return [fmt.tooltip(v), '매출'];
            if (name === '영업이익률') return [`${v.toFixed(2)}%`, '영업이익률'];
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
          dataKey={revenueKey}
          name="매출"
          fill="#2563eb"
          isAnimationActive={false}
          radius={[3, 3, 0, 0]}
          hide={isHidden(revenueKey)}
        >
          <LabelList
            dataKey={revenueKey}
            position="top"
            formatter={fmt.label}
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
