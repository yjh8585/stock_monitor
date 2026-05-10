'use client';

import { useMemo } from 'react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { OemSalesGroupCountryMonth } from '@/lib/types';
import { fmtFull, fmtUnits, sumByCountry, OEM_COLORS } from './helpers';

interface Props {
  groupCountryMonth: OemSalesGroupCountryMonth[];
}

const TOP_N = 15;

/** 국가별 판매량 TOP15 (2025년 합계) */
export default function CountryTop15({ groupCountryMonth }: Props) {
  const data = useMemo(() => {
    const m = sumByCountry(groupCountryMonth, 202501, 202512);
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
      .map(([name, sales], i) => ({ name, sales, color: OEM_COLORS[i % OEM_COLORS.length] }));
  }, [groupCountryMonth]);

  return (
    <ResponsiveContainer width="100%" height={Math.max(360, TOP_N * 26)}>
      <BarChart data={data} layout="vertical" margin={{ left: 60, right: 40 }}>
        <XAxis type="number" tickFormatter={(v) => fmtUnits(v)} className="text-xs" />
        <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} interval={0} />
        <Tooltip
          formatter={(v) => [fmtFull(Number(v)) + ' 대', '판매량']}
          cursor={{ fill: 'var(--muted)' }}
          contentStyle={{
            backgroundColor: 'var(--card)',
            border: '1px solid var(--border)',
            fontSize: '12px',
          }}
        />
        <Bar dataKey="sales" radius={[0, 4, 4, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
