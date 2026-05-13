'use client';

import { useMemo } from 'react';
import { useChartHeight } from '@/lib/useChartHeight';
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
import type { OemSalesGroupPtMonth } from '@/lib/types';
import { fmtFull, fmtUnits, ptSumByGroup, shortenOemName } from './helpers';

interface Props {
  groupPtMonth: OemSalesGroupPtMonth[];
}

const TOP_N = 10;
const YEAR_START = 202501;
const YEAR_END = 202512;

/** EV 대전 — 좌: TOP10 EV 판매량 / 우: 같은 OEM의 EV 비율 (%) */
export default function EvLeadersChart({ groupPtMonth }: Props) {
  const h = useChartHeight(220, 300, 360);
  const { sales, ratio } = useMemo(() => {
    const ptByGroup = ptSumByGroup(groupPtMonth, YEAR_START, YEAR_END);

    // EV 판매량 = EV + PHEV (전동화 통합)
    const evByGroup = new Map<string, { ev: number; total: number }>();
    for (const [g, ptMap] of ptByGroup) {
      const ev = (ptMap.get('EV') ?? 0) + (ptMap.get('PHEV') ?? 0);
      const total = [...ptMap.values()].reduce((a, b) => a + b, 0);
      evByGroup.set(g, { ev, total });
    }

    // 좌: EV 판매량 TOP10
    const top10ByEv = [...evByGroup.entries()]
      .filter(([, v]) => v.ev > 0)
      .sort((a, b) => b[1].ev - a[1].ev)
      .slice(0, TOP_N)
      .map(([rawName, v], i) => ({
        name: shortenOemName(rawName),
        sales: v.ev,
        color: i === 0 ? '#22c55e' : '#16a34a',
      }));

    // 우: EV 비율 TOP10 (전체 판매량 50만 대 이상만 노이즈 제거)
    const MIN_TOTAL = 500_000;
    const top10ByRatio = [...evByGroup.entries()]
      .filter(([, v]) => v.total >= MIN_TOTAL)
      .map(([rawName, v]) => ({ name: shortenOemName(rawName), ratio: (v.ev / v.total) * 100 }))
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, TOP_N)
      .map((d, i) => ({
        ...d,
        color: i === 0 ? '#22c55e' : '#16a34a',
      }));

    return { sales: top10ByEv, ratio: top10ByRatio };
  }, [groupPtMonth]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-2">
          EV+PHEV 판매량 TOP10 (2025)
        </div>
        <ResponsiveContainer width="100%" height={h}>
          <BarChart data={sales} layout="vertical" margin={{ left: 40, right: 30 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis type="number" tickFormatter={(v) => fmtUnits(v)} className="text-xs" />
            <YAxis
              type="category"
              dataKey="name"
              width={150}
              tick={{ fontSize: 11 }}
              interval={0}
            />
            <Tooltip
              formatter={(v) => [fmtFull(Number(v)) + ' 대', 'EV+PHEV']}
              cursor={{ fill: 'var(--muted)' }}
              contentStyle={{
                backgroundColor: 'var(--card)',
                border: '1px solid var(--border)',
                fontSize: '11px',
              }}
            />
            <Bar dataKey="sales" radius={[0, 4, 4, 0]}>
              {sales.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div>
        <div className="text-xs font-medium text-muted-foreground mb-2">
          EV 비율 TOP10 — 전체 50만 대 이상 OEM (2025)
        </div>
        <ResponsiveContainer width="100%" height={h}>
          <BarChart data={ratio} layout="vertical" margin={{ left: 40, right: 30 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              type="number"
              tickFormatter={(v) => `${v.toFixed(0)}%`}
              className="text-xs"
              domain={[0, 100]}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={150}
              tick={{ fontSize: 11 }}
              interval={0}
            />
            <Tooltip
              formatter={(v) => [`${Number(v).toFixed(1)}%`, 'EV 비율']}
              cursor={{ fill: 'var(--muted)' }}
              contentStyle={{
                backgroundColor: 'var(--card)',
                border: '1px solid var(--border)',
                fontSize: '11px',
              }}
            />
            <Bar dataKey="ratio" radius={[0, 4, 4, 0]}>
              {ratio.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
