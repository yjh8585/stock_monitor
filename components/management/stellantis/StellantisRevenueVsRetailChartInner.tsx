'use client';

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { LegendRow } from '@/components/charts/ChartLegend';
import { TOOLTIP_CONTENT_STYLE } from '@/components/charts/chartTheme';
import { MGMT_BAR_COLORS } from '@/components/charts/palette';
import { GRID_STROKE_OPACITY } from '@/components/oem-companies/common/chartStyle';
import { useHiddenSeries } from '@/components/oem-companies/common/useHiddenSeries';
import { useChartHeight } from '@/lib/useChartHeight';
import type { RevenueVsRetailPoint } from '@/lib/stellantis-forecast/types';
import { fmt } from './format';

/** 자사 매출 막대 — 경영관리 막대 기본색(chart-guide §5-A). */
const REVENUE_COLOR = MGMT_BAR_COLORS[0];

/** 소매 꺾은선 — 파란 막대와 대비되는 빨강 고정(chart-guide §5-A). */
const RETAIL_COLOR = '#dc2626';

/**
 * 차트 2 — 자사 매출(억원) 막대 + 스텔란티스 북미 소매(대) 꺾은선.
 *
 * 소매는 탐지된 시차만큼 밀어 정렬돼 있다(`buildRevenueVsRetail`). 두 계열이 같은 리듬으로
 * 움직이는지 눈으로 확인하는 차트다 — 상관계수 하나(카드 3)보다 이쪽이 검증하기 쉽다.
 *
 * 이중축은 chart-guide §4-F 표준 그대로다. 소매는 항상 0 이상 단일 부호라
 * 차트 1과 달리 공식 `[-max×1.5, max×1.1]`을 손대지 않고 쓴다.
 *
 * 데이터 라벨은 달지 않는다 — 월 53개라 라벨이 반드시 겹친다. 값은 툴팁으로 제공.
 */
export default function StellantisRevenueVsRetailChartInner({
  points,
}: {
  points: RevenueVsRetailPoint[];
}) {
  const h = useChartHeight(360, 440, 520);
  const { isHidden, toggle, hidden } = useHiddenSeries();

  if (points.length === 0) {
    return (
      <div className="py-12 text-center text-base text-muted-foreground">데이터가 없습니다.</div>
    );
  }

  const retailMax = Math.max(
    1,
    ...points.map((p) => (p.retailShifted === null ? 0 : p.retailShifted))
  );

  return (
    <ResponsiveContainer width="100%" height={h}>
      <ComposedChart data={points} margin={{ top: 24, right: 24, bottom: 10, left: 10 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          className="stroke-border"
          strokeOpacity={GRID_STROKE_OPACITY}
          vertical={false}
        />
        <XAxis dataKey="label" tick={{ fontSize: 13 }} />
        <YAxis
          yAxisId="revenue"
          tickFormatter={(v: number) => fmt(v)}
          tick={{ fontSize: 13 }}
          width={70}
          // 막대는 plot 하단 ~40%로 압축 (chart-guide §4-F).
          domain={[0, (max: number) => Math.max(max * 2.5, 1)]}
        />
        <YAxis
          yAxisId="retail"
          orientation="right"
          tickFormatter={(v: number) => fmt(v)}
          tick={{ fontSize: 13 }}
          width={80}
          // 0을 하단(~58%)에 두어 양수 꺾은선을 상단 밴드로 민다 (chart-guide §4-F 표준).
          domain={[-retailMax * 1.5, retailMax * 1.1]}
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
          content={<RevenueRetailTooltip />}
        />
        {/* 막대(자사 매출) → 꺾은선(소매) 순서 — chart-guide §7-7. */}
        <Legend
          verticalAlign="top"
          wrapperStyle={{ paddingBottom: 4 }}
          content={() => (
            <LegendRow
              items={[
                {
                  key: 'revenueEok',
                  label: '자사 매출(억원)',
                  shape: 'rect',
                  color: REVENUE_COLOR,
                },
                {
                  key: 'retailShifted',
                  label: '스텔란티스 북미 소매(대)',
                  shape: 'line',
                  color: RETAIL_COLOR,
                },
              ]}
              hidden={hidden}
              onToggle={toggle}
            />
          )}
        />
        <Bar
          yAxisId="revenue"
          dataKey="revenueEok"
          name="자사 매출(억원)"
          fill={REVENUE_COLOR}
          radius={[2, 2, 0, 0]}
          hide={isHidden('revenueEok')}
        />
        {/* 시차 정렬로 소매가 없는 구간(계열 양 끝)은 선을 잇지 않는다 — 이으면 없는 데이터를
            그린 것처럼 보인다. */}
        <Line
          yAxisId="retail"
          type="monotone"
          dataKey="retailShifted"
          name="스텔란티스 북미 소매(대)"
          stroke={RETAIL_COLOR}
          strokeWidth={2.5}
          dot={{ r: 3, fill: RETAIL_COLOR }}
          connectNulls={false}
          hide={isHidden('retailShifted')}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function RevenueRetailTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: RevenueVsRetailPoint }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  // 커스텀 tooltip이라 recharts `contentStyle`이 적용되지 않는다 → 표준 토큰을 직접 씌운다.
  return (
    <div className="rounded-md p-2" style={TOOLTIP_CONTENT_STYLE}>
      <div className="mb-1 font-semibold">{p.label}</div>
      <div>자사 매출: {fmt(p.revenueEok)} 억원</div>
      <div style={{ color: RETAIL_COLOR }}>
        스텔란티스 북미 소매: {p.retailShifted === null ? '—' : `${fmt(p.retailShifted)}대`}
      </div>
    </div>
  );
}
