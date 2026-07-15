'use client';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { LegendRow } from '@/components/charts/ChartLegend';
import { TOOLTIP_CONTENT_STYLE } from '@/components/charts/chartTheme';
import {
  GRID_STROKE_OPACITY,
  Y_AXIS_PADDED_DOMAIN,
} from '@/components/oem-companies/common/chartStyle';
import { useHiddenSeries } from '@/components/oem-companies/common/useHiddenSeries';
import { useChartHeight } from '@/lib/useChartHeight';
import type { UnitRevenueSeries } from '@/lib/stellantis-forecast/types';
import { fmt } from './format';

/** 원단위 꺾은선 — 원/대는 파생 비율 지표라 강조 라인 색 `#dc2626`(chart-guide §5-A). */
const UNIT_COLOR = '#dc2626';

/** 평균선 — 기준·중립 요소라 회색(chart-guide §5-A "중립·잔여는 회색"). */
const MEAN_COLOR = '#9ca3af';

/**
 * 차트 3 — 대당 매출 원단위(자사 매출 ÷ 북미 출하) 추이 + 평균선.
 *
 * Y축을 0부터 시작(`Y_AXIS_PADDED_DOMAIN`)하는 이유: 이 차트의 목적은 "원단위가 **평평한가**"를
 * 보는 것이다. 데이터 min~max로 축을 좁히면 작은 흔들림이 절벽처럼 과장돼 안정성 판단을 그르친다.
 * 0 기준이면 평균선에 붙어 평평한 선 = 안정으로 정직하게 읽힌다.
 */
export default function StellantisUnitRevenueChartInner({ series }: { series: UnitRevenueSeries }) {
  const h = useChartHeight(280, 360, 440);
  const { isHidden, toggle, hidden } = useHiddenSeries();

  if (series.points.length === 0) {
    return (
      <div className="py-12 text-center text-base text-muted-foreground">데이터가 없습니다.</div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={h}>
      <LineChart data={series.points} margin={{ top: 24, right: 24, bottom: 10, left: 10 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          className="stroke-border"
          strokeOpacity={GRID_STROKE_OPACITY}
          vertical={false}
        />
        <XAxis dataKey="label" tick={{ fontSize: 13 }} />
        <YAxis
          tickFormatter={(v: number) => fmt(v)}
          tick={{ fontSize: 13 }}
          width={90}
          domain={Y_AXIS_PADDED_DOMAIN}
        />
        <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<UnitRevenueTooltip />} />
        <Legend
          verticalAlign="top"
          wrapperStyle={{ paddingBottom: 4 }}
          content={() => (
            <LegendRow
              items={[
                { key: 'wonPerUnit', label: '대당 매출(원)', shape: 'line', color: UNIT_COLOR },
                {
                  key: 'mean',
                  label: `평균 ${fmt(series.mean)}원`,
                  shape: 'line',
                  color: MEAN_COLOR,
                },
              ]}
              hidden={hidden}
              onToggle={toggle}
            />
          )}
        />
        {!isHidden('mean') ? (
          <ReferenceLine
            y={series.mean}
            stroke={MEAN_COLOR}
            strokeDasharray="6 4"
            strokeWidth={1.5}
            label={{
              value: `평균 ${fmt(series.mean)}원`,
              position: 'insideTopRight',
              fill: MEAN_COLOR,
              fontSize: 13,
            }}
          />
        ) : null}
        <Line
          type="monotone"
          dataKey="wonPerUnit"
          name="대당 매출(원)"
          stroke={UNIT_COLOR}
          strokeWidth={2.5}
          dot={{ r: 4, fill: UNIT_COLOR }}
          hide={isHidden('wonPerUnit')}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function UnitRevenueTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { label: string; wonPerUnit: number } }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  // 커스텀 tooltip이라 recharts `contentStyle`이 적용되지 않는다 → 표준 토큰을 직접 씌운다.
  return (
    <div className="rounded-md p-2" style={TOOLTIP_CONTENT_STYLE}>
      <div className="mb-1 font-semibold">{p.label}</div>
      <div style={{ color: UNIT_COLOR }}>대당 매출: {fmt(p.wonPerUnit)}원</div>
    </div>
  );
}
