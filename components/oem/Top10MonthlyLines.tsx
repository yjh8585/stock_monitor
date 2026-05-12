'use client';

import { useMemo, useState } from 'react';
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
import ClickableLegend from './ClickableLegend';
import { fmtFull, fmtUnits, shortenOemName, sumByGroup, ymLabel, OEM_COLORS } from './helpers';

interface Props {
  groupMonth: OemSalesGroupMonth[];
}

const TOP_N = 10;

/** TOP10 OEM 월별 판매량 멀티라인 차트 (X=YYYY.MM)
 *  - 범례 차트 위, 판매량 큰 순(왼쪽부터)
 *  - 범례 클릭 시 라인 hide 토글
 */
export default function Top10MonthlyLines({ groupMonth }: Props) {
  const { chartData, oems } = useMemo(() => {
    const cur = sumByGroup(groupMonth, 202501, 202512);
    const top10 = [...cur.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
      .map(([g]) => g);
    const top10Set = new Set(top10);

    const labelMap = new Map(top10.map((g) => [g, shortenOemName(g)]));
    const labels = top10.map((g) => labelMap.get(g)!);
    const byYm = new Map<number, Record<string, number | string>>();
    for (const r of groupMonth) {
      if (!top10Set.has(r.oem_group)) continue;
      const lbl = labelMap.get(r.oem_group)!;
      if (!byYm.has(r.year_month)) {
        byYm.set(r.year_month, { ym: r.year_month, label: ymLabel(r.year_month) });
      }
      byYm.get(r.year_month)![lbl] = r.sales;
    }
    const data = [...byYm.values()].sort((a, b) => Number(a.ym) - Number(b.ym));
    for (const row of data) {
      for (const g of labels) {
        if (row[g] == null) row[g] = 0;
      }
    }
    return { chartData: data, oems: labels };
  }, [groupMonth]);

  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggleHidden = (key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div>
      <div className="text-xs text-muted-foreground mb-2">
        2025년 TOP10 기준 · 범례 클릭으로 항목 제외 가능
      </div>
      <ResponsiveContainer width="100%" height={440}>
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
          <Legend
            verticalAlign="top"
            align="center"
            wrapperStyle={{ paddingBottom: 8 }}
            content={() => <ClickableLegend items={oems} hidden={hidden} onToggle={toggleHidden} />}
          />
          {oems.map((g, i) => (
            <Line
              key={g}
              type="monotone"
              dataKey={g}
              stroke={OEM_COLORS[i % OEM_COLORS.length]}
              strokeWidth={1.5}
              dot={false}
              hide={hidden.has(g)}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
