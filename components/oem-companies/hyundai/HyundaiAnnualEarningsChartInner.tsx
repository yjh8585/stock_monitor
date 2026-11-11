'use client';

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TOOLTIP_CONTENT_STYLE_SM } from '@/components/charts/chartTheme';
import { bandDomain } from '@/components/management/stellantis/gapAxis';
import { useChartHeight } from '@/lib/useChartHeight';
import type { CustomerEarningsPoint } from '@/lib/customers/types';
import type { HyundaiAnnualEarningsPoint } from '@/lib/types';
import {
  DATA_LABEL_STYLE,
  fmtMarginLabel,
  GRID_STROKE_OPACITY,
  MARGIN_LABEL_STYLE,
  Y_AXIS_PADDED_DOMAIN,
} from '../common/chartStyle';
import { revenueFormat } from '../common/revenueFormat';
import { useHiddenSeries } from '../common/useHiddenSeries';

interface Props {
  data: HyundaiAnnualEarningsPoint[] | CustomerEarningsPoint[];
  /** 매출 막대 칸 — 현대 IR = revenue_krw_bn, 고객사(financials) = revenue_bn. 둘 다 십억 단위. */
  revenueKey?: 'revenue_krw_bn' | 'revenue_bn';
  /** 매출 표기 통화(기본 KRW = 조원 표기). */
  currency?: string;
  /** 영업이익률 축을 음수까지 연다(적자 회사). 기본 false = 0 부터. */
  allowNegativeMargin?: boolean;
  /** 영업이익률 점 위에 숫자(소수 1자리 %)를 표시한다. 기본 false — OEM 현대 탭은 그대로. */
  showMarginLabels?: boolean;
}

function fmtOpmTick(n: number): string {
  return `${n.toFixed(1)}%`;
}

/** 음수 마진 갈래의 막대 축 — 상한을 max×2.5 로 늘려 막대를 plot 하단 ~40% 로 압축(chart-guide §4-F). */
const BAR_BAND_DOMAIN: [number, (max: number) => number] = [0, (max) => Math.max(max * 2.5, 1)];

/** 화면에 그려지는 영업이익률 값만 — null·NaN 은 bandDomain 의 min/max 를 망가뜨려 거른다. */
function marginValues(
  rows: readonly (HyundaiAnnualEarningsPoint | CustomerEarningsPoint)[]
): number[] {
  return rows
    .map((r) => r.operating_margin_pct)
    .filter((v): v is number => v != null && Number.isFinite(v));
}

/** 연간 실적 ComposedChart — 분기 합산(YTD 포함) + 가중평균 opm. */
export default function HyundaiAnnualEarningsChartInner({
  data,
  revenueKey = 'revenue_krw_bn',
  currency = 'KRW',
  allowNegativeMargin = false,
  showMarginLabels = false,
}: Props) {
  const fmt = revenueFormat(currency);
  // 배열 유니온(A[] | B[])은 ComposedChart 제네릭이 못 받아 원소 유니온 배열로 넓힌다(캐스트 아님).
  const rows: readonly (HyundaiAnnualEarningsPoint | CustomerEarningsPoint)[] = data;
  const height = useChartHeight(260, 300, 340);
  const { isHidden, legendProps } = useHiddenSeries();

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={{ top: 32, right: 24, bottom: 10, left: 10 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          className="stroke-border"
          strokeOpacity={GRID_STROKE_OPACITY}
          vertical={false}
        />
        <XAxis
          dataKey="period_label"
          className="text-sm"
          tick={{ fontSize: 13 }}
          interval="preserveStartEnd"
          minTickGap={10}
        />
        <YAxis
          yAxisId="left"
          tickFormatter={fmt.tick}
          className="text-sm"
          width={50}
          // 음수 마진 갈래만 §4-F 하단 밴드로 압축. 기본 갈래는 기존 축 그대로.
          domain={allowNegativeMargin ? BAR_BAND_DOMAIN : Y_AXIS_PADDED_DOMAIN}
          label={{ value: fmt.axisLabel, angle: -90, position: 'insideLeft', fontSize: 11 }}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tickFormatter={fmtOpmTick}
          className="text-sm"
          width={50}
          // 음수 마진 갈래: 0 을 품은 [min, max] 를 상단 밴드(55~95%)에 사상해 막대와 겹치지 않게 한다.
          domain={allowNegativeMargin ? bandDomain(marginValues(rows)) : [0, 'auto']}
          label={{ value: '영업이익률(%)', angle: 90, position: 'insideRight', fontSize: 11 }}
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)' }}
          contentStyle={TOOLTIP_CONTENT_STYLE_SM}
          formatter={(value, name, item) => {
            if (value == null) return ['—', String(name)];
            const v = Number(value);
            // 고객사 점(CustomerEarningsPoint)엔 YTD 칸이 없어 접미사가 빈 문자열이 된다.
            const payload = item?.payload as
              | { is_ytd?: boolean; quarters_used?: number }
              | undefined;
            const ytdSuffix = payload?.is_ytd ? ` (YTD: ${payload.quarters_used}분기)` : '';
            if (name === '매출') return [`${fmt.tooltip(v)}${ytdSuffix}`, '매출'];
            if (name === '영업이익률') {
              return [`${v.toFixed(2)}%${ytdSuffix}`, '영업이익률'];
            }
            return [`${v.toLocaleString('ko-KR')}`, String(name)];
          }}
        />
        <Legend
          layout="horizontal"
          verticalAlign="top"
          align="center"
          wrapperStyle={{ fontSize: '14px', paddingBottom: 8 }}
          {...legendProps}
        />
        {/* 흑자·적자 경계선. bandDomain 이 0 을 항상 품으므로 반드시 보인다 — 범례로 영업이익률을 숨기면 같이 숨긴다. */}
        {allowNegativeMargin && !isHidden('operating_margin_pct') && (
          <ReferenceLine yAxisId="right" y={0} stroke="#9ca3af" strokeDasharray="4 4" />
        )}
        <Bar
          yAxisId="left"
          dataKey={revenueKey}
          name="매출"
          fill="#2563eb"
          isAnimationActive={false}
          radius={[3, 3, 0, 0]}
          hide={isHidden(revenueKey)}
        >
          <LabelList
            dataKey={revenueKey}
            position="top"
            formatter={fmt.label}
            style={DATA_LABEL_STYLE}
          />
        </Bar>
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="operating_margin_pct"
          name="영업이익률"
          stroke="#dc2626"
          strokeWidth={2}
          dot={{ r: 3, fill: '#dc2626' }}
          isAnimationActive={false}
          connectNulls
          hide={isHidden('operating_margin_pct')}
        >
          {showMarginLabels && (
            <LabelList
              dataKey="operating_margin_pct"
              position="top"
              formatter={fmtMarginLabel}
              style={MARGIN_LABEL_STYLE}
            />
          )}
        </Line>
      </ComposedChart>
    </ResponsiveContainer>
  );
}
