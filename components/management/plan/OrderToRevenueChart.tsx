'use client';

import { useCallback, useMemo, useState } from 'react';
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
import { ChartSection } from './_selectors';
import { LegendRow } from './PlanAchievementChart';
import { useChartHeight } from '@/lib/useChartHeight';
import { buildOrderToRevenue, type ConversionPoint } from '@/lib/plan/aggregate';
import type { PreparedPnlData } from '@/lib/pnl/aggregate';
import type { PlanRow } from '@/lib/plan/types';

const COLOR_ORDER = '#2563eb'; // blue-600
const COLOR_RATE = '#dc2626'; // red-600

function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('ko-KR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

/**
 * 12. 수주 → 매출 conversion.
 *
 * - 막대: t년 수주액(억원).
 * - 라인: (t+1년 매출 / t년 수주액) × 100. 100% 미만 = lag/loss, 초과 = 잔존 수주 반영.
 * - 도메인 압축: 막대 plot 하단 ~40%, 라인 상단 ~60%.
 */
export default function OrderToRevenueChart({
  rows,
  prepared,
}: {
  rows: PlanRow[];
  prepared: PreparedPnlData;
}) {
  const points: ConversionPoint[] = useMemo(
    () => buildOrderToRevenue(rows, prepared),
    [rows, prepared]
  );

  const rateMax = Math.max(
    100,
    ...points.map((p) => (p.conversionRate === null ? 0 : Math.abs(p.conversionRate)))
  );

  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggle = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const h = useChartHeight(320, 360, 400);

  return (
    <ChartSection title="12. 수주 → 매출 Conversion" unit="억원 · %">
      {points.length === 0 ? (
        <div className="py-12 text-center text-base text-muted-foreground">데이터가 없습니다.</div>
      ) : (
        <ResponsiveContainer width="100%" height={h}>
          <ComposedChart
            data={points}
            margin={{ top: 40, right: 24, bottom: 8, left: 8 }}
            barCategoryGap="25%"
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
            <XAxis dataKey="yearLabel" tick={{ fontSize: 13 }} />
            <YAxis
              yAxisId="amount"
              tickFormatter={(v: number) => fmt(v)}
              tick={{ fontSize: 13 }}
              width={72}
              domain={[0, (max: number) => Math.max(max * 2.5, 1)]}
            />
            <YAxis
              yAxisId="rate"
              orientation="right"
              tickFormatter={(v: number) => `${Math.round(v)}%`}
              tick={{ fontSize: 13 }}
              width={56}
              domain={[-rateMax * 1.5, rateMax * 1.1]}
            />
            <Tooltip
              cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
              content={<ConversionTooltip />}
            />
            <Legend
              verticalAlign="top"
              wrapperStyle={{ paddingBottom: 4 }}
              content={() => (
                <LegendRow
                  items={[
                    { key: 'order', label: 't년 수주액', shape: 'rect', color: COLOR_ORDER },
                    {
                      key: 'rate',
                      label: '(t+1) 매출 conversion',
                      shape: 'line',
                      color: COLOR_RATE,
                    },
                  ]}
                  hidden={hidden}
                  onToggle={toggle}
                />
              )}
            />
            <Bar
              yAxisId="amount"
              dataKey="orderAmount"
              name="t년 수주액"
              fill={COLOR_ORDER}
              radius={[2, 2, 0, 0]}
              hide={hidden.has('order')}
            >
              <LabelList
                dataKey="orderAmount"
                position="top"
                formatter={(value: unknown) => (typeof value === 'number' ? fmt(value) : '')}
                style={{ fontSize: 13, fill: 'var(--foreground)', fontWeight: 500 }}
              />
            </Bar>
            <Line
              yAxisId="rate"
              type="monotone"
              dataKey="conversionRate"
              name="conversion"
              stroke={COLOR_RATE}
              strokeWidth={2.5}
              dot={{ r: 5, fill: COLOR_RATE }}
              connectNulls
              hide={hidden.has('rate')}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="conversionRate"
                position="top"
                formatter={(value: unknown) =>
                  typeof value === 'number' ? `${fmt(value, 1)}%` : ''
                }
                style={{ fontSize: 13, fill: COLOR_RATE, fontWeight: 600 }}
                offset={14}
              />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </ChartSection>
  );
}

function ConversionTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: ConversionPoint }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div
      className="rounded-md p-2 text-sm"
      style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <div className="font-semibold mb-1">{label}</div>
      <div>t년 수주액: {fmt(p.orderAmount)} 억원</div>
      <div>(t+1)년 매출: {fmt(p.nextRevenue)} 억원</div>
      <div className="text-red-600 font-medium">
        Conversion: {p.conversionRate === null ? '—' : `${fmt(p.conversionRate, 1)}%`}
      </div>
    </div>
  );
}
