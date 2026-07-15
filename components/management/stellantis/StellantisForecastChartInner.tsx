'use client';

import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { LegendRow } from '@/components/charts/ChartLegend';
import { TOOLTIP_CONTENT_STYLE } from '@/components/charts/chartTheme';
import {
  GRID_STROKE_OPACITY,
  MGMT_DATA_LABEL_STYLE,
  Y_AXIS_PADDED_DOMAIN,
} from '@/components/oem-companies/common/chartStyle';
import { useHiddenSeries } from '@/components/oem-companies/common/useHiddenSeries';
import { useChartHeight } from '@/lib/useChartHeight';
import { useIsMobile } from '@/lib/useIsMobile';
import type { ForecastSeries } from '@/lib/stellantis-forecast/types';
import { hatchDefs, hatchFill } from './chartHatch';
import { fmt } from './format';
import { ACTUAL_COLOR, scenarioColor, scenarioHatchId } from './scenarioStyle';

/**
 * 화면에 남길 실적 분기 수.
 *
 * 8분기 = 2년 → 계절성 2주기를 볼 수 있으면서, 전망 4분기(분기당 시나리오 막대 3개)와 합쳐도
 * 카테고리 12개라 막대가 뭉개지지 않는 최대치. 전 구간(18분기)을 그리면 전망 구간이 오른쪽 끝에
 * 눌려 정작 이 차트의 주제가 안 보인다. 잘린 과거 실적은 차트 2에서 월 단위로 전부 볼 수 있다.
 */
const RECENT_ACTUAL_QUARTERS = 8;

const ACTUAL_KEY = 'actual';

interface ForecastBarRow {
  label: string;
  actual?: number;
  inventoryHold?: number;
  inventoryNormalize?: number;
  trendContinue?: number;
}

/**
 * 실적 + 전망을 한 카테고리 축에 병합.
 *
 * 실적 분기 행에는 `actual`만, 전망 분기 행에는 시나리오 키만 채운다 — 값이 없는 시리즈는
 * recharts가 막대를 그리지 않으므로 "실적 구간 / 전망 구간"이 자연히 갈린다.
 */
function buildRows(forecast: ForecastSeries): ForecastBarRow[] {
  const actualRows: ForecastBarRow[] = forecast.actual
    .slice(-RECENT_ACTUAL_QUARTERS)
    .map((a) => ({ label: a.label, actual: a.revenueEok }));

  const forecastRows = new Map<string, ForecastBarRow>();
  for (const scenario of forecast.scenarios) {
    for (const point of scenario.points) {
      const row = forecastRows.get(point.label) ?? { label: point.label };
      row[scenario.key] = point.revenueEok;
      forecastRows.set(point.label, row);
    }
  }
  // 시나리오 points가 시간 오름차순이라 Map 삽입 순서 = 분기 순서.
  return [...actualRows, ...forecastRows.values()];
}

/**
 * 차트 4 — 자사 매출 실적 + 전망 시나리오 3종 (억원).
 *
 * 전망 막대는 **빗금**으로 실적과 구분한다(색을 바꾸면 경영관리 파란 계열 규칙이 깨진다).
 * 데이터 라벨은 실적 막대에만 단다 — 전망 분기는 한 칸에 막대 3개라 16px 라벨이 서로 겹친다.
 * 시나리오 값은 툴팁으로, 가정 문장은 차트 아래 목록으로 제공한다.
 */
export default function StellantisForecastChartInner({ forecast }: { forecast: ForecastSeries }) {
  const h = useChartHeight(280, 360, 440);
  const isMobile = useIsMobile();
  const { isHidden, toggle, hidden } = useHiddenSeries();
  const rows = useMemo(() => buildRows(forecast), [forecast]);

  if (rows.length === 0) {
    return (
      <div className="py-12 text-center text-base text-muted-foreground">데이터가 없습니다.</div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={rows} margin={{ top: 28, right: 24, bottom: 10, left: 10 }} barGap={2}>
        {hatchDefs(
          forecast.scenarios.map((s, i) => ({
            id: scenarioHatchId(s.key),
            color: scenarioColor(i),
          }))
        )}
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
          width={70}
          domain={Y_AXIS_PADDED_DOMAIN}
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
          contentStyle={TOOLTIP_CONTENT_STYLE}
          formatter={(value: unknown) => (typeof value === 'number' ? `${fmt(value)} 억원` : '—')}
        />
        {/* 막대 왼→오 순서로 범례 고정 — chart-guide §7-7. */}
        <Legend
          verticalAlign="top"
          wrapperStyle={{ paddingBottom: 4 }}
          content={() => (
            <LegendRow
              items={[
                { key: ACTUAL_KEY, label: '실적', shape: 'rect', color: ACTUAL_COLOR },
                ...forecast.scenarios.map((s, i) => ({
                  key: s.key,
                  label: `전망 · ${s.label}`,
                  shape: 'rect' as const,
                  color: scenarioColor(i),
                })),
              ]}
              hidden={hidden}
              onToggle={toggle}
            />
          )}
        />
        <Bar
          dataKey={ACTUAL_KEY}
          name="실적"
          fill={ACTUAL_COLOR}
          radius={[3, 3, 0, 0]}
          hide={isHidden(ACTUAL_KEY)}
        >
          {!isMobile && (
            <LabelList
              dataKey={ACTUAL_KEY}
              position="top"
              formatter={(value: unknown) => (typeof value === 'number' ? fmt(value) : '')}
              style={MGMT_DATA_LABEL_STYLE}
            />
          )}
        </Bar>
        {forecast.scenarios.map((s) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={`전망 · ${s.label}`}
            fill={hatchFill(scenarioHatchId(s.key))}
            radius={[3, 3, 0, 0]}
            hide={isHidden(s.key)}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
