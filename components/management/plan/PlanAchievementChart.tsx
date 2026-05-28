'use client';

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
  return n.toLocaleString('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: digits });
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
 * - 막대는 좌측 amount 축(domain [0, max×2.2]) → 막대가 plot 하단 ~45%에만 그려진다.
 * - 라인은 우측 rate 축(domain [−max×1.0, max×1.1]) → 라인이 plot 상단 ~55%에 그려진다.
 *   양쪽 축의 0이 같은 y 위치에 오지 않게 의도적으로 비대칭으로 잡아 막대·라인 영역을 분리.
 * - 데이터 라벨: 막대는 outside top, 라인은 marker 위쪽. 폰트 16(경영관리 페이지 호버와 동일).
 * - top margin을 넉넉히(40) 두어 outside 라벨이 잘리지 않게.
 */
export default function PlanAchievementChart({ points, unitLabel, amountDigits = 0 }: Props) {
  const h = useChartHeight(360, 440, 520);
  if (points.length === 0) {
    return (
      <div className="py-12 text-center text-base text-muted-foreground">데이터가 없습니다.</div>
    );
  }
  // 라인 우측 축은 양/음 범위로 잡아 0이 막대 영역(하단)보다 위에 위치하도록.
  const rateMax = Math.max(
    100,
    ...points.map((p) => (p.rate == null ? 0 : Math.abs(p.rate)))
  );
  return (
    <ResponsiveContainer width="100%" height={h}>
      <ComposedChart data={points} margin={{ top: 40, right: 24, bottom: 10, left: 10 }} barGap={2}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
        <XAxis dataKey="yearLabel" tick={{ fontSize: 14 }} />
        <YAxis
          yAxisId="amount"
          tickFormatter={(v: number) => fmt(v, amountDigits)}
          tick={{ fontSize: 14 }}
          width={80}
          // 막대 plot 하단 ~45%로 압축 — 라인과 시각 분리.
          domain={[0, (max: number) => Math.max(max * 2.2, 1)]}
        />
        <YAxis
          yAxisId="rate"
          orientation="right"
          tickFormatter={(v: number) => `${Math.round(v)}%`}
          tick={{ fontSize: 14 }}
          width={56}
          // 0%가 plot 중앙보다 약간 아래로 가도록 음수 영역까지 확장 → 양수 라인은 상단에 그려진다.
          domain={[-rateMax * 1.0, rateMax * 1.1]}
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
          contentStyle={{
            backgroundColor: 'var(--card)',
            border: '1px solid var(--border)',
            fontSize: '16px',
          }}
          content={<AchievementTooltip unitLabel={unitLabel} amountDigits={amountDigits} />}
        />
        <Legend
          verticalAlign="top"
          wrapperStyle={{ paddingBottom: 4 }}
          // 사용자 요청 순서: 계획, 실적, 달성율 (render 순서 그대로 노출)
          content={() => (
            <LegendRow
              items={[
                { label: '계획', shape: 'rect', color: PLAN_COLOR },
                { label: '실적', shape: 'rect', color: BASE },
                { label: '달성율', shape: 'line', color: RATE_COLOR },
              ]}
            />
          )}
        />
        <Bar yAxisId="amount" dataKey="plan" name="계획" fill={PLAN_COLOR} radius={[2, 2, 0, 0]}>
          <LabelList
            dataKey="plan"
            position="top"
            formatter={(value: unknown) =>
              typeof value === 'number' ? fmt(value, amountDigits) : ''
            }
            style={{ fontSize: 16, fill: 'var(--foreground)', fontWeight: 500 }}
          />
        </Bar>
        <Bar yAxisId="amount" dataKey="actual" name="실적" fill={BASE} radius={[2, 2, 0, 0]}>
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
        >
          <LabelList
            dataKey="rate"
            position="top"
            formatter={(value: unknown) =>
              typeof value === 'number' ? `${fmt(value, 1)}%` : ''
            }
            style={{ fontSize: 16, fill: RATE_COLOR, fontWeight: 600 }}
            offset={10}
          />
        </Line>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** 공통 범례 표시 — 사용자 지정 순서대로 칩(사각형/라인 + 라벨). 폰트 16. */
export function LegendRow({
  items,
}: {
  items: Array<{ label: string; shape: 'rect' | 'line'; color: string }>;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-base font-medium">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5" style={{ color: it.color }}>
          {it.shape === 'rect' ? (
            <span className="inline-block w-4 h-4 rounded-sm" style={{ background: it.color }} />
          ) : (
            <span
              className="inline-block w-5 h-0.5"
              style={{ background: it.color, position: 'relative' }}
            >
              <span
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 inline-block w-2 h-2 rounded-full"
                style={{ background: it.color }}
              />
            </span>
          )}
          {it.label}
        </span>
      ))}
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
