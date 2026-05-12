'use client';

import { useMemo } from 'react';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { OemSalesTypeSegMonth } from '@/lib/types';
import { fmtFull, fmtUnits } from './helpers';

interface Props {
  typeSegMonth: OemSalesTypeSegMonth[];
}

const TYPE_COLORS = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#f59e0b',
  '#9333ea',
  '#0891b2',
  '#ea580c',
  '#65a30d',
  '#db2777',
  '#475569',
];
const SEGMENT_COLORS = [
  '#3b82f6',
  '#ef4444',
  '#22c55e',
  '#f59e0b',
  '#a855f7',
  '#06b6d4',
  '#f97316',
  '#84cc16',
  '#ec4899',
  '#64748b',
  '#7c3aed',
  '#0d9488',
  '#facc15',
];

const YEAR_START = 202501;
const YEAR_END = 202512;
const TYPE_TOP_N = 5; // 범례 노이즈 방지: TOP5 + Others
const SEGMENT_TOP_N = 13;

type SliceRow = { name: string; value: number };

/** TOP N + 나머지를 'Others'로 합치기 */
function topNWithOthers(rows: SliceRow[], n: number): SliceRow[] {
  if (rows.length <= n) return rows;
  const top = rows.slice(0, n);
  const others = rows.slice(n).reduce((s, r) => s + r.value, 0);
  if (others <= 0) return top;
  return [...top, { name: 'Others', value: others }];
}

/** Type/Segment 구조 — 2025년 도넛 2개 */
export default function TypeSegmentChart({ typeSegMonth }: Props) {
  const { typeData, segmentData } = useMemo(() => {
    const typeMap = new Map<string, number>();
    const segMap = new Map<string, number>();
    for (const r of typeSegMonth) {
      if (r.year_month < YEAR_START || r.year_month > YEAR_END) continue;
      typeMap.set(r.vehicle_type, (typeMap.get(r.vehicle_type) ?? 0) + r.sales);
      segMap.set(r.segment, (segMap.get(r.segment) ?? 0) + r.sales);
    }

    const typeArr = topNWithOthers(
      [...typeMap.entries()].sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value })),
      TYPE_TOP_N
    );
    const segArr = [...segMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, SEGMENT_TOP_N)
      .map(([name, value]) => ({ name, value }));

    return { typeData: typeArr, segmentData: segArr };
  }, [typeSegMonth]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ChartCard title="Type별 비중 (TOP5 + Others)" data={typeData} colors={TYPE_COLORS} />
      <ChartCard
        title={`Segment별 비중 (TOP${SEGMENT_TOP_N})`}
        data={segmentData}
        colors={SEGMENT_COLORS}
      />
    </div>
  );
}

function ChartCard({ title, data, colors }: { title: string; data: SliceRow[]; colors: string[] }) {
  const total = data.reduce((a, b) => a + b.value, 0);
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground mb-2">
        {title} — 합계 {fmtUnits(total)}
      </div>
      <ResponsiveContainer width="100%" height={360}>
        <PieChart>
          <Legend
            layout="horizontal"
            verticalAlign="top"
            align="center"
            wrapperStyle={{ fontSize: '10px', paddingBottom: 4 }}
          />
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="55%"
            innerRadius={55}
            outerRadius={115}
            label={(p) => {
              const pct = total > 0 ? ((p.value as number) / total) * 100 : 0;
              return pct >= 4 ? `${p.name} ${pct.toFixed(0)}%` : '';
            }}
            labelLine={false}
            stroke="var(--card)"
            strokeWidth={1}
          >
            {data.map((d, i) => (
              <Cell key={d.name} fill={colors[i % colors.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v, name) => {
              const n = Number(v);
              const pct = total > 0 ? ((n / total) * 100).toFixed(1) : '0.0';
              return [`${fmtFull(n)} 대 (${pct}%)`, String(name)];
            }}
            contentStyle={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              fontSize: '11px',
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
