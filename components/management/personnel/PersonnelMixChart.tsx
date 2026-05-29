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
import { useChartHeight } from '@/lib/useChartHeight';
import { LegendRow } from '@/components/management/plan/PlanAchievementChart';
import { sumVisibleStack, TOTAL_LABEL_ANCHOR } from '@/components/management/chart-utils';
import type { MixPoint } from '@/lib/personnel/types';

/** 숫자 포맷 (ko-KR). */
function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('ko-KR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

const OFFICE_COLOR = '#0891b2'; // cyan-600 — 사무직 차분
const PRODUCTION_COLOR = '#f59e0b'; // amber-500 — 생산직 활동

interface Props {
  points: MixPoint[];
}

/** PersonnelMixChart 내부에서 LabelList content용으로 가공한 point. */
interface EnrichedMixPoint extends MixPoint {
  /** 막대 안 표시용 — "인원수\n(비중%)" 두 줄. */
  officeLabel: string;
  productionLabel: string;
  /** 합계 레이블 앵커(무한소) + 보이는 시리즈 동적 합계. */
  __anchor: number;
  __labelTotal: number | null;
}

/**
 * 차트 4 — 사무/생산 비중 (누적막대 2층).
 * 막대 안: 인원수 + 비중%(괄호).
 * 막대 위: 사무+생산 합계.
 * 범례 클릭 토글, 호버 시 비중 % 표시.
 */
export default function PersonnelMixChart({ points }: Props) {
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

  const enriched = useMemo<EnrichedMixPoint[]>(
    () =>
      points.map((p) => ({
        ...p,
        officeLabel:
          p.office !== null && p.officePct !== null
            ? `${fmt(p.office, 0)}\n(${p.officePct.toFixed(1)}%)`
            : '',
        productionLabel:
          p.production !== null && p.productionPct !== null
            ? `${fmt(p.production, 0)}\n(${p.productionPct.toFixed(1)}%)`
            : '',
        __anchor: TOTAL_LABEL_ANCHOR,
        __labelTotal: sumVisibleStack(p, ['office', 'production'], hidden),
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
          contentStyle={{
            backgroundColor: 'var(--card)',
            border: '1px solid var(--border)',
            fontSize: '16px',
          }}
          content={<MixTooltip />}
        />
        <Legend
          verticalAlign="top"
          wrapperStyle={{ paddingBottom: 4 }}
          content={() => (
            <LegendRow
              items={[
                { key: 'office', label: '사무(임원+사무)', shape: 'rect', color: OFFICE_COLOR },
                { key: 'production', label: '생산', shape: 'rect', color: PRODUCTION_COLOR },
              ]}
              hidden={hidden}
              onToggle={toggle}
            />
          )}
        />
        <Bar
          dataKey="office"
          name="사무"
          stackId="m"
          fill={OFFICE_COLOR}
          hide={hidden.has('office')}
        >
          <LabelList dataKey="officeLabel" content={renderInsideLabel} />
        </Bar>
        <Bar
          dataKey="production"
          name="생산"
          stackId="m"
          fill={PRODUCTION_COLOR}
          hide={hidden.has('production')}
        >
          <LabelList dataKey="productionLabel" content={renderInsideLabel} />
        </Bar>
        <Bar
          dataKey="__anchor"
          stackId="m"
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

/**
 * 막대 내부 라벨 렌더러 — "인원수 + 비중%" 두 줄.
 * recharts LabelList content prop은 외부 인터페이스라 props 타입이 any.
 */
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
  if (height < 40) return null; // 막대가 짧으면 생략 (두 줄 16px 가독성 확보)
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

/** 호버 툴팁 — 사무/생산 인원수 + 비중%. */
function MixTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: MixPoint }>;
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
        사무(임원+사무): {fmt(p.office, 0)}{' '}
        <span className="text-muted-foreground">
          ({p.officePct === null ? '—' : `${p.officePct.toFixed(1)}%`})
        </span>
      </div>
      <div>
        생산: {fmt(p.production, 0)}{' '}
        <span className="text-muted-foreground">
          ({p.productionPct === null ? '—' : `${p.productionPct.toFixed(1)}%`})
        </span>
      </div>
      <div className="font-semibold pt-1 mt-1 border-t border-border">합계: {fmt(p.total, 0)}</div>
    </div>
  );
}
