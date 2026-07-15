'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TOOLTIP_CONTENT_STYLE } from '@/components/charts/chartTheme';
import { MGMT_BAR_COLORS } from '@/components/charts/palette';
import { useChartHeight } from '@/lib/useChartHeight';
import { LegendRow } from '@/components/charts/ChartLegend';
import { sumVisibleStack, TOTAL_LABEL_ANCHOR } from '@/components/management/chart-utils';
import type { FieldMixPoint } from '@/lib/personnel/types';

function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('ko-KR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

const FIELD_COLOR = MGMT_BAR_COLORS[2]; // 밝은 파랑 (현장 = 생산 계열)
const ADMIN_COLOR = MGMT_BAR_COLORS[0]; // 진한 남색 (관리 = 사무 계열)

interface Props {
  points: FieldMixPoint[];
}

interface EnrichedFieldMixPoint extends FieldMixPoint {
  fieldLabel: string;
  adminLabel: string;
  /** 합계 레이블 앵커(무한소) + 보이는 시리즈 동적 합계. */
  __anchor: number;
  __labelTotal: number | null;
}

/**
 * 차트 5 — 현장/관리 구분 (국내 인원 기준).
 * - 현장 = 생산·품질·연구소 detail
 * - 관리 = 그 외 국내 detail
 * - 차트 4(PersonnelMixChart) 양식 활용: 막대 안 인원수+비중%, 막대 위 합계.
 */
export default function PersonnelFieldMixChart({ points }: Props) {
  const h = useChartHeight(380, 460, 540);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggle = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const enriched = useMemo<EnrichedFieldMixPoint[]>(
    () =>
      points.map((p) => ({
        ...p,
        fieldLabel:
          p.field !== null && p.fieldPct !== null
            ? `${fmt(p.field, 0)}\n(${p.fieldPct.toFixed(1)}%)`
            : '',
        adminLabel:
          p.admin !== null && p.adminPct !== null
            ? `${fmt(p.admin, 0)}\n(${p.adminPct.toFixed(1)}%)`
            : '',
        __anchor: TOTAL_LABEL_ANCHOR,
        __labelTotal: sumVisibleStack(p, ['admin', 'field'], hidden),
      })),
    [points, hidden]
  );

  if (points.length === 0) {
    return (
      <div className="py-12 text-center text-base text-muted-foreground">데이터가 없습니다.</div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={h}>
      <ComposedChart data={enriched} margin={{ top: 32, right: 24, bottom: 10, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
        <XAxis dataKey="periodLabel" tick={{ fontSize: 13 }} />
        <YAxis tickFormatter={(v: number) => fmt(v, 0)} tick={{ fontSize: 13 }} width={70} />
        <Tooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
          contentStyle={TOOLTIP_CONTENT_STYLE}
          content={<FieldTooltip />}
        />
        <Legend
          verticalAlign="top"
          wrapperStyle={{ paddingBottom: 4 }}
          content={() => (
            <LegendRow
              items={[
                { key: 'admin', label: '관리', shape: 'rect', color: ADMIN_COLOR },
                {
                  key: 'field',
                  label: '현장(생산·품질·연구소)',
                  shape: 'rect',
                  color: FIELD_COLOR,
                },
              ]}
              hidden={hidden}
              onToggle={toggle}
            />
          )}
        />
        <Bar dataKey="admin" name="관리" stackId="fm" fill={ADMIN_COLOR} hide={hidden.has('admin')}>
          <LabelList dataKey="adminLabel" content={renderInsideLabel} />
        </Bar>
        <Bar dataKey="field" name="현장" stackId="fm" fill={FIELD_COLOR} hide={hidden.has('field')}>
          <LabelList dataKey="fieldLabel" content={renderInsideLabel} />
        </Bar>
        <Bar
          dataKey="__anchor"
          stackId="fm"
          fill="transparent"
          isAnimationActive={false}
          legendType="none"
          tooltipType="none"
        >
          <LabelList
            dataKey="__labelTotal"
            position="top"
            formatter={(v: unknown) => (typeof v === 'number' ? fmt(v, 0) : '')}
            style={{ fontSize: 16, fill: 'var(--foreground)', fontWeight: 700 }}
          />
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderInsideLabel(props: any): React.ReactElement | null {
  const { x, y, width, height, value } = props as {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    value?: string;
  };
  if (x === undefined || y === undefined || width === undefined || height === undefined || !value)
    return null;
  if (height < 40) return null;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const [num, pct] = String(value).split('\n');
  return (
    <text
      x={cx}
      y={cy}
      textAnchor="middle"
      style={{ fontSize: 16, fill: 'white', fontWeight: 600 }}
    >
      <tspan x={cx} dy="-0.3em">
        {num}
      </tspan>
      {pct ? (
        <tspan x={cx} dy="1.2em">
          {pct}
        </tspan>
      ) : null}
    </text>
  );
}

function FieldTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: FieldMixPoint }>;
  label?: string;
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
        관리: {fmt(p.admin, 0)}{' '}
        <span className="text-muted-foreground">
          ({p.adminPct === null ? '—' : `${p.adminPct.toFixed(1)}%`})
        </span>
      </div>
      <div>
        현장(생산·품질·연구소): {fmt(p.field, 0)}{' '}
        <span className="text-muted-foreground">
          ({p.fieldPct === null ? '—' : `${p.fieldPct.toFixed(1)}%`})
        </span>
      </div>
      <div className="font-semibold pt-1 mt-1 border-t border-border">합계: {fmt(p.total, 0)}</div>
    </div>
  );
}
