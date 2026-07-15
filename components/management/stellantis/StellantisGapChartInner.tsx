'use client';

import {
  Bar,
  CartesianGrid,
  Cell,
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
import { hatchDefs, hatchFill } from './chartHatch';
import { fmt, fmtSigned } from './format';

/** 막대 2계열 — 대비를 위해 `MGMT_BAR_COLORS`를 벌려 쓴다(chart-guide §5-A). */
const SHIPMENTS_COLOR = MGMT_BAR_COLORS[0];
const RETAIL_COLOR = MGMT_BAR_COLORS[2];

/** 재고 증감 꺾은선 — 파란 막대와 대비되어야 하므로 빨강 고정(chart-guide §5-A). */
const GAP_COLOR = '#dc2626';

/** 0선·중립 요소 색(chart-guide §5-A "중립·잔여는 회색"). */
const NEUTRAL_COLOR = '#9ca3af';

/** 차분 도출 출하 막대에 씌울 빗금 패턴 id (문서 전역 유일해야 함). */
const DERIVED_HATCH_ID = 'stellantis-gap-derived-shipments';

/**
 * 꺾은선(재고 증감)이 차지할 plot 세로 밴드 — 아래에서부터의 비율.
 *
 * 막대 축이 `[0, max×2.5]`라 막대 top은 40%, 그 위 여유까지 약 48%다.
 * 그래서 선 밴드를 55%에서 시작해 두 그래프가 절대 겹치지 않게 한다(chart-guide §4-F 원칙).
 * 상단 95%는 dot·툴팁 커서가 잘리지 않게 남긴 여백.
 */
const LINE_BAND_BOTTOM = 0.55;
const LINE_BAND_TOP = 0.95;

/**
 * 재고 증감(gap) 축 domain.
 *
 * ⚠️ chart-guide §4-F의 표준 공식 `[-max×1.5, max×1.1]`을 **그대로 쓰지 않는 이유**:
 * 그 공식은 달성율·비율처럼 **0 이상 단일 부호 선**을 전제로 "0을 하단 58%에 두고 양수를 위로
 * 민다"는 계산이다. 반면 여기 gap(= 출하 − 소매)은 **재고 소진 국면에서 음수**가 된다.
 * 음수 값에 그 공식을 적용하면 선이 0 아래로 내려가 막대 밴드(하단 40%)와 겹쳐,
 * §4-F가 막으려던 판독성 문제가 그대로 재발한다.
 *
 * 그래서 **§4-F의 '이중축 영역 분리' 원칙은 지키되 공식만 일반화**한다:
 * gap의 실제 범위 [min, max](항상 0 포함)를 plot 상단 밴드 55~95%에 선형으로 사상한다.
 *  - 양수·음수가 모두 밴드 안에 들어오고, 0선은 밴드 내부의 제 위치에 자동으로 놓인다.
 *  - 단일 부호(min=0)면 결과가 `[-1.375×max, 1.125×max]`로 §4-F 공식과 사실상 동일해
 *    기존 콤보 차트(`PlanAchievementChart` 등)와 같은 인상을 준다. 즉 이 식은 §4-F의 상위집합이다.
 */
function gapDomain(points: GapPoint[]): [number, number] {
  const values = points.map((p) => p.gap);
  // 0을 항상 포함시켜 재고 축적/소진 기준선(ReferenceLine y=0)이 언제나 밴드 안에 보이게 한다.
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  // 전 구간 gap이 0인 엣지 케이스에서 span=0(0으로 나누기)이 되는 것을 막는다.
  const range = Math.max(max - min, 1);
  const span = range / (LINE_BAND_TOP - LINE_BAND_BOTTOM);
  const lo = max - LINE_BAND_TOP * span;
  return [lo, lo + span];
}

/**
 * 차트 1 — 북미 출하 vs 소매 막대 + 재고 증감(출하 − 소매) 꺾은선.
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
        {hatchDefs([{ id: DERIVED_HATCH_ID, color: SHIPMENTS_COLOR }])}
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
          domain={gapDomain(points)}
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
        <Bar
          yAxisId="units"
          dataKey="shipments"
          name="출하(도매)"
          fill={SHIPMENTS_COLOR}
          radius={[2, 2, 0, 0]}
          hide={isHidden('shipments')}
        >
          {/* 빗금 = 반기·연간 보도자료 차분 도출(±1,000대). 소매·재고 증감은 도출이 아니라
              출하 막대에만 적용한다(gap이 출하에서 파생되는 사실은 툴팁 문구로 밝힌다). */}
          {points.map((p) => (
            <Cell
              key={p.yearPeriod}
              fill={p.isDerived ? hatchFill(DERIVED_HATCH_ID) : SHIPMENTS_COLOR}
            />
          ))}
        </Bar>
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
          dot={{ r: 4, fill: GAP_COLOR }}
          hide={isHidden('gap')}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
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
      <div className="mb-1 font-semibold">{p.label}</div>
      <div>출하(도매): {fmt(p.shipments)}대</div>
      <div>소매 판매: {fmt(p.retail)}대</div>
      <div style={{ color: GAP_COLOR }}>
        재고 증감: {fmtSigned(p.gap)}대 ({p.gap > 0 ? '축적' : p.gap < 0 ? '소진' : '균형'})
      </div>
      <div className="text-muted-foreground">누적 재고 증감: {fmtSigned(p.cumGap)}대</div>
      {p.isDerived ? (
        <div className="mt-1 border-t border-border pt-1 text-muted-foreground">
          출하는 반기·연간 보도자료에서 <b>차분 도출</b>(±1,000대). 재고 증감도 같은 오차를
          물려받습니다.
        </div>
      ) : null}
    </div>
  );
}
