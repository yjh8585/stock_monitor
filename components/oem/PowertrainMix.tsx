'use client';

import { useMemo } from 'react';
import { useChartHeight } from '@/lib/useChartHeight';
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

/** PowerTrain Mix 추이 — 100% 스택 영역 차트 (월별 ICE/HV/PHEV/EV/FCV 비중)
 *  'Other'(원본 PowerTrain 분류 불가) 행은 비중 계산에서 제외한다.
 */
const PT_VISIBLE: PowerTrain[] = PT_ORDER.filter((p) => p !== 'Other') as PowerTrain[];
const YM_START = 202101; // 2020년은 PowerTrain 분류 노이즈 많아 제외 — 2021년부터 표시

export default function PowertrainMix({ groupPtMonth }: Props) {
  const h = useChartHeight(200, 260, 320);
  const data = useMemo(() => {
    // ym → pt → sales (Other 제외, 2021년부터)
    const byYm = new Map<number, Map<string, number>>();
    for (const r of groupPtMonth) {
      if (r.powertrain === 'Other') continue;
      if (r.year_month < YM_START) continue;
      if (!byYm.has(r.year_month)) byYm.set(r.year_month, new Map());
      const inner = byYm.get(r.year_month)!;
      inner.set(r.powertrain, (inner.get(r.powertrain) ?? 0) + r.sales);
    }

    const sorted = [...byYm.entries()].sort((a, b) => a[0] - b[0]);
    return sorted.map(([ym, ptMap]) => {
      const total = [...ptMap.values()].reduce((a, b) => a + b, 0);
      const row: Record<string, number | string> = { ym, label: ymLabel(ym) };
      for (const pt of PT_VISIBLE) {
        const sales = ptMap.get(pt) ?? 0;
        row[pt] = total > 0 ? (sales / total) * 100 : 0;
      }
      return row;
    });
  }, [groupPtMonth]);

  return (
    <div>
      <div className="text-[11px] text-muted-foreground mb-2">
        PowerTrain이 &lsquo;Other&rsquo;(분류 불가)인 판매량은 비중 계산에서 제외됨
      </div>
      <ResponsiveContainer width="100%" height={h}>
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
          <Legend
            layout="horizontal"
            verticalAlign="top"
            align="center"
            wrapperStyle={{ fontSize: '11px', paddingBottom: 8 }}
          />
          {PT_VISIBLE.map((pt) => (
            <Area
              key={pt}
              type="monotone"
              dataKey={pt}
              stackId="1"
              stroke={PT_COLORS[pt]}
              fill={PT_COLORS[pt]}
              fillOpacity={0.85}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
