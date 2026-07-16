'use client';

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
import type { MonthlyFlowPoint } from '@/lib/stellantis-forecast/types';
import { fmt, fmtSigned } from './format';
import { bandDomain } from './gapAxis';

/** 막대 2계열 — 대비를 위해 `MGMT_BAR_COLORS`를 벌려 쓴다(chart-guide §5-A). 차트 1과 같은 규칙. */
const PRODUCTION_COLOR = MGMT_BAR_COLORS[0];
const RETAIL_COLOR = MGMT_BAR_COLORS[2];

/** 재고 증감 꺾은선 — 파란 막대와 대비되어야 하므로 빨강 고정(chart-guide §5-A). */
const GAP_COLOR = '#dc2626';

/** 0선·중립 요소 색(chart-guide §5-A "중립·잔여는 회색"). */
const NEUTRAL_COLOR = '#9ca3af';

/**
 * 차트 2 — 월별 북미 생산 vs 소매 막대 + 갭(생산 − 소매) 꺾은선.
 *
 * 차트 1(분기 출하 기준)과 **의도적으로 같은 시각 문법**을 쓴다: 같은 막대색, 같은 빨간 갭 선,
 * 같은 이중축 밴드 분리. 두 차트가 같은 질문("재고가 쌓이는가")에 다른 소스로 답하므로
 * 형태가 같아야 눈으로 대조된다.
 *
 * 데이터 라벨을 달지 않는 이유: 월 77개 × 막대 2개 = 154개 라벨이라 6자리 숫자가 반드시 겹친다
 * (`InventoryAchievementChart`가 밀집 시 라벨을 끄는 것과 같은 판단). 값은 툴팁으로 제공한다.
 *
 * x축 라벨은 recharts 기본 `interval`(preserveEnd)에 맡긴다 — 월 수가 데이터 도착에 따라
 * 계속 늘어나므로 고정 interval을 박으면 언젠가 반드시 겹친다.
 */
export default function StellantisMonthlyFlowChartInner({
  points,
}: {
  points: MonthlyFlowPoint[];
}) {
  const h = useChartHeight(360, 440, 520);
  const { isHidden, toggle, hidden } = useHiddenSeries();

  if (points.length === 0) {
    return (
      <div className="py-12 text-center text-base text-muted-foreground">데이터가 없습니다.</div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={h}>
      <ComposedChart data={points} margin={{ top: 24, right: 24, bottom: 10, left: 10 }} barGap={1}>
        <CartesianGrid
          strokeDasharray="3 3"
          className="stroke-border"
          strokeOpacity={GRID_STROKE_OPACITY}
          vertical={false}
        />
        <XAxis dataKey="label" tick={{ fontSize: 12 }} minTickGap={16} />
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
        <Tooltip cursor={{ fill: 'var(--muted)', opacity: 0.3 }} content={<FlowTooltip />} />
        {/* 범례 순서는 막대 왼→오(생산·소매) 다음 꺾은선(갭) — chart-guide §7-7. */}
        <Legend
          verticalAlign="top"
          wrapperStyle={{ paddingBottom: 4 }}
          content={() => (
            <LegendRow
              items={[
                {
                  key: 'production',
                  label: '생산(북미 공장)',
                  shape: 'rect',
                  color: PRODUCTION_COLOR,
                },
                {
                  key: 'retail',
                  label: '소매 판매(북미 시장)',
                  shape: 'rect',
                  color: RETAIL_COLOR,
                },
                { key: 'gap', label: '재고 증감(생산−소매)', shape: 'line', color: GAP_COLOR },
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
        <Bar
          yAxisId="units"
          dataKey="production"
          name="생산(북미 공장)"
          fill={PRODUCTION_COLOR}
          hide={isHidden('production')}
        />
        <Bar
          yAxisId="units"
          dataKey="retail"
          name="소매 판매(북미 시장)"
          fill={RETAIL_COLOR}
          hide={isHidden('retail')}
        />
        <Line
          yAxisId="gap"
          type="monotone"
          dataKey="gap"
          name="재고 증감(생산−소매)"
          stroke={GAP_COLOR}
          strokeWidth={2}
          // 월 77개에 점을 찍으면 선이 구슬 목걸이가 된다 — hover 시 activeDot만 띄운다.
          dot={false}
          activeDot={{ r: 4, fill: GAP_COLOR }}
          hide={isHidden('gap')}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function FlowTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: MonthlyFlowPoint }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  // 커스텀 tooltip이라 recharts `contentStyle`이 적용되지 않는다 → 표준 토큰을 직접 씌운다.
  return (
    <div className="rounded-md p-2" style={TOOLTIP_CONTENT_STYLE}>
      <div className="mb-1 font-semibold">{p.label}</div>
      <div>생산(북미 공장): {fmt(p.production)}대</div>
      <div>소매 판매(북미 시장): {fmt(p.retail)}대</div>
      <div style={{ color: GAP_COLOR }}>
        재고 증감: {fmtSigned(p.gap)}대 ({p.gap > 0 ? '축적' : p.gap < 0 ? '소진' : '균형'})
      </div>
      <div className="text-muted-foreground">누적 재고 증감: {fmtSigned(p.cumGap)}대</div>
      <div className="mt-1 border-t border-border pt-1 text-muted-foreground">
        생산은 <b>공장이 있는 나라</b>, 소매는 <b>차가 팔린 나라</b> 기준이라 북미 밖 수출입이 갭에
        섞입니다. 절대 수준이 아니라 방향으로 읽으십시오.
      </div>
    </div>
  );
}
