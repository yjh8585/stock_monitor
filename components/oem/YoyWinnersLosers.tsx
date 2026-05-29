'use client';

import { useMemo } from 'react';
import { useChartHeight } from '@/lib/useChartHeight';
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { growthPct } from '@/lib/format';
import type { OemSalesGroupMonth } from '@/lib/types';
import { DATA_LABEL_STYLE } from '@/components/oem-companies/common/chartStyle';
import { fmtFull, shortenOemName, sumByGroup } from './helpers';

interface Props {
  groupMonth: OemSalesGroupMonth[];
}

const TOP_N = 10;
const MIN_PREV_SALES = 100_000; // 노이즈 제거 — 2024년 10만 대 이상만

/** YoY 승자와 패자 — 2024→2025 성장률 TOP10/BOTTOM10 */
export default function YoyWinnersLosers({ groupMonth }: Props) {
  const h = useChartHeight(220, 300, 360);
  const { winners, losers } = useMemo(() => {
    const cur = sumByGroup(groupMonth, 202501, 202512);
    const prev = sumByGroup(groupMonth, 202401, 202412);

    const candidates: { oem_group: string; yoy: number; cur: number; prev: number }[] = [];
    for (const [g, p] of prev) {
      // N/A · 빈 그룹명 노이즈 제거 (그룹 식별 안 된 잡종 행은 비교 대상에서 제외)
      const trimmed = (g ?? '').trim();
      if (!trimmed) continue;
      const lower = trimmed.toLowerCase();
      if (lower === 'n/a' || lower === 'other' || lower === '기타' || lower === 'others') continue;
      if (p < MIN_PREV_SALES) continue;
      const c = cur.get(g) ?? 0;
      const yoy = growthPct(c, p);
      if (yoy == null) continue;
      candidates.push({ oem_group: g, yoy, cur: c, prev: p });
    }
    const sorted = [...candidates].sort((a, b) => b.yoy - a.yoy);
    return {
      winners: sorted.slice(0, TOP_N).map((d) => ({
        name: shortenOemName(d.oem_group),
        yoy: d.yoy,
        cur: d.cur,
        prev: d.prev,
      })),
      losers: sorted
        .slice(-TOP_N)
        .reverse()
        .map((d) => ({
          name: shortenOemName(d.oem_group),
          yoy: d.yoy,
          cur: d.cur,
          prev: d.prev,
        })),
    };
  }, [groupMonth]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div>
        <div className="text-sm font-medium text-muted-foreground mb-2">
          승자 TOP10 — 2024년 10만 대 이상 중
        </div>
        <ResponsiveContainer width="100%" height={h}>
          <BarChart data={winners} layout="vertical" margin={{ left: 40, right: 50 }}>
            <XAxis type="number" tickFormatter={(v) => `${v.toFixed(0)}%`} className="text-sm" />
            <YAxis
              type="category"
              dataKey="name"
              width={150}
              tick={{ fontSize: 14 }}
              interval={0}
            />
            <Tooltip
              formatter={(v, _n, p) => {
                const d = (p as { payload?: { yoy: number; cur: number; prev: number } }).payload;
                if (!d) return [`${Number(v).toFixed(1)}%`, 'YoY'];
                return [
                  `${Number(v).toFixed(1)}% (${fmtFull(d.prev)} → ${fmtFull(d.cur)} 대)`,
                  'YoY',
                ];
              }}
              cursor={{ fill: 'var(--muted)' }}
              contentStyle={{
                backgroundColor: 'var(--card)',
                border: '1px solid var(--border)',
                fontSize: '16px',
              }}
            />
            <Bar dataKey="yoy" radius={[0, 4, 4, 0]}>
              {winners.map((d) => (
                <Cell key={d.name} fill="#2563eb" />
              ))}
              <LabelList
                dataKey="yoy"
                position="right"
                formatter={(v: unknown) => (v == null ? '' : `${Number(v).toFixed(1)}%`)}
                style={DATA_LABEL_STYLE}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div>
        <div className="text-sm font-medium text-muted-foreground mb-2">
          패자 BOTTOM10 — 2024년 10만 대 이상 중
        </div>
        <ResponsiveContainer width="100%" height={h}>
          <BarChart data={losers} layout="vertical" margin={{ left: 40, right: 50 }}>
            <XAxis type="number" tickFormatter={(v) => `${v.toFixed(0)}%`} className="text-sm" />
            <YAxis
              type="category"
              dataKey="name"
              width={150}
              tick={{ fontSize: 14 }}
              interval={0}
            />
            <Tooltip
              formatter={(v, _n, p) => {
                const d = (p as { payload?: { yoy: number; cur: number; prev: number } }).payload;
                if (!d) return [`${Number(v).toFixed(1)}%`, 'YoY'];
                return [
                  `${Number(v).toFixed(1)}% (${fmtFull(d.prev)} → ${fmtFull(d.cur)} 대)`,
                  'YoY',
                ];
              }}
              cursor={{ fill: 'var(--muted)' }}
              contentStyle={{
                backgroundColor: 'var(--card)',
                border: '1px solid var(--border)',
                fontSize: '16px',
              }}
            />
            <Bar dataKey="yoy" radius={[0, 4, 4, 0]}>
              {losers.map((d) => (
                <Cell key={d.name} fill="#dc2626" />
              ))}
              <LabelList
                dataKey="yoy"
                position="right"
                formatter={(v: unknown) => (v == null ? '' : `${Number(v).toFixed(1)}%`)}
                style={DATA_LABEL_STYLE}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
