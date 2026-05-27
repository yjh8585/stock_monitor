'use client';

import { useMemo, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { OEM_COLORS } from '@/components/oem/helpers';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useChartHeight } from '@/lib/useChartHeight';
import type { FactoryModelMixPoint } from '@/lib/types';
import { DATA_LABEL_STYLE, GRID_STROKE_OPACITY, Y_AXIS_PADDED_DOMAIN } from '../common/chartStyle';

/** recharts XAxis tick props (정확한 시그니처) */
interface XAxisTickInput {
  x?: number | string;
  y?: number | string;
  payload?: { value?: unknown };
}

function FactoryTick(props: unknown) {
  const p = (props ?? {}) as XAxisTickInput;
  const x = typeof p.x === 'number' ? p.x : Number(p.x ?? 0);
  const y = typeof p.y === 'number' ? p.y : Number(p.y ?? 0);
  const text = String(p.payload?.value ?? '');
  const [code, location] = text.split('\n');
  return (
    <g transform={`translate(${x},${y})`}>
      <text textAnchor="middle" dy={14} fontSize={13} fontWeight={600} fill="currentColor">
        {code}
      </text>
      <text textAnchor="middle" dy={32} fontSize={11} fill="var(--muted-foreground)">
        {location}
      </text>
    </g>
  );
}

interface Props {
  dataByYear: Record<string, FactoryModelMixPoint[]>;
  availableYears: string[];
}

const OTHERS_KEY = 'Others';
const OTHERS_COLOR = '#cbd5e1';

function fmtUnitsTick(n: number): string {
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return n.toLocaleString('ko-KR');
}

/** 막대 위 합계 라벨 — 큰 수는 만/M (#6 13px bold). */
function fmtTotalLabel(value: unknown): string {
  if (value == null) return '';
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return n.toLocaleString('ko-KR');
}

/** 모든 공장에서 등장하는 모델 합계 desc로 정렬해 stack 키 결정. Others는 항상 마지막. */
function buildModelKeys(data: FactoryModelMixPoint[]): string[] {
  const totals = new Map<string, number>();
  for (const p of data) {
    for (const [m, v] of Object.entries(p.models)) {
      if (m === OTHERS_KEY) continue;
      totals.set(m, (totals.get(m) ?? 0) + v);
    }
  }
  const sortedModels = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
  const hasOthers = data.some((p) => (p.models[OTHERS_KEY] ?? 0) > 0);
  return hasOthers ? [...sortedModels, OTHERS_KEY] : sortedModels;
}

/** 모든 해외 공장 × 차종 stacked bar — 공장 코드 + 위치 X축 라벨, 합계 라벨, 연도 드롭다운. */
export default function HyundaiFactoryModelMixChartInner({ dataByYear, availableYears }: Props) {
  const height = useChartHeight(280, 320, 360);

  // 기본 선택: 가장 최근 완료 연도(현재 연도 아닌 마지막). availableYears 마지막값 사용.
  const defaultYear = availableYears[availableYears.length - 1] ?? '';
  const [selectedYear, setSelectedYear] = useState<string>(defaultYear);

  const { modelKeys, chartData } = useMemo(() => {
    const dataAll = dataByYear[selectedYear] ?? [];
    // 1만대 미만 공장 제외 (사용자 요청).
    const data = dataAll.filter((d) => d.total >= 10_000);
    const keys = buildModelKeys(data);
    const rows = data.map((d) => {
      const row: Record<string, string | number> = {
        factory_label: `${d.factory}\n(${d.factoryLocation || '—'})`,
        factory: d.factory,
        factoryLocation: d.factoryLocation,
        total: d.total,
        _marker: 1,
      };
      for (const m of keys) {
        row[m] = d.models[m] ?? 0;
      }
      return row;
    });
    return { modelKeys: keys, chartData: rows };
  }, [dataByYear, selectedYear]);

  // availableYears 내림차순으로 드롭다운 표시 (최신이 위)
  const yearOptions = [...availableYears].reverse();

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-xs text-muted-foreground">연도</span>
        <Select value={selectedYear} onValueChange={(v) => v != null && setSelectedYear(v)}>
          <SelectTrigger className="h-8 w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {yearOptions.map((y) => (
              <SelectItem key={y} value={y}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={chartData} margin={{ top: 32, right: 20, bottom: 30, left: 10 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            className="stroke-border"
            strokeOpacity={GRID_STROKE_OPACITY}
            vertical={false}
          />
          <XAxis
            dataKey="factory_label"
            className="text-sm"
            tick={FactoryTick}
            interval={0}
            height={50}
          />
          <YAxis
            tickFormatter={fmtUnitsTick}
            className="text-sm"
            width={60}
            domain={Y_AXIS_PADDED_DOMAIN}
          />
          <Tooltip
            cursor={{ fill: 'var(--muted)' }}
            contentStyle={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              fontSize: '14px',
            }}
            labelFormatter={(label, payload) => {
              const item = payload?.[0]?.payload as
                | { factory?: string; factoryLocation?: string }
                | undefined;
              if (item?.factory && item.factoryLocation) {
                return `${item.factory} (${item.factoryLocation})`;
              }
              return String(label);
            }}
            formatter={(value, name, item) => {
              const v = Number(value ?? 0);
              const total = Number((item?.payload as { total?: number } | undefined)?.total ?? 0);
              const pct = total > 0 ? (v / total) * 100 : 0;
              return [`${v.toLocaleString('ko-KR')}대 (${pct.toFixed(1)}%)`, String(name)];
            }}
            itemSorter={(item) => -(item.value as number)}
          />
          {modelKeys.map((m, i) => {
            const isOthers = m === OTHERS_KEY;
            const isLast = i === modelKeys.length - 1;
            return (
              <Bar
                key={m}
                dataKey={m}
                name={m}
                stackId="model"
                fill={isOthers ? OTHERS_COLOR : OEM_COLORS[i % OEM_COLORS.length]}
                isAnimationActive={false}
                radius={isLast ? [3, 3, 0, 0] : undefined}
              />
            );
          })}
          {/* invisible Line — dataKey=total로 stack 맨 위 좌표(x, total)에 점 → LabelList position=top이 정확히 stack 위. */}
          <Line
            dataKey="total"
            stroke="transparent"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
            legendType="none"
          >
            <LabelList
              dataKey="total"
              position="top"
              formatter={fmtTotalLabel}
              style={DATA_LABEL_STYLE}
            />
          </Line>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
