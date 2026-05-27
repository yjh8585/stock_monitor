'use client';

import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useChartHeight } from '@/lib/useChartHeight';
import type { KiaExportType, KiaExportTypeMixPoint } from '@/lib/types';
import { GRID_STROKE_OPACITY } from '../common/chartStyle';
import { useHiddenSeries } from '../common/useHiddenSeries';

interface Props {
  monthly: KiaExportTypeMixPoint[];
  annual: KiaExportTypeMixPoint[];
}

type ViewMode = 'year' | 'month';

/** 6 카테고리 → 한국어 라벨 + 색상. 합계 큰 순으로 표시되도록 stack 순서 안정.
 *  PC(파랑) / RV(녹색) / CV(보라) / SV(노랑) / CKD 일반(주황) / CKD 특장(슬레이트). */
const TYPE_SERIES: { key: KiaExportType; label: string; color: string }[] = [
  { key: 'PC', label: '승용', color: '#2563eb' },
  { key: 'RV', label: 'RV', color: '#22c55e' },
  { key: 'CV', label: '상용', color: '#9333ea' },
  { key: 'SV', label: '특장', color: '#fbbf24' },
  { key: 'CKD_ex', label: 'CKD (일반)', color: '#f59e0b' },
  { key: 'CKD_sp', label: 'CKD (특장)', color: '#94a3b8' },
];

interface ChartRow {
  period_label: string;
  total: number;
  PC: number;
  RV: number;
  CV: number;
  SV: number;
  CKD_ex: number;
  CKD_sp: number;
}

function toPctRows(points: KiaExportTypeMixPoint[]): ChartRow[] {
  return points.map((p) => {
    const row: ChartRow = {
      period_label: p.period_label,
      total: p.total,
      PC: 0,
      RV: 0,
      CV: 0,
      SV: 0,
      CKD_ex: 0,
      CKD_sp: 0,
    };
    if (p.total <= 0) return row;
    for (const { key } of TYPE_SERIES) {
      row[key] = (p[key] / p.total) * 100;
    }
    return row;
  });
}

/** 6 type 합계 큰 순으로 정렬 — Legend/stack 모두 같은 순서 (#5). */
function sortTypesByTotal(points: KiaExportTypeMixPoint[]): KiaExportType[] {
  const totals = new Map<KiaExportType, number>();
  for (const { key } of TYPE_SERIES) totals.set(key, 0);
  for (const p of points) {
    for (const { key } of TYPE_SERIES) totals.set(key, (totals.get(key) ?? 0) + p[key]);
  }
  return TYPE_SERIES.map((s) => s.key).sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
}

export default function KiaExportTypeMixChartInner({ monthly, annual }: Props) {
  const [mode, setMode] = useState<ViewMode>('year');
  const height = useChartHeight(240, 280, 320);
  const { isHidden, legendProps } = useHiddenSeries();

  const data = useMemo<ChartRow[]>(
    () => toPctRows(mode === 'year' ? annual : monthly),
    [mode, monthly, annual]
  );
  const typeOrder = useMemo(
    () => sortTypesByTotal(mode === 'year' ? annual : monthly),
    [mode, monthly, annual]
  );
  const seriesByKey = useMemo(() => {
    const m = new Map<KiaExportType, (typeof TYPE_SERIES)[number]>();
    for (const s of TYPE_SERIES) m.set(s.key, s);
    return m;
  }, []);

  return (
    <div>
      <div
        role="tablist"
        aria-label="기간 단위 선택"
        className="flex items-center gap-2 mb-3 text-sm"
      >
        <button
          role="tab"
          type="button"
          aria-selected={mode === 'year'}
          onClick={() => setMode('year')}
          className={`px-3 py-1 rounded-md border transition-colors ${
            mode === 'year'
              ? 'border-foreground bg-foreground text-background'
              : 'border-border text-muted-foreground hover:bg-muted'
          }`}
        >
          연간
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={mode === 'month'}
          onClick={() => setMode('month')}
          className={`px-3 py-1 rounded-md border transition-colors ${
            mode === 'month'
              ? 'border-foreground bg-foreground text-background'
              : 'border-border text-muted-foreground hover:bg-muted'
          }`}
        >
          월간
        </button>
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <AreaChart
          data={data}
          margin={{ top: 10, right: 20, bottom: 10, left: 10 }}
          stackOffset="expand"
        >
          <CartesianGrid
            strokeDasharray="3 3"
            className="stroke-border"
            strokeOpacity={GRID_STROKE_OPACITY}
            vertical={mode === 'month'}
          />
          <XAxis
            dataKey="period_label"
            className="text-sm"
            tick={{ fontSize: 14 }}
            interval="preserveStartEnd"
            minTickGap={20}
          />
          <YAxis
            tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
            className="text-sm"
            width={60}
          />
          <Tooltip
            formatter={(v, name) => [`${Number(v).toFixed(1)}%`, String(name)]}
            itemSorter={(item) => -(item.value as number)}
            contentStyle={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              fontSize: '16px',
            }}
          />
          <Legend
            layout="horizontal"
            verticalAlign="top"
            align="center"
            wrapperStyle={{ fontSize: '16px', paddingBottom: 8 }}
            itemSorter={null}
            onClick={legendProps.onClick}
            formatter={(value, entry) => {
              const rawKey = (entry as { dataKey?: string | number })?.dataKey;
              const key = String(rawKey ?? value);
              const isOff = isHidden(key);
              return (
                <span
                  style={{
                    cursor: 'pointer',
                    userSelect: 'none',
                    textDecoration: isOff ? 'line-through' : 'none',
                    opacity: isOff ? 0.5 : 1,
                  }}
                >
                  {value}
                </span>
              );
            }}
          />
          {typeOrder.map((key) => {
            const s = seriesByKey.get(key)!;
            return (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stackId="type"
                stroke={s.color}
                fill={s.color}
                fillOpacity={0.85}
                hide={isHidden(s.key)}
              />
            );
          })}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
