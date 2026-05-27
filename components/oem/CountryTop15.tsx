'use client';

import { useMemo } from 'react';
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartHeight } from '@/lib/useChartHeight';
import { DATA_LABEL_STYLE } from '@/components/oem-companies/common/chartStyle';
import { fmtFull, fmtUnits, OEM_COLORS } from './helpers';

export interface CountryTop15Row {
  name: string;
  sales: number;
}

interface Props {
  rows: CountryTop15Row[];
}

/** 국가별 판매량 TOP15 (서버에서 사전 가공된 결과 받기). Tooltip에 수치+비중 표시. */
export default function CountryTop15({ rows }: Props) {
  const rowHeight = useChartHeight(18, 22, 26); // sm:18px, md:22px, lg:26px
  const minH = useChartHeight(200, 280, 360); // sm:200, md:280, lg:360

  const { data, total } = useMemo(() => {
    const t = rows.reduce((s, r) => s + r.sales, 0);
    const d = rows.map((r, i) => ({ ...r, color: OEM_COLORS[i % OEM_COLORS.length] }));
    return { data: d, total: t };
  }, [rows]);

  return (
    <ResponsiveContainer width="100%" height={Math.max(minH, rows.length * rowHeight)}>
      <BarChart data={data} layout="vertical" margin={{ left: 60, right: 40 }}>
        <XAxis type="number" tickFormatter={(v) => fmtUnits(v)} className="text-sm" />
        <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 14 }} interval={0} />
        <Tooltip
          formatter={(v) => {
            const n = Number(v);
            const pct = total > 0 ? ((n / total) * 100).toFixed(1) : '0.0';
            return [`${fmtFull(n)} 대 (${pct}%)`, '판매량'];
          }}
          cursor={{ fill: 'var(--muted)' }}
          contentStyle={{
            backgroundColor: 'var(--card)',
            border: '1px solid var(--border)',
            fontSize: '16px',
          }}
        />
        <Bar dataKey="sales" radius={[0, 4, 4, 0]}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.color} />
          ))}
          <LabelList
            dataKey="sales"
            position="right"
            formatter={(v: unknown) => (v == null ? '' : fmtUnits(Number(v)))}
            style={DATA_LABEL_STYLE}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
