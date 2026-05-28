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
import { buildImprovementContribution, type ImprovementPoint } from '@/lib/plan/aggregate';
import type { PreparedPnlData } from '@/lib/pnl/aggregate';
import type { PlanRow } from '@/lib/plan/types';

const COLOR_VE = '#16a34a'; // green-600
const COLOR_MCIP = '#0891b2'; // cyan-600
const COLOR_PRICE = '#9333ea'; // purple-600
const COLOR_RATE = '#dc2626'; // red-600

function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('ko-KR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

/**
 * 13. 손익개선 종합 효과.
 *
 * - 막대 stacked: Design VE / MCIP / 단가인상 (백만원).
 * - 라인: (3개 합) / 영업이익 × 100 = 기여율(%).
 * - 영업이익 fallback: pnl_entries 우선, 없으면 pnl_plan.손익.영업이익 actual.
 */
export default function ImprovementContributionChart({
  rows,
  prepared,
}: {
  rows: PlanRow[];
  prepared: PreparedPnlData;
}) {
  const points: ImprovementPoint[] = useMemo(
    () => buildImprovementContribution(rows, prepared),
    [rows, prepared]
  );

  const rateMax = Math.max(
    10,
    ...points.map((p) => (p.contribRate === null ? 0 : Math.abs(p.contribRate)))
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
    <ChartSection title="13. 손익개선 종합 효과" unit="백만원 · %">
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
              content={<ImprovementTooltip />}
            />
            <Legend
              verticalAlign="top"
              wrapperStyle={{ paddingBottom: 4 }}
              content={() => (
                <LegendRow
                  items={[
                    { key: 've', label: 'Design VE', shape: 'rect', color: COLOR_VE },
                    { key: 'mcip', label: 'MCIP', shape: 'rect', color: COLOR_MCIP },
                    { key: 'price', label: '단가인상', shape: 'rect', color: COLOR_PRICE },
                    { key: 'rate', label: '영업이익 기여율', shape: 'line', color: COLOR_RATE },
                  ]}
                  hidden={hidden}
                  onToggle={toggle}
                />
              )}
            />
            <Bar
              yAxisId="amount"
              dataKey="designVe"
              name="Design VE"
              stackId="improve"
              fill={COLOR_VE}
              hide={hidden.has('ve')}
            />
            <Bar
              yAxisId="amount"
              dataKey="mcip"
              name="MCIP"
              stackId="improve"
              fill={COLOR_MCIP}
              hide={hidden.has('mcip')}
            />
            <Bar
              yAxisId="amount"
              dataKey="priceUp"
              name="단가인상"
              stackId="improve"
              fill={COLOR_PRICE}
              radius={[2, 2, 0, 0]}
              hide={hidden.has('price')}
            >
              <LabelList
                dataKey="total"
                position="top"
                formatter={(value: unknown) => (typeof value === 'number' ? fmt(value) : '')}
                style={{ fontSize: 13, fill: 'var(--foreground)', fontWeight: 500 }}
              />
            </Bar>
            <Line
              yAxisId="rate"
              type="monotone"
              dataKey="contribRate"
              name="기여율"
              stroke={COLOR_RATE}
              strokeWidth={2.5}
              dot={{ r: 5, fill: COLOR_RATE }}
              connectNulls
              hide={hidden.has('rate')}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="contribRate"
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

function ImprovementTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: ImprovementPoint }>;
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
      <div>Design VE: {fmt(p.designVe)} 백만원</div>
      <div>MCIP: {fmt(p.mcip)} 백만원</div>
      <div>단가인상: {fmt(p.priceUp)} 백만원</div>
      <div className="mt-1 border-t border-border/40 pt-1 font-medium">
        합계: {fmt(p.total)} 백만원
      </div>
      <div className="text-red-600 font-medium">
        영업이익 기여율: {p.contribRate === null ? '—' : `${fmt(p.contribRate, 1)}%`}
      </div>
    </div>
  );
}
