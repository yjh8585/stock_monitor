'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { LegendRow } from '@/components/charts/ChartLegend';
import { MGMT_BAR_COLORS } from '@/components/charts/palette';
import {
  GRID_STROKE_OPACITY,
  MGMT_DATA_LABEL_STYLE,
} from '@/components/oem-companies/common/chartStyle';
import { useChartHeight } from '@/lib/useChartHeight';
import type { CashWaterfallStep } from '@/lib/finance/types';

// 재무 페이지 확정 결정: 증가 파랑 / 감소 빨강. 잔액 막대는 경영관리 진한 남색, 잔여는 회색.
const UP = '#3b82f6';
const DOWN = '#ef4444';
const TOTAL = MGMT_BAR_COLORS[0];
const RESIDUAL = '#9ca3af';
const DUMMY_STROKE = '#d97706'; // 더미(입력 예시) 표식 — 표의 주황 기울임과 같은 색

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ko-KR');
}

function colorOf(s: CashWaterfallStep): string {
  if (s.kind === 'total') return TOTAL;
  if (s.kind === 'residual') return RESIDUAL;
  return s.value >= 0 ? UP : DOWN;
}

interface Props {
  steps: CashWaterfallStep[];
  periodLabel: string;
}

/**
 * 3. 자금수지 폭포 차트 — 최신 기간의 기초 현금 → 기말 현금.
 *
 * - recharts 범위 막대(dataKey 가 [lo, hi]) — 음수 구간도 그대로 그린다(누적 막대 트릭은 음수에서 깨진다).
 * - 범례 토글 없음: 한 막대를 끄면 다음 막대들의 출발점이 틀어져 폭포가 거짓이 된다.
 * - 더미(입력 예시)가 섞인 막대는 주황 점선 테두리 + 옅게.
 * - 높이 0 막대는 라벨 index 가 밀리므로(chart-guide §7-A) 아주 작은 높이를 남긴다.
 */
export default function FinanceCashWaterfallChart({ steps, periodLabel }: Props) {
  const h = useChartHeight(300, 360, 420);
  const data = steps.map((s) => ({
    ...s,
    bar: s.range[0] === s.range[1] ? [s.range[0], s.range[0] + 0.0001] : s.range,
  }));
  const hasDummy = steps.some((s) => s.dummy);

  return (
    <div>
      <div className="mb-1 text-sm text-muted-foreground">
        {periodLabel} 기준 · 기초 현금 → 기말 현금
      </div>
      <LegendRow
        items={[
          { key: 'total', label: '현금 잔액', shape: 'rect', color: TOTAL },
          { key: 'up', label: '현금 증가', shape: 'rect', color: UP },
          { key: 'down', label: '현금 감소', shape: 'rect', color: DOWN },
          { key: 'residual', label: '미설명 차이', shape: 'rect', color: RESIDUAL },
          ...(hasDummy
            ? [
                {
                  key: 'dummy',
                  label: '더미 포함(점선)',
                  shape: 'rect' as const,
                  color: DUMMY_STROKE,
                },
              ]
            : []),
        ]}
      />
      {/* 막대 12개 + 부호 라벨이 좁은 폭에서 겹친다 → 최소 폭을 두고 가로 스크롤(표와 같은 방식). */}
      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <ResponsiveContainer width="100%" height={h}>
            <BarChart data={data} margin={{ top: 28, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                className="stroke-border"
                strokeOpacity={GRID_STROKE_OPACITY}
                vertical={false}
              />
              <XAxis
                dataKey="label"
                interval={0}
                angle={-25}
                textAnchor="end"
                height={64}
                tick={{ fontSize: 12 }}
              />
              <YAxis tickFormatter={(v: number) => fmt(v)} tick={{ fontSize: 13 }} width={64} />
              <ReferenceLine y={0} stroke="var(--foreground)" strokeOpacity={0.4} />
              <Tooltip
                cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
                content={<WaterfallTooltip />}
              />
              <Bar dataKey="bar" isAnimationActive={false}>
                {data.map((s) => (
                  <Cell
                    key={s.key}
                    fill={colorOf(s)}
                    fillOpacity={s.dummy ? 0.45 : 1}
                    stroke={s.dummy ? DUMMY_STROKE : undefined}
                    strokeWidth={s.dummy ? 2 : 0}
                    strokeDasharray={s.dummy ? '4 3' : undefined}
                  />
                ))}
                <LabelList
                  dataKey="value"
                  position="top"
                  formatter={(v: unknown) =>
                    typeof v === 'number' ? (v > 0 ? `+${fmt(v)}` : fmt(v)) : ''
                  }
                  style={MGMT_DATA_LABEL_STYLE}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function WaterfallTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: CashWaterfallStep }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const s = payload[0].payload;
  return (
    <div
      className="rounded-md p-2 text-base"
      style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <div className="font-semibold">{s.label}</div>
      <div>
        {s.kind === 'total' ? '잔액' : '증감'}: {s.kind !== 'total' && s.value > 0 ? '+' : ''}
        {fmt(s.value)} 억원
      </div>
      {s.dummy ? (
        <div className="text-sm text-amber-600">더미(입력 예시) 값이 섞여 있습니다</div>
      ) : null}
    </div>
  );
}
