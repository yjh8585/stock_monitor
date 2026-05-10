'use client';

import { useMemo } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { OemSalesGroupMonth } from '@/lib/types';
import { fmtFull, fmtUnits, sumByGroup, ymLabel, OEM_COLORS } from './helpers';

interface Props {
  groupMonth: OemSalesGroupMonth[];
}

const TOP_N = 10;

/** TOP10 OEM 월별 판매량 멀티라인 차트 (X=YYYY.MM) */
export default function Top10MonthlyLines({ groupMonth }: Props) {
  const { chartData, oems } = useMemo(() => {
    const cur = sumByGroup(groupMonth, 202501, 202512);
    const top10 = [...cur.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
      .map(([g]) => g);
    const top10Set = new Set(top10);

    // ym → { ym, oem1: sales, oem2: sales, ... }
    const byYm = new Map<number, Record<string, number | string>>();
    for (const r of groupMonth) {
      if (!top10Set.has(r.oem_group)) continue;
      if (!byYm.has(r.year_month)) {
        byYm.set(r.year_month, { ym: r.year_month, label: ymLabel(r.year_month) });
      }
      byYm.get(r.year_month)![r.oem_group] = r.sales;
    }
    const data = [...byYm.values()].sort((a, b) => Number(a.ym) - Number(b.ym));
    // 빈 셀은 0으로 채움
    for (const row of data) {
      for (const g of top10) {
        if (row[g] == null) row[g] = 0;
      }
    }
    return { chartData: data, oems: top10 };
  }, [groupMonth]);

  return (
    <div>
      <ResponsiveContainer width="100%" height={420}>
        <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="label" className="text-xs" tick={{ fontSize: 10 }} interval={5} />
          <YAxis tickFormatter={(v) => fmtUnits(v)} className="text-xs" width={60} />
          <Tooltip
            formatter={(v, name) => [fmtFull(Number(v)) + ' 대', String(name)]}
            contentStyle={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              fontSize: '11px',
            }}
          />
          <Legend wrapperStyle={{ fontSize: '11px' }} />
          {oems.map((g, i) => (
            <Line
              key={g}
              type="monotone"
              dataKey={g}
              stroke={OEM_COLORS[i % OEM_COLORS.length]}
              strokeWidth={1.5}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
