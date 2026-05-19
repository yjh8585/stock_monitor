'use client';

import { useMemo, useState } from 'react';
import { useChartHeight } from '@/lib/useChartHeight';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { OemSalesGroupPtMonth, PowerTrain } from '@/lib/types';
import { fmtFull, fmtUnits, shortenOemName, OEM_COLORS, PT_COLORS, PT_ORDER } from './helpers';

interface Props {
  groupPtMonth: OemSalesGroupPtMonth[];
}

const TABS: PowerTrain[] = ['EV', 'PHEV', 'HV', 'ICE'];
const TOP_N = 10;
const YEAR_START = 202501;
const YEAR_END = 202512;

/** PowerTrain별 OEM TOP10 — 탭 전환 + 가로 막대 */
export default function PowertrainTopOems({ groupPtMonth }: Props) {
  const [active, setActive] = useState<PowerTrain>('EV');
  const h = useChartHeight(240, 320, 400);

  const { data, total } = useMemo(() => {
    const sumByGroup = new Map<string, number>();
    let allSum = 0;
    for (const r of groupPtMonth) {
      if (r.powertrain !== active) continue;
      if (r.year_month < YEAR_START || r.year_month > YEAR_END) continue;
      sumByGroup.set(r.oem_group, (sumByGroup.get(r.oem_group) ?? 0) + r.sales);
      allSum += r.sales;
    }
    const rows = [...sumByGroup.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
      .map(([rawName, sales], i) => ({
        name: shortenOemName(rawName),
        sales,
        color: OEM_COLORS[i % OEM_COLORS.length],
      }));
    return { data: rows, total: allSum };
  }, [groupPtMonth, active]);

  return (
    <div>
      <div role="tablist" aria-label="PowerTrain 선택" className="flex gap-1 mb-3">
        {TABS.map((pt) => (
          <button
            key={pt}
            role="tab"
            type="button"
            aria-selected={active === pt}
            onClick={() => setActive(pt)}
            className={`px-3 py-1 text-sm rounded-md border transition-colors ${
              active === pt
                ? 'border-foreground bg-foreground text-background'
                : 'border-border text-muted-foreground hover:bg-muted'
            }`}
            style={
              active === pt ? undefined : { borderLeftWidth: 3, borderLeftColor: PT_COLORS[pt] }
            }
          >
            {pt}
          </button>
        ))}
        {PT_ORDER.filter((p) => !TABS.includes(p as PowerTrain)).map((pt) => (
          <button
            key={pt}
            role="tab"
            type="button"
            aria-selected={active === pt}
            onClick={() => setActive(pt as PowerTrain)}
            className={`px-3 py-1 text-sm rounded-md border transition-colors ${
              active === pt
                ? 'border-foreground bg-foreground text-background'
                : 'border-border text-muted-foreground hover:bg-muted'
            }`}
          >
            {pt}
          </button>
        ))}
      </div>

      {data.length === 0 ? (
        <div className="text-sm text-muted-foreground py-12 text-center">{active} 데이터 없음</div>
      ) : (
        <ResponsiveContainer width="100%" height={h}>
          <BarChart data={data} layout="vertical" margin={{ left: 60, right: 40 }}>
            <XAxis type="number" tickFormatter={(v) => fmtUnits(v)} className="text-sm" />
            <YAxis
              type="category"
              dataKey="name"
              width={180}
              tick={{ fontSize: 14 }}
              interval={0}
            />
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
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
