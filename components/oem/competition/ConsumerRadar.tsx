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
import { useState } from 'react';
import { TOOLTIP_CONTENT_STYLE } from '@/components/charts/chartTheme';
import { LegendRow } from '@/components/charts/ChartLegend';
import { GRID_STROKE_OPACITY } from '@/components/oem-companies/common/chartStyle';
import { useChartHeight } from '@/lib/useChartHeight';
import { consumerAverage, consumerGap, evaluateMarket } from '@/lib/oem-competition/signals';
import { CONSUMER_AXES } from '@/lib/oem-competition/types';
import type { CompetitionMarket, ConsumerScore } from '@/lib/oem-competition/types';
import {
  ChartCard,
  EmptyChart,
  rivalDistinctColor,
  shortModel,
  SignalDot,
  TARGET_COLOR,
} from './shared';

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
 *
 * 색 규칙(사용자 지시 2026-08-14): 경쟁을 전부 회색 계열로 두면 대상만 도드라져 **비교가 안 된다**
 * — 경쟁끼리도 구별돼야 "어느 차가 어느 축에서 앞서는지"를 읽을 수 있다. 그래서 경쟁마다 고유색을
 * 주되 **면은 채우지 않는다**(면을 채우면 5종이 겹쳐 안쪽이 진흙이 된다). 채워진 면은 대상 하나뿐이라
 * 색이 늘어도 대상은 계속 눈에 띈다.
 */
function buildSeries(scores: ConsumerScore[]): RadarSeries[] {
  const target = scores.find((s) => s.is_target) ?? null;
  const rivals = scores.filter((s) => !s.is_target);

  const series: RadarSeries[] = [];
  if (target) {
    series.push({
      dataKey: 's0',
      label: shortModel(target.model),
      color: TARGET_COLOR,
      fillOpacity: 0.22,
      strokeWidth: 2.5,
      score: target,
    });
  }
  rivals.forEach((score, i) => {
    series.push({
      dataKey: `s${series.length}`,
      label: shortModel(score.model),
      color: rivalDistinctColor(i),
      // 선만 남긴다. 얇으면 색이 구분되지 않으므로 굵기는 대상 바로 아래까지 올린다.
      fillOpacity: 0,
      strokeWidth: 1.8,
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

export default function ConsumerRadar({
  market,
  noteDate,
}: {
  market: CompetitionMarket;
  noteDate?: string;
}) {
  const h = useChartHeight(280, 360, 440);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // 훅 뒤에서 분기해야 시장을 바꿔도 훅 호출 순서가 유지된다.
  const scores = market.consumerScores;
  const series = buildSeries(scores);

  // "지금 시점의 평가인가"라는 물음에 화면이 답해야 한다(사용자 질문 2026-08-14) — 이 점수는
  // 실시간 지표가 아니라 그 시점의 웹 근거로 AI 가 매긴 판정이라 평가일을 함께 못 박는다.
  const subtitle = `1~5점 · 3점이 동급 평균 · ${
    noteDate ? `${noteDate} 판정` : '판정일 미상'
  } · Claude Sonnet 5 · 범례 클릭으로 차종 숨김`;

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
          {/*
            기본 <Legend> 는 payload 를 제 순서대로 정렬해 **대상이 가운데로 밀린다**(2026-08-14
            화면 확인 — Jeep 이 3번째). 읽는 순서는 언제나 "대상 먼저"라 LegendRow 로 직접 통제한다
            (docs/chart-guide.md 규칙 7 과 같은 이유).
          */}
          <Legend
            verticalAlign="top"
            align="center"
            wrapperStyle={{ paddingBottom: 4 }}
            content={() => (
              <LegendRow
                items={series.map((s) => ({
                  key: s.dataKey,
                  label: s.label,
                  shape: 'line' as const,
                  color: s.color,
                }))}
                hidden={hidden}
                onToggle={toggle}
              />
            )}
          />
          {series.map((s) => (
            <Radar
              key={s.dataKey}
              dataKey={s.dataKey}
              name={s.label}
              hide={hidden.has(s.dataKey)}
              stroke={s.color}
              fill={s.color}
              fillOpacity={s.fillOpacity}
              strokeWidth={s.strokeWidth}
              // 선만 그리는 경쟁은 꼭짓점 점이 있어야 겹친 구간에서 어느 선인지 짚을 수 있다.
              dot={s.fillOpacity === 0 ? { r: 2.5, fill: s.color, strokeWidth: 0 } : false}
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
