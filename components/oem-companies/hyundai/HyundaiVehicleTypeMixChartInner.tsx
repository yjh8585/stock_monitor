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
import { TOOLTIP_CONTENT_STYLE } from '@/components/charts/chartTheme';
import { useChartHeight } from '@/lib/useChartHeight';
import type { HyundaiVehicleType, HyundaiVehicleTypeMixPoint } from '@/lib/types';
import { GRID_STROKE_OPACITY } from '../common/chartStyle';
import { useHiddenSeries } from '../common/useHiddenSeries';

interface Props {
  monthly: HyundaiVehicleTypeMixPoint[];
  annual: HyundaiVehicleTypeMixPoint[];
}

type ViewMode = 'year' | 'month';

/** 차종 type 색상 — PC=파랑(세단) / RV=녹색(SUV) / Genesis=짙은 회색(럭셔리) / CV=주황(상용) / Other=옅은 회색 */
const VTYPE_COLORS: Record<HyundaiVehicleType, string> = {
  PC: '#2563eb',
  RV: '#16a34a',
  Genesis: '#1f2937',
  CV: '#f59e0b',
  Other: '#cbd5e1',
};

/** Legend 표시명 — 한글 의미 추가. internal key는 그대로. */
const VTYPE_LABELS: Record<HyundaiVehicleType, string> = {
  PC: 'PC (세단)',
  RV: 'RV (SUV)',
  Genesis: 'Genesis',
  CV: 'CV (상용차)',
  Other: 'Other',
};

const ALL_VTYPES: HyundaiVehicleType[] = ['PC', 'RV', 'Genesis', 'CV', 'Other'];

/** 전체 기간 합계 큰 순으로 type 정렬 → 범례·stack 순서. */
function sortVtypesByTotal(data: HyundaiVehicleTypeMixPoint[]): HyundaiVehicleType[] {
  const totals = new Map<HyundaiVehicleType, number>();
  for (const t of ALL_VTYPES) totals.set(t, 0);
  for (const p of data) {
    for (const t of ALL_VTYPES) totals.set(t, (totals.get(t) ?? 0) + p[t]);
  }
  return ALL_VTYPES.slice().sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
}

export default function HyundaiVehicleTypeMixChartInner({ monthly, annual }: Props) {
  const [mode, setMode] = useState<ViewMode>('year');
  const height = useChartHeight(240, 280, 320);
  const { isHidden, legendProps } = useHiddenSeries();

  const data = mode === 'year' ? annual : monthly;

  /** 각 type 비중(%)으로 미리 변환 + 합계 큰 순 ordering. */
  const { chartData, vtypeOrder } = useMemo(() => {
    const order = sortVtypesByTotal(data);
    const rows = data.map((d) => {
      const totalSafe = d.total > 0 ? d.total : 1;
      const row: Record<string, number | string> = {
        period_label: d.period_label,
        total: d.total,
      };
      for (const t of order) {
        row[t] = (d[t] / totalSafe) * 100;
        row[`${t}_units`] = d[t];
      }
      return row;
    });
    return { chartData: rows, vtypeOrder: order };
  }, [data]);

  return (
    <div>
      <div
        role="tablist"
        aria-label="기간 단위 선택"
        className="mb-3 flex items-center gap-2 text-sm"
      >
        <button
          role="tab"
          type="button"
          aria-selected={mode === 'year'}
          onClick={() => setMode('year')}
          className={`rounded-md border px-3 py-1 transition-colors ${
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
          className={`rounded-md border px-3 py-1 transition-colors ${
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
          data={chartData}
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
          <YAxis tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} className="text-sm" width={50} />
          <Tooltip
            contentStyle={TOOLTIP_CONTENT_STYLE}
            formatter={(value, name, item) => {
              const pct = Number(value ?? 0);
              const key = String(name) as HyundaiVehicleType;
              const units =
                (item?.payload as Record<string, number> | undefined)?.[`${key}_units`] ?? 0;
              const label = VTYPE_LABELS[key] ?? key;
              return [`${units.toLocaleString('ko-KR')}대 (${pct.toFixed(1)}%)`, label];
            }}
            itemSorter={(item) => -(item.value as number)}
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
              const label = VTYPE_LABELS[value as HyundaiVehicleType] ?? value;
              return (
                <span
                  style={{
                    cursor: 'pointer',
                    userSelect: 'none',
                    textDecoration: isOff ? 'line-through' : 'none',
                    opacity: isOff ? 0.5 : 1,
                  }}
                >
                  {label}
                </span>
              );
            }}
          />
          {vtypeOrder.map((t) => (
            <Area
              key={t}
              type="monotone"
              dataKey={t}
              name={t}
              stackId="1"
              stroke={VTYPE_COLORS[t]}
              fill={VTYPE_COLORS[t]}
              fillOpacity={0.85}
              isAnimationActive={false}
              hide={isHidden(t)}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
