'use client';

import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { OemSalesGroupMonth } from '@/lib/types';
import { annualByGroup, fmtFull, fmtUnits, sumByGroup, OEM_COLORS } from './helpers';

interface Props {
  groupMonth: OemSalesGroupMonth[];
}

const TOP_N = 10;
const YEARS = [2020, 2021, 2022, 2023, 2024, 2025, 2026];

/** TOP10 OEM 연간 판매량 그룹 막대 차트 (X=연도, Series=OEM) */
export default function Top10AnnualBars({ groupMonth }: Props) {
  const { chartData, oems } = useMemo(() => {
    // 2025년 기준 TOP10
    const cur = sumByGroup(groupMonth, 202501, 202512);
    const top10 = [...cur.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
      .map(([g]) => g);

    const annual = annualByGroup(groupMonth);
    // X축 = 연도, 각 행 = 한 연도, 컬럼 = TOP10 OEM
    const data = YEARS.map((yr) => {
      const row: Record<string, number | string> = { year: String(yr) };
      for (const g of top10) {
        row[g] = annual.get(g)?.get(yr) ?? 0;
      }
      return row;
    });
    return { chartData: data, oems: top10 };
  }, [groupMonth]);

  return (
    <div>
      <div className="text-xs text-muted-foreground mb-2">
        2025년 TOP10 기준 · 2026년은 1~3월 누적 (연간 환산 아님)
      </div>
      <ResponsiveContainer width="100%" height={420}>
        <BarChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="year" className="text-xs" />
          <YAxis tickFormatter={(v) => fmtUnits(v)} className="text-xs" width={60} />
          <Tooltip
            formatter={(v, name) => [fmtFull(Number(v)) + ' 대', String(name)]}
            cursor={{ fill: 'var(--muted)' }}
            contentStyle={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              fontSize: '11px',
            }}
          />
          <Legend wrapperStyle={{ fontSize: '11px' }} />
          {oems.map((g, i) => (
            <Bar
              key={g}
              dataKey={g}
              fill={OEM_COLORS[i % OEM_COLORS.length]}
              radius={[2, 2, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
