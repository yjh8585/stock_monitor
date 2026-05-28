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
import { ChartSection } from '@/components/management/plan/_selectors';
import { LegendRow } from '@/components/management/plan/PlanAchievementChart';
import type { StatusMonthPoint } from '@/lib/inventory/types';

function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('ko-KR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

const COLORS = {
  operating: '#2563eb',
  management: '#16a34a',
  compensation: '#ea580c',
  transport: '#7c3aed',
  turnover: '#dc2626',
};

interface Props {
  points: StatusMonthPoint[];
}

/**
 * 차트 1 — 재고 현황 (실적만).
 * - 누적막대 4개 층 (운영/관리/보상/운송) + 합계 데이터 레이블
 * - 우축 회전율 꺾은선
 */
export default function InventoryStatusChart({ points }: Props) {
  const h = useChartHeight(380, 460, 540);
  if (points.length === 0) {
    return (
      <ChartSection title="1. 재고 현황 (실적)" unit="억원 / 회">
        <div className="py-12 text-center text-base text-muted-foreground">데이터가 없습니다.</div>
      </ChartSection>
    );
  }
  const turnoverMax = Math.max(1, ...points.map((p) => p.turnover ?? 0));
  return (
    <ChartSection title="1. 재고 현황 (실적)" unit="억원 / 회">
      <ResponsiveContainer width="100%" height={h}>
        <ComposedChart data={points} margin={{ top: 32, right: 24, bottom: 10, left: 10 }}>
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
            yAxisId="amount"
            tickFormatter={(v: number) => fmt(v, 0)}
            tick={{ fontSize: 13 }}
            width={70}
          />
          <YAxis
            yAxisId="turnover"
            orientation="right"
            tickFormatter={(v: number) => `${v.toFixed(1)}회`}
            tick={{ fontSize: 13 }}
            width={56}
            domain={[0, turnoverMax * 1.3]}
          />
          <Tooltip
            cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
            contentStyle={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              fontSize: '14px',
            }}
            content={<StatusTooltip />}
          />
          <Legend
            verticalAlign="top"
            wrapperStyle={{ paddingBottom: 4 }}
            content={() => (
              <LegendRow
                items={[
                  { key: 'operating', label: '운영', shape: 'rect', color: COLORS.operating },
                  { key: 'management', label: '관리', shape: 'rect', color: COLORS.management },
                  { key: 'compensation', label: '보상', shape: 'rect', color: COLORS.compensation },
                  { key: 'transport', label: '운송', shape: 'rect', color: COLORS.transport },
                  { key: 'turnover', label: '회전율', shape: 'line', color: COLORS.turnover },
                ]}
              />
            )}
          />
          <Bar
            yAxisId="amount"
            dataKey="operating"
            name="운영"
            stackId="inv"
            fill={COLORS.operating}
          />
          <Bar
            yAxisId="amount"
            dataKey="management"
            name="관리"
            stackId="inv"
            fill={COLORS.management}
          />
          <Bar
            yAxisId="amount"
            dataKey="compensation"
            name="보상"
            stackId="inv"
            fill={COLORS.compensation}
          />
          <Bar
            yAxisId="amount"
            dataKey="transport"
            name="운송"
            stackId="inv"
            fill={COLORS.transport}
          >
            <LabelList
              dataKey="total"
              position="top"
              formatter={(v: unknown) => (typeof v === 'number' ? fmt(v, 0) : '')}
              style={{ fontSize: 12, fill: 'var(--foreground)', fontWeight: 600 }}
            />
          </Bar>
          <Line
            yAxisId="turnover"
            type="monotone"
            dataKey="turnover"
            name="회전율"
            stroke={COLORS.turnover}
            strokeWidth={2.5}
            dot={{ r: 4, fill: COLORS.turnover }}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartSection>
  );
}

function StatusTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: StatusMonthPoint }>;
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
      <div>운영: {fmt(p.operating, 0)} 억원</div>
      <div>관리: {fmt(p.management, 0)} 억원</div>
      <div>보상: {fmt(p.compensation, 0)} 억원</div>
      <div>운송: {fmt(p.transport, 0)} 억원</div>
      <div className="font-semibold pt-1 mt-1 border-t border-border">
        합계: {fmt(p.total, 0)} 억원
      </div>
      <div className="text-red-600">회전율: {fmt(p.turnover, 1)} 회</div>
    </div>
  );
}
