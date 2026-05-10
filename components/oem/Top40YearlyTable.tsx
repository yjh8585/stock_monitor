'use client';

import { useMemo } from 'react';
import { fmtChange, arrowColor } from '@/lib/format';
import type { OemSalesGroupMonth } from '@/lib/types';
import { buildRanking, fmtUnits, sumByGroup } from './helpers';

interface Props {
  groupMonth: OemSalesGroupMonth[];
}

const TOP_N = 40;

/** 2025 TOP40 표 — 순위 등락 + YoY */
export default function Top40YearlyTable({ groupMonth }: Props) {
  const rows = useMemo(() => {
    const cur = sumByGroup(groupMonth, 202501, 202512);
    const prev = sumByGroup(groupMonth, 202401, 202412);
    return buildRanking(cur, prev, TOP_N);
  }, [groupMonth]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th className="text-left p-2 w-12">2025 #</th>
            <th className="text-center p-2 w-16">등락</th>
            <th className="text-left p-2">OEM</th>
            <th className="text-right p-2 w-28">2024</th>
            <th className="text-right p-2 w-28">2025</th>
            <th className="text-right p-2 w-20">YoY</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.oem_group} className="border-b border-border/50 hover:bg-muted/40">
              <td className="p-2 tabular-nums font-medium">{r.rank}</td>
              <td className="p-2 text-center tabular-nums text-xs">
                <RankChange change={r.rank_change} prevRank={r.rank_prev} />
              </td>
              <td className="p-2" title={r.oem_group}>
                {r.oem_group}
              </td>
              <td className="p-2 text-right tabular-nums text-muted-foreground">
                {fmtUnits(r.sales_prev)}
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
  );
}

function RankChange({
  change,
  prevRank,
}: {
  change: number | null | undefined;
  prevRank: number | undefined;
}) {
  if (prevRank == null) return <span className="text-blue-500 font-semibold">NEW</span>;
  if (change == null || change === 0) return <span className="text-muted-foreground">—</span>;
  if (change > 0) return <span className="text-blue-600">▲{change}</span>;
  return <span className="text-red-500">▼{Math.abs(change)}</span>;
}
