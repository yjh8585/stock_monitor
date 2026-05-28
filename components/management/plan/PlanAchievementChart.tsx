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
import { OEM_COLORS } from '@/components/oem/helpers';
import type { AchievementPoint } from '@/lib/plan/types';

/** hex → rgba (계획 막대 연한색). */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function fmt(n: number | null, digits = 0): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString('ko-KR', { maximumFractionDigits: digits });
}

interface Props {
  points: AchievementPoint[];
  /** 막대 단위 라벨 (예: '억원', 'USD 백만', '백만원') */
  unitLabel: string;
}

const BASE = OEM_COLORS[0]; // 실적(진한색)
const PLAN_COLOR = hexToRgba(BASE, 0.4); // 계획(연한색)
const RATE_COLOR = '#dc2626'; // 달성율 라인

export default function PlanAchievementChart({ points, unitLabel }: Props) {
  const h = useChartHeight(300, 380, 460);
  if (points.length === 0) {
    return <div className="py-12 text-center text-sm text-muted-foreground">데이터가 없습니다.</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={h}>
      <ComposedChart data={points} margin={{ top: 10, right: 20, bottom: 10, left: 10 }} barGap={2}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="yearLabel" tick={{ fontSize: 14 }} />
        <YAxis
          yAxisId="amount"
          tickFormatter={(v: number) => fmt(v)}
          tick={{ fontSize: 14 }}
          width={80}
          label={{ value: unitLabel, position: 'insideTopLeft', fontSize: 12, fill: 'var(--muted-foreground)' }}
        />
        <YAxis
          yAxisId="rate"
          orientation="right"
          tickFormatter={(v: number) => `${v}%`}
          tick={{ fontSize: 14 }}
          width={56}
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
          contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', fontSize: '15px' }}
          content={<AchievementTooltip unitLabel={unitLabel} />}
        />
        <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: 4, fontSize: 13 }} />
        <Bar yAxisId="amount" dataKey="plan" name="계획" fill={PLAN_COLOR} radius={[2, 2, 0, 0]} />
        <Bar yAxisId="amount" dataKey="actual" name="실적" fill={BASE} radius={[2, 2, 0, 0]} />
        <Line
          yAxisId="rate"
          type="monotone"
          dataKey="rate"
          name="달성율"
          stroke={RATE_COLOR}
          strokeWidth={2}
          dot={{ r: 4, fill: RATE_COLOR }}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function AchievementTooltip({
  active,
  payload,
  label,
  unitLabel,
}: {
  active?: boolean;
  payload?: Array<{ payload: AchievementPoint }>;
  label?: string;
  unitLabel: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md p-2 text-sm" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
      <div className="font-semibold mb-1">{label}</div>
      <div>계획: {fmt(p.plan)} {unitLabel}</div>
      <div>실적: {fmt(p.actual)} {unitLabel}</div>
      <div className={p.rate != null && p.rate < 100 ? 'text-red-500' : 'text-emerald-600'}>
        달성율: {p.rate == null ? '—' : `${fmt(p.rate, 1)}%`}
      </div>
    </div>
  );
}
