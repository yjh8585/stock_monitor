'use client';

import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fmtChange, arrowColor } from '@/lib/format';
import type { OemSalesGroupMonth } from '@/lib/types';
import { buildRanking, fmtFull, fmtUnits, findLatestYm, sumByGroup, OEM_COLORS } from './helpers';

interface Props {
  groupMonth: OemSalesGroupMonth[];
}

const TOP_N = 30;

/** 2026 YTD TOP30 — 가로 막대 + 우측 표 */
export default function Top30YtdChart({ groupMonth }: Props) {
  const { rows, latestMonth } = useMemo(() => {
    const latestYm = findLatestYm(groupMonth, 2026);
    if (!latestYm) return { rows: [], latestMonth: 0 };
    const month = latestYm % 100;
    const cur = sumByGroup(groupMonth, 202601, latestYm);
    const prev = sumByGroup(groupMonth, 202501, 202500 + month);
    return { rows: buildRanking(cur, prev, TOP_N), latestMonth: month };
  }, [groupMonth]);

  if (!rows.length) {
    return <div className="text-sm text-muted-foreground">2026년 데이터 없음</div>;
  }

  const chartData = rows.map((r, i) => ({
    name: r.oem_group,
    sales: r.sales,
    rank: r.rank,
    color: OEM_COLORS[i % OEM_COLORS.length],
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_500px] gap-4">
      <div>
        <div className="text-xs text-muted-foreground mb-2">
          2026년 1월~{latestMonth}월 누적, 전년 동기(2025.01~{latestMonth}) 대비 YoY
        </div>
        <ResponsiveContainer width="100%" height={Math.max(600, TOP_N * 22)}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 60, right: 40 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis type="number" tickFormatter={(v) => fmtUnits(v)} className="text-xs" />
            <YAxis
              type="category"
              dataKey="name"
              width={180}
              tick={{ fontSize: 11 }}
              interval={0}
            />
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
              {chartData.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="overflow-auto max-h-[700px]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-border">
              <th className="text-left p-2 w-10">#</th>
              <th className="text-left p-2">OEM</th>
              <th className="text-right p-2 w-24">YTD</th>
              <th className="text-right p-2 w-20">YoY</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.oem_group} className="border-b border-border/50 hover:bg-muted/40">
                <td className="p-2 text-muted-foreground tabular-nums">{r.rank}</td>
                <td className="p-2 truncate max-w-[200px]" title={r.oem_group}>
                  {r.oem_group}
                </td>
                <td className="p-2 text-right tabular-nums">{fmtUnits(r.sales)}</td>
                <td className={`p-2 text-right tabular-nums ${arrowColor(r.yoy)}`}>
                  {r.yoy != null ? fmtChange(r.yoy) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
