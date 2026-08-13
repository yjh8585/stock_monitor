'use client';

/**
 * 소비자 평가 5축 레이더 — 대상 차종과 경쟁 차종을 같은 오각형 위에 겹친다.
 *
 * 5축을 막대로 나열하면 "어느 축이 약한가"를 읽으려고 눈이 다섯 번 왕복해야 한다. 겹친 다각형은
 * 대상 면이 안으로 파인 방향 하나만 보면 되므로, 축별 우열 비교에는 레이더가 맞는다.
 * 단 면이 겹칠수록 뒤 도형이 가려지므로 대상만 채우고 경쟁은 윤곽선 위주로 그린다.
 */
import {
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { TOOLTIP_CONTENT_STYLE } from '@/components/charts/chartTheme';
import { GRID_STROKE_OPACITY } from '@/components/oem-companies/common/chartStyle';
import { useChartHeight } from '@/lib/useChartHeight';
import { consumerAverage, consumerGap, evaluateMarket } from '@/lib/oem-competition/signals';
import { CONSUMER_AXES } from '@/lib/oem-competition/types';
import type { CompetitionMarket, ConsumerScore } from '@/lib/oem-competition/types';
import { ChartCard, EmptyChart, rivalColor, shortModel, SignalDot, TARGET_COLOR } from './shared';

/** 레이더 다각형 1개. `score` 를 들고 다녀야 축 행을 만들 때 다시 찾지 않는다. */
interface RadarSeries {
  dataKey: string;
  label: string;
  color: string;
  fillOpacity: number;
  strokeWidth: number;
  score: ConsumerScore;
}

/** 축 하나(꼭짓점 하나)의 행. 시리즈 값은 합성 키로 들어간다. */
type RadarRow = { axis: string; [seriesKey: string]: string | number };

/**
 * dataKey 에 차종명을 쓰지 않는 이유: recharts 는 dataKey 문자열의 점(.)을 중첩 경로로 해석해
 * 'Mercedes E-Class 4.0' 같은 이름이 조용히 undefined 가 된다. 순서는 대상 → 경쟁으로 고정한다.
 */
function buildSeries(scores: ConsumerScore[]): RadarSeries[] {
  const target = scores.find((s) => s.is_target) ?? null;
  const rivals = scores.filter((s) => !s.is_target);

  // 경쟁이 3종이면 면끼리 겹쳐 대상 영역을 덮어 버린다. 그 구간부터는 면을 거의 지우고 선만 남긴다.
  const rivalFill = rivals.length >= 3 ? 0.04 : 0.08;

  const series: RadarSeries[] = [];
  if (target) {
    series.push({
      dataKey: 's0',
      label: shortModel(target.model),
      color: TARGET_COLOR,
      fillOpacity: 0.25,
      strokeWidth: 2,
      score: target,
    });
  }
  rivals.forEach((score, i) => {
    series.push({
      dataKey: `s${series.length}`,
      label: shortModel(score.model),
      color: rivalColor(i),
      fillOpacity: rivalFill,
      strokeWidth: 1.2,
      score,
    });
  });
  return series;
}

function buildRows(series: RadarSeries[]): RadarRow[] {
  return CONSUMER_AXES.map((axis) => {
    const row: RadarRow = { axis: axis.label };
    for (const s of series) row[s.dataKey] = s.score[axis.key];
    return row;
  });
}

/** "대상 3.2점 · 경쟁 평균 3.7점 (-0.5점)" — 세 값이 다 있을 때만 격차까지 붙인다. */
function summaryText(scores: ConsumerScore[]): string {
  const target = scores.find((s) => s.is_target);
  const rivals = scores.filter((s) => !s.is_target);
  if (!target) return '대상 차종 점수 미수집';

  const targetText = `대상 ${consumerAverage(target).toFixed(1)}점`;
  if (rivals.length === 0) return `${targetText} · 경쟁 점수가 없어 비교 불가`;

  const rivalAvg = rivals.reduce((acc, r) => acc + consumerAverage(r), 0) / rivals.length;
  const gap = consumerGap(scores);
  const gapText = gap === null ? '' : ` (${gap > 0 ? '+' : ''}${gap.toFixed(1)}점)`;
  return `${targetText} · 경쟁 평균 ${rivalAvg.toFixed(1)}점${gapText}`;
}

export default function ConsumerRadar({ market }: { market: CompetitionMarket }) {
  const h = useChartHeight(280, 360, 440);

  // 훅 뒤에서 분기해야 시장을 바꿔도 훅 호출 순서가 유지된다.
  const scores = market.consumerScores;
  const series = buildSeries(scores);

  const subtitle = '1~5점 · 3점이 동급 평균 · Claude Sonnet 5 판정';

  if (series.length === 0) {
    return (
      <ChartCard title="소비자 평가 5축" subtitle={subtitle}>
        <EmptyChart reason="소비자 평가 점수 미수집" />
      </ChartCard>
    );
  }

  const rows = buildRows(series);
  // 임계값 판정은 signals.ts 가 정본이라 여기서 다시 계산하지 않는다.
  const consumerSignal = evaluateMarket(market).find((r) => r.key === 'consumer') ?? null;

  return (
    <ChartCard title="소비자 평가 5축" subtitle={subtitle}>
      <ResponsiveContainer width="100%" height={h}>
        <RadarChart
          data={rows}
          outerRadius="70%"
          margin={{ top: 8, right: 24, bottom: 8, left: 24 }}
        >
          <PolarGrid
            className="stroke-border"
            strokeOpacity={GRID_STROKE_OPACITY}
            gridType="polygon"
          />
          <PolarAngleAxis
            dataKey="axis"
            tick={{ fontSize: 14, fill: 'var(--muted-foreground)' }}
            stroke="var(--border)"
          />
          {/* 1~5점이라 자동 스케일을 두면 0.3점 차이가 화면 절반으로 부풀어 보인다. */}
          <PolarRadiusAxis
            type="number"
            domain={[0, 5]}
            tickCount={6}
            angle={30}
            tick={{ fontSize: 14, fill: 'var(--muted-foreground)' }}
            stroke="var(--border)"
          />
          <Tooltip
            formatter={(v, name) => [`${Number(v).toFixed(1)}점`, name]}
            contentStyle={TOOLTIP_CONTENT_STYLE}
          />
          {/* 범례·툴팁 순서를 대상 먼저로 두려고 값 정렬(itemSorter)을 쓰지 않는다. */}
          <Legend
            verticalAlign="top"
            align="center"
            wrapperStyle={{ fontSize: '14px', paddingBottom: 4 }}
          />
          {series.map((s) => (
            <Radar
              key={s.dataKey}
              dataKey={s.dataKey}
              name={s.label}
              stroke={s.color}
              fill={s.color}
              fillOpacity={s.fillOpacity}
              strokeWidth={s.strokeWidth}
              dot={false}
            />
          ))}
        </RadarChart>
      </ResponsiveContainer>
      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <SignalDot signal={consumerSignal?.signal ?? null} size={8} title={consumerSignal?.hint} />
        <span className="tabular-nums">{summaryText(scores)}</span>
      </div>
    </ChartCard>
  );
}
