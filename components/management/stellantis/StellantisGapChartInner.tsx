'use client';

import type { ReactElement } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
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
import type { GapPoint } from '@/lib/stellantis-forecast/types';
import { fmt, fmtSigned } from './format';
import { bandDomain } from './gapAxis';

/** 막대 2계열 — 대비를 위해 `MGMT_BAR_COLORS`를 벌려 쓴다(chart-guide §5-A). */
const SHIPMENTS_COLOR = MGMT_BAR_COLORS[0];
const RETAIL_COLOR = MGMT_BAR_COLORS[2];

/** 재고 증감 꺾은선 — 파란 막대와 대비되어야 하므로 빨강 고정(chart-guide §5-A). */
const GAP_COLOR = '#dc2626';

/** 0선·중립 요소 색(chart-guide §5-A "중립·잔여는 회색"). */
const NEUTRAL_COLOR = '#9ca3af';

/**
 * 차트 1 — 분기 북미 출하 vs 소매 막대 + 재고 증감(출하 − 소매) 꺾은선.
 *
 * 차트 2(월별 생산 기준)와 **의도적으로 같은 시각 문법**을 쓴다: 같은 막대색, 같은 빨간 갭 선,
 * 같은 이중축 밴드(`gapAxis.ts`). 두 차트가 같은 질문("재고가 쌓이는가")에 다른 소스로 답하므로
 * 형태가 같아야 눈으로 대조된다.
 *
 * 데이터 라벨을 달지 않는 이유: 분기 20개 × 막대 2개 = 40개 라벨이라 6자리 숫자가 반드시 겹친다
 * (`InventoryAchievementChart`가 밀집 시 라벨을 끄는 것과 같은 판단). 값은 툴팁으로 제공한다.
 */
export default function StellantisGapChartInner({ points }: { points: GapPoint[] }) {
  const h = useChartHeight(360, 440, 520);
  const { isHidden, toggle, hidden } = useHiddenSeries();

  if (points.length === 0) {
    return (
      <div className="py-12 text-center text-base text-muted-foreground">데이터가 없습니다.</div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={h}>
      <ComposedChart data={points} margin={{ top: 24, right: 24, bottom: 10, left: 10 }} barGap={2}>
        <CartesianGrid
          strokeDasharray="3 3"
          className="stroke-border"
          strokeOpacity={GRID_STROKE_OPACITY}
          vertical={false}
        />
        <XAxis dataKey="label" tick={{ fontSize: 13 }} />
        <YAxis
          yAxisId="units"
          tickFormatter={(v: number) => fmt(v)}
          tick={{ fontSize: 13 }}
          width={80}
          // 막대는 plot 하단 ~40%로 압축 — 꺾은선과 시각 분리(chart-guide §4-F).
          domain={[0, (max: number) => Math.max(max * 2.5, 1)]}
        />
        <YAxis
          yAxisId="gap"
          orientation="right"
          tickFormatter={(v: number) => fmt(v)}
          tick={{ fontSize: 13 }}
          width={80}
          domain={bandDomain(points.map((p) => p.gap))}
        />
        <Tooltip cursor={{ fill: 'var(--muted)', opacity: 0.3 }} content={<GapTooltip />} />
        {/* 범례 순서는 막대 왼→오(출하·소매) 다음 꺾은선(재고 증감) — chart-guide §7-7.
            recharts 기본 범례는 데이터 키 순서를 따라가 막대 순서와 어긋날 수 있다. */}
        <Legend
          verticalAlign="top"
          wrapperStyle={{ paddingBottom: 4 }}
          content={() => (
            <LegendRow
              items={[
                { key: 'shipments', label: '출하(도매)', shape: 'rect', color: SHIPMENTS_COLOR },
                { key: 'retail', label: '소매 판매', shape: 'rect', color: RETAIL_COLOR },
                { key: 'gap', label: '재고 증감(출하−소매)', shape: 'line', color: GAP_COLOR },
              ]}
              hidden={hidden}
              onToggle={toggle}
            />
          )}
        />
        {/* 재고 축적(위)/소진(아래) 기준선. gap 축 domain이 0을 항상 품으므로 반드시 보인다. */}
        <ReferenceLine
          yAxisId="gap"
          y={0}
          stroke={NEUTRAL_COLOR}
          strokeDasharray="4 4"
          label={{
            value: '↑ 재고 축적 · ↓ 재고 소진',
            position: 'insideTopLeft',
            fill: NEUTRAL_COLOR,
            fontSize: 13,
          }}
        />
        {/* 막대는 실측·차분 도출·추정을 색으로 구분하지 않는다(사용자 지시 2026-07-17) —
            차분 도출 분기·추정 분기는 아래 보조문구 + 툴팁으로 안내한다. 추정 최신 분기만
            갭 선의 속 빈 점으로 위치를 표시한다. */}
        <Bar
          yAxisId="units"
          dataKey="shipments"
          name="출하(도매)"
          fill={SHIPMENTS_COLOR}
          radius={[2, 2, 0, 0]}
          hide={isHidden('shipments')}
        />
        <Bar
          yAxisId="units"
          dataKey="retail"
          name="소매 판매"
          fill={RETAIL_COLOR}
          radius={[2, 2, 0, 0]}
          hide={isHidden('retail')}
        />
        <Line
          yAxisId="gap"
          type="monotone"
          dataKey="gap"
          name="재고 증감(출하−소매)"
          stroke={GAP_COLOR}
          strokeWidth={2.5}
          dot={<GapDot />}
          hide={isHidden('gap')}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/**
 * 재고 증감 꺾은선의 점. 추정 포함 분기는 **속 빈 점**(흰 채움 + 빨간 테두리)으로 구분한다 —
 * 실측 점(꽉 찬 빨강)과 눈으로 갈린다.
 */
function GapDot(props: {
  cx?: number;
  cy?: number;
  payload?: GapPoint;
  index?: number;
}): ReactElement | null {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined) return null;
  if (payload?.isEstimated) {
    return (
      <circle cx={cx} cy={cy} r={4} fill="var(--card, #fff)" stroke={GAP_COLOR} strokeWidth={2} />
    );
  }
  return <circle cx={cx} cy={cy} r={4} fill={GAP_COLOR} />;
}

function GapTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: GapPoint }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  // 커스텀 tooltip이라 recharts `contentStyle`이 적용되지 않는다 → 표준 토큰을 직접 씌운다.
  return (
    <div className="rounded-md p-2" style={TOOLTIP_CONTENT_STYLE}>
      <div className="mb-1 font-semibold">
        {p.label}
        {p.isEstimated ? ' (추정 포함)' : ''}
      </div>
      <div>출하(도매): {fmt(p.shipments)}대</div>
      <div>
        소매 판매: {fmt(p.retail)}대{p.isEstimated ? ' (일부 추정)' : ''}
      </div>
      <div style={{ color: GAP_COLOR }}>
        재고 증감: {fmtSigned(p.gap)}대 ({p.gap > 0 ? '축적' : p.gap < 0 ? '소진' : '균형'})
      </div>
      <div className="text-muted-foreground">누적 재고 증감: {fmtSigned(p.cumGap)}대</div>
      {p.isEstimated ? (
        <div className="mt-1 border-t border-border pt-1 text-muted-foreground">
          소매 일부가 <b>추정치</b>(빠진 국가·월을 전년 동월 × 최근 YoY로 추정). 출하는 IR 공식
          절대값입니다. 통계·진단에는 이 분기를 넣지 않습니다.
        </div>
      ) : p.isDerived ? (
        <div className="mt-1 border-t border-border pt-1 text-muted-foreground">
          출하는 반기·연간 보도자료에서 <b>차분 도출</b>(±1,000대). 재고 증감도 같은 오차를
          물려받습니다.
        </div>
      ) : null}
    </div>
  );
}
