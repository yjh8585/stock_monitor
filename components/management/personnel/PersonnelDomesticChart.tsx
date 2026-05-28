'use client';

import { useCallback, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useChartHeight } from '@/lib/useChartHeight';
import { LegendRow } from '@/components/management/plan/PlanAchievementChart';
import type { DomesticStackPoint } from '@/lib/personnel/types';

/** 숫자 포맷 (ko-KR, 천 단위). */
function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('ko-KR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

/** part / total 비중 % 문자열. */
function pctOf(part: number | null | undefined, total: number | null | undefined): string {
  if (part === null || part === undefined || total === null || total === undefined || total === 0)
    return '—';
  return `${((part / total) * 100).toFixed(1)}%`;
}

const COLORS = {
  domestic: '#2563eb', // blue-600
  internal: '#16a34a', // green-600
  partner: '#ea580c', // orange-600
};

interface Props {
  points: DomesticStackPoint[];
}

/**
 * 차트 2 — 국내 인원 현황 (3층 누적막대).
 * 국내(11개 detail 합) / 사내외주 / 협력사원.
 */
export default function PersonnelDomesticChart({ points }: Props) {
  const h = useChartHeight(380, 460, 540);
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
      <ComposedChart data={points} margin={{ top: 32, right: 24, bottom: 10, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
        <XAxis dataKey="periodLabel" tick={{ fontSize: 13 }} />
        <YAxis tickFormatter={(v: number) => fmt(v, 0)} tick={{ fontSize: 13 }} width={70} />
        <Tooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
          contentStyle={{
            backgroundColor: 'var(--card)',
            border: '1px solid var(--border)',
            fontSize: '16px',
          }}
          content={<DomesticTooltip />}
        />
        <Legend
          verticalAlign="top"
          wrapperStyle={{ paddingBottom: 4 }}
          content={() => (
            <LegendRow
              items={[
                { key: 'domestic', label: '국내', shape: 'rect', color: COLORS.domestic },
                { key: 'internal', label: '사내외주', shape: 'rect', color: COLORS.internal },
                { key: 'partner', label: '협력사원', shape: 'rect', color: COLORS.partner },
              ]}
              hidden={hidden}
              onToggle={toggle}
            />
          )}
        />
        <Bar
          dataKey="domestic"
          name="국내"
          stackId="d"
          fill={COLORS.domestic}
          hide={hidden.has('domestic')}
        />
        <Bar
          dataKey="internal"
          name="사내외주"
          stackId="d"
          fill={COLORS.internal}
          hide={hidden.has('internal')}
        />
        <Bar
          dataKey="partner"
          name="협력사원"
          stackId="d"
          fill={COLORS.partner}
          hide={hidden.has('partner')}
        >
          <LabelList
            dataKey="total"
            position="top"
            formatter={(v: unknown) => (typeof v === 'number' ? fmt(v, 0) : '')}
            style={{ fontSize: 16, fill: 'var(--foreground)', fontWeight: 600 }}
          />
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** 호버 툴팁 — 국내/사내외주/협력사원 + 비중. */
function DomesticTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: DomesticStackPoint }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div
      className="rounded-md p-2 text-base"
      style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <div className="font-semibold mb-1">{label}</div>
      <div>
        국내: {fmt(p.domestic, 0)}{' '}
        <span className="text-muted-foreground">({pctOf(p.domestic, p.total)})</span>
      </div>
      <div>
        사내외주: {fmt(p.internal, 0)}{' '}
        <span className="text-muted-foreground">({pctOf(p.internal, p.total)})</span>
      </div>
      <div>
        협력사원: {fmt(p.partner, 0)}{' '}
        <span className="text-muted-foreground">({pctOf(p.partner, p.total)})</span>
      </div>
      <div className="font-semibold pt-1 mt-1 border-t border-border">합계: {fmt(p.total, 0)}</div>
    </div>
  );
}
