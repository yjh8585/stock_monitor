'use client';

import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { OemSalesGroupPtMonth, PowerTrain } from '@/lib/types';
import { ymLabel, PT_COLORS, PT_ORDER } from './helpers';

interface Props {
  groupPtMonth: OemSalesGroupPtMonth[];
}

/** PowerTrain Mix 추이 — 100% 스택 영역 차트 (월별 ICE/HV/PHEV/EV/FCV/Other 비중) */
export default function PowertrainMix({ groupPtMonth }: Props) {
  const data = useMemo(() => {
    // ym → pt → sales
    const byYm = new Map<number, Map<string, number>>();
    for (const r of groupPtMonth) {
      if (!byYm.has(r.year_month)) byYm.set(r.year_month, new Map());
      const inner = byYm.get(r.year_month)!;
      inner.set(r.powertrain, (inner.get(r.powertrain) ?? 0) + r.sales);
    }

    const sorted = [...byYm.entries()].sort((a, b) => a[0] - b[0]);
    return sorted.map(([ym, ptMap]) => {
      const total = [...ptMap.values()].reduce((a, b) => a + b, 0);
      const row: Record<string, number | string> = { ym, label: ymLabel(ym) };
      for (const pt of PT_ORDER) {
        const sales = ptMap.get(pt) ?? 0;
        row[pt] = total > 0 ? (sales / total) * 100 : 0;
      }
      return row;
    });
  }, [groupPtMonth]);

  return (
    <ResponsiveContainer width="100%" height={320}>
      <AreaChart
        data={data}
        margin={{ top: 10, right: 20, bottom: 10, left: 10 }}
        stackOffset="expand"
      >
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="label" className="text-xs" tick={{ fontSize: 10 }} interval={5} />
        <YAxis tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} className="text-xs" width={50} />
        <Tooltip
          formatter={(v, name) => [`${Number(v).toFixed(1)}%`, String(name)]}
          contentStyle={{
            backgroundColor: 'var(--card)',
            border: '1px solid var(--border)',
            fontSize: '11px',
          }}
        />
        <Legend wrapperStyle={{ fontSize: '11px' }} />
        {PT_ORDER.map((pt) => (
          <Area
            key={pt}
            type="monotone"
            dataKey={pt}
            stackId="1"
            stroke={PT_COLORS[pt as PowerTrain]}
            fill={PT_COLORS[pt as PowerTrain]}
            fillOpacity={0.85}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
