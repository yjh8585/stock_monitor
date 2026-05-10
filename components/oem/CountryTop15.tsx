'use client';

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtFull, fmtUnits, OEM_COLORS } from './helpers';

export interface CountryTop15Row {
  name: string;
  sales: number;
}

interface Props {
  rows: CountryTop15Row[];
}

/** 국가별 판매량 TOP15 (서버에서 사전 가공된 결과 받기) */
export default function CountryTop15({ rows }: Props) {
  const data = rows.map((r, i) => ({
    ...r,
    color: OEM_COLORS[i % OEM_COLORS.length],
  }));

  return (
    <ResponsiveContainer width="100%" height={Math.max(360, rows.length * 26)}>
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
          {data.map((d) => (
            <Cell key={d.name} fill={d.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
