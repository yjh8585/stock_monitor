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
import { TOOLTIP_CONTENT_STYLE } from '@/components/charts/chartTheme';
import { growthPct } from '@/lib/format';
import type { OemSalesGroupMonth } from '@/lib/types';
import { DATA_LABEL_STYLE } from '@/components/oem-companies/common/chartStyle';
import { targetYear } from '@/lib/oem/aggregate';
import { fmtFull, shortenOemName, sumByGroup } from './helpers';

interface Props {
  groupMonth: OemSalesGroupMonth[];
}

const TOP_N = 10;
const MIN_PREV_SALES = 100_000; // 노이즈 제거 — 직전 연도 10만 대 이상만

/** YoY 승자와 패자 — 직전 연도(targetYear()-1) → 직전 완결 연도(targetYear()) 성장률 TOP10/BOTTOM10 */
export default function YoyWinnersLosers({ groupMonth }: Props) {
  const h = useChartHeight(220, 300, 360);
  const { winners, losers, prevYr } = useMemo(() => {
    const tgt = targetYear();
    const prevYr = tgt - 1;
    const cur = sumByGroup(groupMonth, tgt * 100 + 1, tgt * 100 + 12);
    const prev = sumByGroup(groupMonth, prevYr * 100 + 1, prevYr * 100 + 12);

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
      tgtYr: tgt,
      prevYr,
    };
  }, [groupMonth]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div>
        <div className="text-sm font-medium text-muted-foreground mb-2">
          승자 TOP10 — {prevYr}년 10만 대 이상 중
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
              contentStyle={TOOLTIP_CONTENT_STYLE}
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
          패자 BOTTOM10 — {prevYr}년 10만 대 이상 중
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
              contentStyle={TOOLTIP_CONTENT_STYLE}
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
