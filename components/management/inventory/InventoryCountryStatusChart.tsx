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
import { ChartSection } from '@/components/management/plan/_selectors';
import { LegendRow } from '@/components/charts/ChartLegend';
import { sumVisibleStack, TOTAL_LABEL_ANCHOR } from '@/components/management/chart-utils';
import type { CountryStatusPoint } from '@/lib/inventory/types';

function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('ko-KR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function pctOf(part: number | null | undefined, total: number | null | undefined): string {
  if (part === null || part === undefined || total === null || total === undefined || total === 0)
    return '—';
  return `${((part / total) * 100).toFixed(1)}%`;
}

const COLORS = {
  domestic: MGMT_BAR_COLORS[0],
  us: MGMT_BAR_COLORS[1],
  uz: MGMT_BAR_COLORS[2],
  residual: MGMT_BAR_COLORS[3],
};

const STACK_KEYS = ['domestic', 'us', 'uz', 'residual'] as const;

interface Props {
  points: CountryStatusPoint[];
}

/**
 * 차트 2 — 재고 현황 (국가, 실적만).
 * - 누적막대 4개 층 (국내/미국/우즈벡 + 영업+국내보상)
 * - "영업+국내보상" = 전체재고 − 국가합. 기본 숨김 → 켜면 총액이 차트 1(전체재고)과 일치.
 * - 회전율 없음. 범례 클릭으로 시리즈 토글. 호버 툴팁에 분류별 비중(%).
 */
export default function InventoryCountryStatusChart({ points }: Props) {
  const h = useChartHeight(380, 460, 540);
  // 영업+국내보상(residual)은 기본 숨김 상태로 시작.
  const [hidden, setHidden] = useState<Set<string>>(new Set(['residual']));
  const toggle = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const chartData = useMemo(
    () =>
      points.map((p) => ({
        ...p,
        __anchor: TOTAL_LABEL_ANCHOR,
        __labelTotal: sumVisibleStack(p, STACK_KEYS, hidden),
      })),
    [points, hidden]
  );
  if (points.length === 0) {
    return (
      <ChartSection title="2. 재고 현황 (국가)" unit="억원">
        <div className="py-12 text-center text-base text-muted-foreground">데이터가 없습니다.</div>
      </ChartSection>
    );
  }
  return (
    <ChartSection title="2. 재고 현황 (국가)" unit="억원">
      <ResponsiveContainer width="100%" height={h}>
        <ComposedChart data={chartData} margin={{ top: 32, right: 24, bottom: 10, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
          <XAxis
            dataKey="monthLabel"
            tick={{ fontSize: 12 }}
            interval={0}
            angle={-30}
            textAnchor="end"
            height={56}
          />
          <YAxis tickFormatter={(v: number) => fmt(v, 0)} tick={{ fontSize: 13 }} width={70} />
          <Tooltip
            cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
            contentStyle={TOOLTIP_CONTENT_STYLE}
            content={<CountryTooltip />}
          />
          <Legend
            verticalAlign="top"
            wrapperStyle={{ paddingBottom: 4 }}
            content={() => (
              <LegendRow
                items={[
                  { key: 'domestic', label: '국내', shape: 'rect', color: COLORS.domestic },
                  { key: 'us', label: '미국', shape: 'rect', color: COLORS.us },
                  { key: 'uz', label: '우즈벡', shape: 'rect', color: COLORS.uz },
                  {
                    key: 'residual',
                    label: '영업+국내보상',
                    shape: 'rect',
                    color: COLORS.residual,
                  },
                ]}
                hidden={hidden}
                onToggle={toggle}
              />
            )}
          />
          <Bar
            dataKey="domestic"
            name="국내"
            stackId="inv"
            fill={COLORS.domestic}
            hide={hidden.has('domestic')}
          />
          <Bar dataKey="us" name="미국" stackId="inv" fill={COLORS.us} hide={hidden.has('us')} />
          <Bar dataKey="uz" name="우즈벡" stackId="inv" fill={COLORS.uz} hide={hidden.has('uz')} />
          <Bar
            dataKey="residual"
            name="영업+국내보상"
            stackId="inv"
            fill={COLORS.residual}
            hide={hidden.has('residual')}
          />
          <Bar
            dataKey="__anchor"
            stackId="inv"
            fill="transparent"
            isAnimationActive={false}
            legendType="none"
            tooltipType="none"
          >
            <LabelList
              dataKey="__labelTotal"
              position="top"
              formatter={(v: unknown) => (typeof v === 'number' ? fmt(v, 0) : '')}
              style={{ fontSize: 16, fill: 'var(--foreground)', fontWeight: 600 }}
            />
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </ChartSection>
  );
}

function CountryTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: CountryStatusPoint }>;
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
        국내: {fmt(p.domestic, 0)} 억원{' '}
        <span className="text-muted-foreground">({pctOf(p.domestic, p.total)})</span>
      </div>
      <div>
        미국: {fmt(p.us, 0)} 억원{' '}
        <span className="text-muted-foreground">({pctOf(p.us, p.total)})</span>
      </div>
      <div>
        우즈벡: {fmt(p.uz, 0)} 억원{' '}
        <span className="text-muted-foreground">({pctOf(p.uz, p.total)})</span>
      </div>
      <div>
        영업+국내보상: {fmt(p.residual, 0)} 억원{' '}
        <span className="text-muted-foreground">({pctOf(p.residual, p.total)})</span>
      </div>
      <div className="font-semibold pt-1 mt-1 border-t border-border">
        전체: {fmt(p.total, 0)} 억원
      </div>
    </div>
  );
}
