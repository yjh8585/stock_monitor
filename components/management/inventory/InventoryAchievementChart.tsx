'use client';

import { useCallback, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useChartHeight } from '@/lib/useChartHeight';
import { OEM_COLORS } from '@/components/oem/helpers';
import { LegendRow } from '@/components/management/plan/PlanAchievementChart';
import type { AchievementMonthPoint } from '@/lib/inventory/types';

function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('ko-KR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const BASE = OEM_COLORS[0];
const PLAN_COLOR = hexToRgba(BASE, 0.4);

interface Props {
  points: AchievementMonthPoint[];
  unitLabel?: string;
}

/**
 * 차트 2/3 공통 — 월별 X축, 계획·실적 막대 (달성율 제거).
 * 재고는 달성율 표시가 부적절(낮을수록 좋음 등 의미가 P&L과 반대) → 두 막대 비교만.
 * 범례 클릭으로 계획/실적 시리즈 토글.
 */
export default function InventoryAchievementChart({ points, unitLabel = '억원' }: Props) {
  const h = useChartHeight(360, 440, 520);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggle = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  if (points.length === 0) {
    return (
      <div className="py-12 text-center text-base text-muted-foreground">데이터가 없습니다.</div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={h}>
      <ComposedChart data={points} margin={{ top: 32, right: 24, bottom: 10, left: 10 }} barGap={2}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
        <XAxis
          dataKey="monthLabel"
          tick={{ fontSize: 12 }}
          interval={0}
          angle={-30}
          textAnchor="end"
          height={56}
        />
        <YAxis
          tickFormatter={(v: number) => fmt(v, 0)}
          tick={{ fontSize: 13 }}
          width={70}
          domain={[0, (max: number) => Math.max(max * 1.2, 1)]}
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
          contentStyle={{
            backgroundColor: 'var(--card)',
            border: '1px solid var(--border)',
            fontSize: '14px',
          }}
          content={<Tip unitLabel={unitLabel} />}
        />
        <Legend
          verticalAlign="top"
          wrapperStyle={{ paddingBottom: 4 }}
          content={() => (
            <LegendRow
              items={[
                { key: 'plan', label: '계획', shape: 'rect', color: PLAN_COLOR },
                { key: 'actual', label: '실적', shape: 'rect', color: BASE },
              ]}
              hidden={hidden}
              onToggle={toggle}
            />
          )}
        />
        <Bar
          dataKey="plan"
          name="계획"
          fill={PLAN_COLOR}
          radius={[2, 2, 0, 0]}
          hide={hidden.has('plan')}
        />
        <Bar
          dataKey="actual"
          name="실적"
          fill={BASE}
          radius={[2, 2, 0, 0]}
          hide={hidden.has('actual')}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function Tip({
  active,
  payload,
  label,
  unitLabel,
}: {
  active?: boolean;
  payload?: Array<{ payload: AchievementMonthPoint }>;
  label?: string;
  unitLabel: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div
      className="rounded-md p-2 text-sm"
      style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <div className="font-semibold mb-1">{label}</div>
      <div>
        계획: {fmt(p.plan, 0)} {unitLabel}
      </div>
      <div>
        실적: {fmt(p.actual, 0)} {unitLabel}
      </div>
    </div>
  );
}
