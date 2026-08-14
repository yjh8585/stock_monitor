'use client';

/**
 * 소비자 평가 5축 — 차종마다 **오각형 하나씩** 따로 그린다(small multiples).
 *
 * 처음에는 한 오각형에 4종을 겹쳐 그렸는데, 겹친 선이 서로를 가려 "어느 축이 약한가"를 읽을 수
 * 없었다(사용자 지적 2026-08-14: *"한 차트에 4개 회사가 있으니까 여전히 잘 안보이네"*). 색을
 * 고유색으로 바꾸는 것만으로는 해결되지 않는다 — 5축 × 4종 = 선 20개가 같은 좁은 면에 얹히기
 * 때문이다.
 *
 * 대신 패널을 쪼개되 **모든 패널에 같은 회색 점선(비교군 평균)을 깔아** 비교 기준을 남긴다.
 * 이것이 small multiples 의 핵심이다 — 패널끼리 눈을 옮겨도 기준 도형이 같으므로 "평균 밖으로
 * 얼마나 나갔나"를 그대로 견줄 수 있다. 기준을 빼면 패널이 서로 무관한 그림 4장이 된다.
 */
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { TOOLTIP_CONTENT_STYLE } from '@/components/charts/chartTheme';
import { LegendRow } from '@/components/charts/ChartLegend';
import { GRID_STROKE_OPACITY } from '@/components/oem-companies/common/chartStyle';
import { useHiddenSeries } from '@/components/oem-companies/common/useHiddenSeries';
import { useChartHeight } from '@/lib/useChartHeight';
import { consumerAverage, consumerGap, evaluateMarket } from '@/lib/oem-competition/signals';
import { CONSUMER_AXES } from '@/lib/oem-competition/types';
import type {
  CompetitionMarket,
  ConsumerAxisKey,
  ConsumerScore,
} from '@/lib/oem-competition/types';
import {
  ChartCard,
  DeltaText,
  EmptyChart,
  rivalDistinctColor,
  shortModel,
  SignalDot,
  TARGET_COLOR,
} from './shared';

/**
 * 패널이 좁아 축 라벨을 전체 이름으로 쓰면 이웃 라벨과 붙는다. 짧은 이름을 쓰고 뜻은 카드 아래
 * 한 줄로 밝힌다(툴팁에는 전체 이름이 나온다).
 */
const AXIS_SHORT: Record<ConsumerAxisKey, string> = {
  design: '상품성',
  price: '가격',
  quality: '품질',
  efficiency: '연비',
  brand: '브랜드',
};

/** 비교군 평균 도형의 색 — 어느 차종의 색과도 겹치지 않아야 "기준"으로 읽힌다. */
const AVG_COLOR = 'var(--muted-foreground)';

interface Panel {
  key: string;
  label: string;
  color: string;
  score: ConsumerScore;
  avg: number;
  /** 비교군 평균 대비 총평균 격차(점). 양수면 평균보다 낫다. */
  gap: number;
}

/** 축별 평균 — **표시 여부와 무관하게 전 차종**으로 낸다(범례를 눌러도 기준이 흔들리지 않게). */
function axisAverages(scores: ConsumerScore[]): Record<ConsumerAxisKey, number> {
  const out = {} as Record<ConsumerAxisKey, number>;
  for (const axis of CONSUMER_AXES) {
    out[axis.key] = scores.reduce((acc, s) => acc + s[axis.key], 0) / scores.length;
  }
  return out;
}

/** 대상이 먼저, 그다음 경쟁. 색은 라인 차트와 같은 고유색 팔레트를 쓴다. */
function buildPanels(scores: ConsumerScore[]): Panel[] {
  const overall =
    scores.reduce((acc, s) => acc + consumerAverage(s), 0) / Math.max(scores.length, 1);
  const ordered = [...scores.filter((s) => s.is_target), ...scores.filter((s) => !s.is_target)];
  let rivalIndex = 0;
  return ordered.map((score, i) => ({
    key: `p${i}`,
    label: shortModel(score.model),
    color: score.is_target ? TARGET_COLOR : rivalDistinctColor(rivalIndex++),
    score,
    avg: consumerAverage(score),
    gap: consumerAverage(score) - overall,
  }));
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

/** 패널 1개 = 오각형 1개. 기준(평균)을 먼저 깔고 그 위에 해당 차종을 얹는다. */
function RadarPanel({
  panel,
  averages,
  height,
  isTarget,
}: {
  panel: Panel;
  averages: Record<ConsumerAxisKey, number>;
  height: number;
  isTarget: boolean;
}) {
  const rows = CONSUMER_AXES.map((axis) => ({
    axis: AXIS_SHORT[axis.key],
    full: axis.label,
    self: panel.score[axis.key],
    avg: Number(averages[axis.key].toFixed(2)),
  }));

  return (
    <div className="rounded-md border border-border/70 px-2 pt-2 pb-1">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: panel.color }}
          />
          <span
            className={`truncate text-sm ${isTarget ? 'font-semibold' : ''}`}
            style={isTarget ? { color: panel.color } : undefined}
            title={panel.score.model}
          >
            {panel.label}
          </span>
          {isTarget && (
            <span className="shrink-0 rounded border border-border px-1 text-[10px] text-muted-foreground">
              대상
            </span>
          )}
        </div>
        <div className="shrink-0 text-xs tabular-nums">
          <span className="font-medium">{panel.avg.toFixed(1)}점</span>{' '}
          <DeltaText
            value={panel.gap}
            text={`평균 ${panel.gap > 0 ? '+' : ''}${panel.gap.toFixed(1)}`}
            className="text-[11px]"
          />
        </div>
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <RadarChart
          data={rows}
          outerRadius="75%"
          margin={{ top: 6, right: 26, bottom: 6, left: 26 }}
        >
          <PolarGrid
            className="stroke-border"
            strokeOpacity={GRID_STROKE_OPACITY}
            gridType="polygon"
          />
          <PolarAngleAxis
            dataKey="axis"
            tick={{ fontSize: 13, fill: 'var(--muted-foreground)' }}
            stroke="var(--border)"
          />
          {/* 1~5점이라 자동 스케일을 두면 0.3점 차이가 화면 절반으로 부풀어 보인다.
              눈금 숫자는 좁은 패널에서 도형과 겹치기만 해서 끄고, 링 6개가 0~5점을 나타낸다. */}
          <PolarRadiusAxis
            type="number"
            domain={[0, 5]}
            tickCount={6}
            tick={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={TOOLTIP_CONTENT_STYLE}
            formatter={(v, name) => [`${Number(v).toFixed(1)}점`, name]}
            labelFormatter={(_, payload) => payload?.[0]?.payload?.full ?? ''}
          />
          {/* 기준을 먼저 그려야 차종 도형이 그 위에 온다(뒤에 선언하면 기준이 차종을 덮는다). */}
          <Radar
            dataKey="avg"
            name="비교군 평균"
            stroke={AVG_COLOR}
            strokeWidth={1.4}
            strokeDasharray="4 3"
            fill={AVG_COLOR}
            fillOpacity={0.08}
            dot={false}
            isAnimationActive={false}
          />
          <Radar
            dataKey="self"
            name={panel.label}
            stroke={panel.color}
            strokeWidth={2.2}
            fill={panel.color}
            fillOpacity={0.25}
            dot={{ r: 2.5, fill: panel.color, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function ConsumerRadar({
  market,
  noteDate,
}: {
  market: CompetitionMarket;
  noteDate?: string;
}) {
  // 패널이 여러 개라 각 패널은 소형 높이. 2열 그리드에서 한 화면에 4개가 들어간다.
  const h = useChartHeight(200, 240, 280);
  const { hidden, isHidden, toggle } = useHiddenSeries();

  // 훅 뒤에서 분기해야 시장을 바꿔도 훅 호출 순서가 유지된다.
  const scores = market.consumerScores;
  const panels = buildPanels(scores);

  // "지금 시점의 평가인가"라는 물음에 화면이 답해야 한다(사용자 질문 2026-08-14) — 이 점수는
  // 실시간 지표가 아니라 그 시점의 웹 근거로 AI 가 매긴 판정이라 평가일을 함께 못 박는다.
  const subtitle = `1~5점 · 바깥 링이 5점 · 회색 점선은 비교군 평균 · ${
    noteDate ? `${noteDate} 판정` : '판정일 미상'
  } · Claude Sonnet 5 · 범례 클릭으로 차종 숨김`;

  if (panels.length === 0) {
    return (
      <ChartCard title="소비자 평가 5축" subtitle={subtitle}>
        <EmptyChart reason="소비자 평가 점수 미수집" />
      </ChartCard>
    );
  }

  const averages = axisAverages(scores);
  const visible = panels.filter((p) => !isHidden(p.key));
  // 임계값 판정은 signals.ts 가 정본이라 여기서 다시 계산하지 않는다.
  const consumerSignal = evaluateMarket(market).find((r) => r.key === 'consumer') ?? null;

  return (
    <ChartCard title="소비자 평가 5축" subtitle={subtitle}>
      <LegendRow
        items={panels.map((p) => ({
          key: p.key,
          label: p.label,
          shape: 'rect' as const,
          color: p.color,
        }))}
        hidden={hidden}
        onToggle={toggle}
      />
      {visible.length === 0 ? (
        <EmptyChart reason="범례에서 모든 차종을 숨겼습니다." />
      ) : (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {visible.map((p) => (
            <RadarPanel
              key={p.key}
              panel={p}
              averages={averages}
              height={h}
              isTarget={p.score.is_target}
            />
          ))}
        </div>
      )}
      <div className="mt-1.5 text-[11px] text-muted-foreground">
        축: {CONSUMER_AXES.map((a) => `${AXIS_SHORT[a.key]}=${a.label}`).join(' · ')}
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <SignalDot signal={consumerSignal?.signal ?? null} size={8} title={consumerSignal?.hint} />
        <span className="tabular-nums">{summaryText(scores)}</span>
      </div>
    </ChartCard>
  );
}
