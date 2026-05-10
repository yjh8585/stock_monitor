'use client';

import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { OemSalesGroupMonth } from '@/lib/types';
import { fmtFull, fmtUnits, totalByMonth, ymLabel } from './helpers';

interface Props {
  groupMonth: OemSalesGroupMonth[];
}

/** 글로벌 시장 월별 추이 — 84개월 영역 라인 차트 */
export default function MarketTrendChart({ groupMonth }: Props) {
  const data = useMemo(
    () =>
      totalByMonth(groupMonth).map((d) => ({
        ym: d.ym,
        label: ymLabel(d.ym),
        sales: d.sales,
      })),
    [groupMonth]
  );

  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
        <defs>
          <linearGradient id="marketTrendGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#2563eb" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="label" className="text-xs" tick={{ fontSize: 10 }} interval={5} />
        <YAxis tickFormatter={(v) => fmtUnits(v)} className="text-xs" width={60} />
        <Tooltip
          formatter={(v) => [fmtFull(Number(v)) + ' 대', '판매량']}
          contentStyle={{
            backgroundColor: 'var(--card)',
            border: '1px solid var(--border)',
            fontSize: '12px',
          }}
        />
        <Area
          type="monotone"
          dataKey="sales"
          stroke="#2563eb"
          strokeWidth={2}
          fill="url(#marketTrendGrad)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
