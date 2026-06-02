'use client';

import { useCallback, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TOOLTIP_CONTENT_STYLE } from '@/components/charts/chartTheme';
import { useChartHeight } from '@/lib/useChartHeight';
import { OEM_COLORS } from '@/components/oem/helpers';
import type { AchievementPoint } from '@/lib/plan/types';

/** hex → rgba (계획 막대 연한색). */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function fmt(n: number | null, digits = 0): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString('ko-KR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

interface Props {
  points: AchievementPoint[];
  /** 막대 단위 라벨 (예: '억원', 'USD 백만', '백만원') */
  unitLabel: string;
  /** 막대(계획/실적) 표시 소수점 자릿수. default 0. */
  amountDigits?: number;
}

const BASE = OEM_COLORS[0]; // 실적(진한색) = blue-600
const PLAN_COLOR = hexToRgba(BASE, 0.4); // 계획(연한색)
const RATE_COLOR = '#dc2626'; // 달성율 라인

/**
 * 콤보 차트: 계획·실적 막대 + 달성율(%) 라인.
 *
 * 가독성 설계:
 * - 막대 amount 축 domain [0, max×2.5] → 막대가 plot 하단 ~40%
 * - 라인 rate 축 domain [-rateMax×1.5, rateMax×1.1] → 라인이 상단 ~60% 영역
 *   양쪽 축의 0이 같은 y 위치에 오지 않게 비대칭으로 잡아 막대·라인 영역 분리.
 * - 데이터 라벨: 막대 outside top, 라인 marker 위(offset 16). 폰트 16(경영관리 호버 동일).
 * - 범례 클릭 시 시리즈 토글(hide). 토글된 항목은 chip이 흐려지고 line-through 표시.
 */
export default function PlanAchievementChart({ points, unitLabel, amountDigits = 0 }: Props) {
  const h = useChartHeight(360, 440, 520);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggle = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  if (points.length === 0) {
    return (
      <div className="py-12 text-center text-base text-muted-foreground">데이터가 없습니다.</div>
    );
  }
  const rateMax = Math.max(100, ...points.map((p) => (p.rate == null ? 0 : Math.abs(p.rate))));
  return (
    <ResponsiveContainer width="100%" height={h}>
      <ComposedChart data={points} margin={{ top: 48, right: 24, bottom: 10, left: 10 }} barGap={2}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
        <XAxis dataKey="yearLabel" tick={{ fontSize: 14 }} />
        <YAxis
          yAxisId="amount"
          tickFormatter={(v: number) => fmt(v, amountDigits)}
          tick={{ fontSize: 14 }}
          width={80}
          // 막대는 plot 하단 ~40%로 압축 — 라인과 시각 분리.
          domain={[0, (max: number) => Math.max(max * 2.5, 1)]}
        />
        <YAxis
          yAxisId="rate"
          orientation="right"
          tickFormatter={(v: number) => `${Math.round(v)}%`}
          tick={{ fontSize: 14 }}
          width={56}
          // 0%가 plot 하단(~58%)에 오도록 음수 영역까지 확장 → 양수 라인은 상단에 그려진다.
          domain={[-rateMax * 1.5, rateMax * 1.1]}
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
          contentStyle={TOOLTIP_CONTENT_STYLE}
          content={<AchievementTooltip unitLabel={unitLabel} amountDigits={amountDigits} />}
        />
        <Legend
          verticalAlign="top"
          wrapperStyle={{ paddingBottom: 4 }}
          content={() => (
            <LegendRow
              items={[
                { key: 'plan', label: '계획', shape: 'rect', color: PLAN_COLOR },
                { key: 'actual', label: '실적', shape: 'rect', color: BASE },
                { key: 'rate', label: '달성율', shape: 'line', color: RATE_COLOR },
              ]}
              hidden={hidden}
              onToggle={toggle}
            />
          )}
        />
        <Bar
          yAxisId="amount"
          dataKey="plan"
          name="계획"
          fill={PLAN_COLOR}
          radius={[2, 2, 0, 0]}
          hide={hidden.has('plan')}
        >
          <LabelList
            dataKey="plan"
            position="top"
            formatter={(value: unknown) =>
              typeof value === 'number' ? fmt(value, amountDigits) : ''
            }
            style={{ fontSize: 16, fill: 'var(--foreground)', fontWeight: 500 }}
          />
        </Bar>
        <Bar
          yAxisId="amount"
          dataKey="actual"
          name="실적"
          fill={BASE}
          radius={[2, 2, 0, 0]}
          hide={hidden.has('actual')}
        >
          <LabelList
            dataKey="actual"
            position="top"
            formatter={(value: unknown) =>
              typeof value === 'number' ? fmt(value, amountDigits) : ''
            }
            style={{ fontSize: 16, fill: 'var(--foreground)', fontWeight: 500 }}
          />
        </Bar>
        <Line
          yAxisId="rate"
          type="monotone"
          dataKey="rate"
          name="달성율"
          stroke={RATE_COLOR}
          strokeWidth={2.5}
          dot={{ r: 5, fill: RATE_COLOR }}
          connectNulls
          hide={hidden.has('rate')}
        >
          <LabelList
            dataKey="rate"
            position="top"
            formatter={(value: unknown) => (typeof value === 'number' ? `${fmt(value, 1)}%` : '')}
            style={{ fontSize: 16, fill: RATE_COLOR, fontWeight: 600 }}
            offset={16}
          />
        </Line>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** 공통 범례 — 사용자 지정 순서대로 칩(사각형/라인 + 라벨), 클릭으로 시리즈 토글. 폰트 16. */
export function LegendRow({
  items,
  hidden,
  onToggle,
}: {
  items: Array<{ key: string; label: string; shape: 'rect' | 'line'; color: string }>;
  hidden?: Set<string>;
  onToggle?: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-base font-medium">
      {items.map((it) => {
        const isHidden = hidden?.has(it.key) ?? false;
        const clickable = !!onToggle;
        return (
          <button
            key={it.key}
            type="button"
            onClick={clickable ? () => onToggle?.(it.key) : undefined}
            disabled={!clickable}
            className={`inline-flex items-center gap-1.5 transition-opacity ${
              isHidden ? 'opacity-40 line-through' : ''
            } ${clickable ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
            style={{ color: it.color }}
            aria-pressed={!isHidden}
          >
            {it.shape === 'rect' ? (
              <span className="inline-block w-4 h-4 rounded-sm" style={{ background: it.color }} />
            ) : (
              <span className="inline-block w-5 h-0.5 relative" style={{ background: it.color }}>
                <span
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 inline-block w-2 h-2 rounded-full"
                  style={{ background: it.color }}
                />
              </span>
            )}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

function AchievementTooltip({
  active,
  payload,
  label,
  unitLabel,
  amountDigits,
}: {
  active?: boolean;
  payload?: Array<{ payload: AchievementPoint }>;
  label?: string;
  unitLabel: string;
  amountDigits: number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div
      className="rounded-md p-2 text-base"
      style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <div className="font-semibold mb-1">{label}</div>
      <div>
        계획: {fmt(p.plan, amountDigits)} {unitLabel}
      </div>
      <div>
        실적: {fmt(p.actual, amountDigits)} {unitLabel}
      </div>
      <div className={p.rate != null && p.rate < 100 ? 'text-red-500' : 'text-emerald-600'}>
        달성율: {p.rate == null ? '—' : `${fmt(p.rate, 1)}%`}
      </div>
    </div>
  );
}
