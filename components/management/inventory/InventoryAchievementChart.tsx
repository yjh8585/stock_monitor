'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TOOLTIP_CONTENT_STYLE } from '@/components/charts/chartTheme';
import { DATA_LABEL_STYLE } from '@/components/oem-companies/common/chartStyle';
import { useChartHeight } from '@/lib/useChartHeight';
import { OEM_COLORS } from '@/components/charts/palette';
import { LegendRow } from '@/components/charts/ChartLegend';
import type { AchievementMonthPoint } from '@/lib/inventory/types';

function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('ko-KR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 막대 위 값 레이블 — 정수는 그대로, 소수는 첫째 자리까지. */
function fmtValueLabel(v: unknown): string {
  if (typeof v !== 'number' || Number.isNaN(v)) return '';
  return Number.isInteger(v)
    ? v.toLocaleString('ko-KR')
    : v.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
}

const BASE = OEM_COLORS[0];
const PLAN_COLOR = hexToRgba(BASE, 0.4);
const TARGET_COLOR = '#dc2626';

interface Props {
  points: AchievementMonthPoint[];
  unitLabel?: string;
  /** 막대 위 값 데이터 레이블 표시 (정수 그대로, 소수 첫째 자리). 미지정 시 목표값 레이블만. */
  showValueLabels?: boolean;
}

/**
 * 차트 2/3 공통 — 월별 X축, 계획·실적 막대.
 * - 마지막 연도 12월 계획 = 목표값 → 빨간 점선 ReferenceLine + 해당 막대 위 데이터 레이블.
 * - 범례 클릭으로 계획/실적 시리즈 토글.
 */
export default function InventoryAchievementChart({
  points,
  unitLabel = '억원',
  showValueLabels = false,
}: Props) {
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

  // 목표값 = 최근 연도 12월 계획값. 해당 포인트가 없으면 null → ReferenceLine·라벨 미렌더.
  const targetInfo = useMemo(() => {
    if (points.length === 0) return null;
    const maxYear = Math.max(...points.map((p) => p.year));
    const target = points.find((p) => p.year === maxYear && p.month === 12 && p.plan !== null);
    if (!target || target.plan === null) return null;
    return { monthLabel: target.monthLabel, value: target.plan };
  }, [points]);

  if (points.length === 0) {
    return (
      <div className="py-12 text-center text-base text-muted-foreground">데이터가 없습니다.</div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={h}>
      <ComposedChart data={points} margin={{ top: 32, right: 24, bottom: 10, left: 10 }} barGap={2}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
        <XAxis
          dataKey="monthLabel"
          tick={{ fontSize: 12 }}
          interval={0}
          angle={-30}
          textAnchor="end"
          height={56}
        />
        <YAxis
          tickFormatter={(v: number) => fmt(v, 0)}
          tick={{ fontSize: 13 }}
          width={70}
          domain={[0, (max: number) => Math.max(max * 1.2, 1)]}
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
          contentStyle={TOOLTIP_CONTENT_STYLE}
          content={<Tip unitLabel={unitLabel} precise={showValueLabels} />}
        />
        <Legend
          verticalAlign="top"
          wrapperStyle={{ paddingBottom: 4 }}
          content={() => (
            <LegendRow
              items={[
                { key: 'plan', label: '계획', shape: 'rect', color: PLAN_COLOR },
                { key: 'actual', label: '실적', shape: 'rect', color: BASE },
                ...(targetInfo
                  ? [
                      {
                        key: 'target',
                        label: `목표 (${targetInfo.monthLabel} 계획)`,
                        shape: 'line' as const,
                        color: TARGET_COLOR,
                      },
                    ]
                  : []),
              ]}
              hidden={hidden}
              onToggle={toggle}
            />
          )}
        />
        {targetInfo && !hidden.has('target') ? (
          <ReferenceLine
            y={targetInfo.value}
            stroke={TARGET_COLOR}
            strokeDasharray="6 4"
            strokeWidth={1.5}
            ifOverflow="extendDomain"
          />
        ) : null}
        <Bar
          dataKey="plan"
          name="계획"
          fill={PLAN_COLOR}
          radius={[2, 2, 0, 0]}
          hide={hidden.has('plan')}
        >
          {targetInfo && !showValueLabels ? (
            <LabelList
              dataKey="plan"
              position="top"
              formatter={(value: unknown) => {
                if (typeof value !== 'number') return '';
                // 목표값과 동일한 값만 표시 (최근 연도 12월)
                return Math.abs(value - targetInfo.value) < 0.001 ? fmt(value, 0) : '';
              }}
              style={{ fontSize: 16, fill: TARGET_COLOR, fontWeight: 600 }}
            />
          ) : null}
          {showValueLabels ? (
            <LabelList
              dataKey="plan"
              position="top"
              formatter={fmtValueLabel}
              style={{ ...DATA_LABEL_STYLE, fill: 'var(--muted-foreground)' }}
            />
          ) : null}
        </Bar>
        <Bar
          dataKey="actual"
          name="실적"
          fill={BASE}
          radius={[2, 2, 0, 0]}
          hide={hidden.has('actual')}
        >
          {showValueLabels ? (
            <LabelList
              dataKey="actual"
              position="top"
              formatter={fmtValueLabel}
              style={DATA_LABEL_STYLE}
            />
          ) : null}
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function Tip({
  active,
  payload,
  label,
  unitLabel,
  precise,
}: {
  active?: boolean;
  payload?: Array<{ payload: AchievementMonthPoint }>;
  label?: string;
  unitLabel: string;
  /** true면 소수 첫째 자리까지 표시(정수는 그대로). 미지정 시 정수 반올림. */
  precise?: boolean;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  const fv = (v: number | null) => {
    if (v === null || Number.isNaN(v)) return '—';
    if (!precise) return fmt(v, 0);
    return Number.isInteger(v)
      ? v.toLocaleString('ko-KR')
      : v.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
  };
  return (
    <div
      className="rounded-md p-2 text-base"
      style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <div className="font-semibold mb-1">{label}</div>
      <div>
        계획: {fv(p.plan)} {unitLabel}
      </div>
      <div>
        실적: {fv(p.actual)} {unitLabel}
      </div>
    </div>
  );
}
