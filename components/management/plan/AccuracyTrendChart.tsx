'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartSection } from './_selectors';
import { LegendRow } from './PlanAchievementChart';
import { useChartHeight } from '@/lib/useChartHeight';
import { DEFAULT_ACCURACY_KPIS, buildAccuracySeries } from '@/lib/plan/aggregate';
import type { PreparedPnlData } from '@/lib/pnl/aggregate';
import type { PlanRow } from '@/lib/plan/types';

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${n.toFixed(1)}%`;
}

/**
 * 10. 다년 달성률 추이 — 6개 KPI의 연도별 달성률(%) multi-line.
 *
 * - 100% 기준선 표시(달성·미달성 시각화).
 * - 범례 클릭으로 라인 hide 토글.
 * - actual·plan 한쪽이라도 없는 연도/KPI는 null → connectNulls로 점프.
 */
export default function AccuracyTrendChart({
  rows,
  prepared,
}: {
  rows: PlanRow[];
  prepared: PreparedPnlData;
}) {
  const points = useMemo(
    () => buildAccuracySeries(rows, prepared, DEFAULT_ACCURACY_KPIS),
    [rows, prepared]
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
    <ChartSection title="10. 다년 달성률 추이" unit="%">
      {points.length === 0 ? (
        <div className="py-12 text-center text-base text-muted-foreground">데이터가 없습니다.</div>
      ) : (
        <ResponsiveContainer width="100%" height={h}>
          <ComposedChart data={points} margin={{ top: 24, right: 24, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
            <XAxis dataKey="yearLabel" tick={{ fontSize: 13 }} />
            <YAxis
              tickFormatter={(v: number) => `${v}%`}
              tick={{ fontSize: 13 }}
              width={56}
              domain={['auto', 'auto']}
            />
            <ReferenceLine
              y={100}
              stroke="#475569"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              ifOverflow="extendDomain"
            />
            <Tooltip
              cursor={{ stroke: 'var(--muted)', strokeWidth: 1 }}
              contentStyle={{
                backgroundColor: 'var(--card)',
                border: '1px solid var(--border)',
                fontSize: 14,
              }}
              formatter={(value: unknown) => (typeof value === 'number' ? fmt(value) : '—')}
            />
            <Legend
              verticalAlign="top"
              wrapperStyle={{ paddingBottom: 4 }}
              content={() => (
                <LegendRow
                  items={DEFAULT_ACCURACY_KPIS.map((k) => ({
                    key: k.key,
                    label: k.label,
                    shape: 'line',
                    color: k.color,
                  }))}
                  hidden={hidden}
                  onToggle={toggle}
                />
              )}
            />
            {DEFAULT_ACCURACY_KPIS.map((k) => (
              <Line
                key={k.key}
                type="monotone"
                dataKey={k.key}
                name={k.label}
                stroke={k.color}
                strokeWidth={2}
                dot={{ r: 4, fill: k.color }}
                connectNulls
                hide={hidden.has(k.key)}
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </ChartSection>
  );
}
