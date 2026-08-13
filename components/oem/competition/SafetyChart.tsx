'use client';

/**
 * NHTSA 리콜·소비자 불만 — 대상 차종과 경쟁 차종을 나란히 비교한다.
 *
 * 두 지표는 자릿수가 다르다(리콜은 한 자리, 불만은 수십~수백). 한 축에 얹으면 리콜 막대가 바닥에
 * 붙어 아예 안 보이므로 이중 Y축으로 각자 축에 맞춘다. 대신 축이 둘이면 "막대가 더 높으니 더
 * 나쁘다"는 오독이 생기므로 두 막대 모두에 실제 건수를 라벨로 찍고 축 소속을 범례에 밝힌다.
 *
 * chart-guide §4-F(막대+꺾은선 이중축)의 "영역 분리"는 **겹쳐 그리는** 콤보를 위한 규칙이라 그대로
 * 옮겨오지 않았다. x축이 시간이 아니라 차종(범주)이어서 꺾은선을 쓰면 차종 사이에 있지도 않은
 * 추세선이 그려지고, 두 막대는 같은 xAxisId 안에서 좌우로 나뉘어 애초에 겹치지 않는다. §4-F 가
 * 막으려던 "표식 충돌" 대신 "라벨이 축 상단에서 잘리는 문제"만 남으므로 domain 상한을 벌려 푼다.
 */
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TOOLTIP_CONTENT_STYLE } from '@/components/charts/chartTheme';
import {
  DATA_LABEL_STYLE,
  GRID_STROKE_OPACITY,
} from '@/components/oem-companies/common/chartStyle';
import { fmtFull } from '@/components/oem/helpers';
import { targetSafety } from '@/lib/oem-competition/signals';
import type { CompetitionMarket, SafetyPoint } from '@/lib/oem-competition/types';
import { useChartHeight } from '@/lib/useChartHeight';
import { ChartCard, EmptyChart, rivalColor, shortModel, TARGET_COLOR } from './shared';

/** 불만 건수를 못 가져온 차종의 x축 라벨 꼬리표. 캡션의 각주와 짝을 이룬다. */
const UNKNOWN_MARK = '*';

/**
 * 공용 `Y_AXIS_PADDED_DOMAIN`(×1.1)을 쓰지 않는다: 리콜은 전 차종 0건인 경우가 흔한데 그때
 * domain 이 [0, 0]으로 접혀 축이 무너진다. 하한 1을 보장하고, 15px 데이터 라벨이 들어갈 자리를
 * 위해 1.25배까지 벌린다. 두 축이 같은 공식을 써야 눈금 여백이 좌우 대칭으로 보인다.
 */
const COUNT_DOMAIN: [number, (dataMax: number) => number] = [
  0,
  (dataMax: number) => Math.max(Math.ceil(dataMax * 1.25), 1),
];

interface SafetyRow {
  /** x축 카테고리. 모델연도가 차종마다 달라 이름만 쓰면 같은 조건 비교인지 알 수 없다. */
  label: string;
  recalls: number;
  /** null = 조회 실패. 막대를 그리지 않아 "0건"과 구분된다. */
  complaints: number | null;
  color: string;
}

/**
 * safety 의 대상 항목엔 차종명이 없다(`model` 이 곧 "경쟁차종"을 뜻하는 필드라서).
 * 이름은 대상 표시가 따로 있는 다른 배열에서 빌려 온다.
 */
function targetModelName(market: CompetitionMarket): string {
  return (
    market.series.find((s) => s.isTarget)?.model ??
    market.consumerScores.find((s) => s.is_target)?.model ??
    '대상 차종'
  );
}

function rowLabel(name: string, point: SafetyPoint): string {
  const mark = point.complaint_count === null ? UNKNOWN_MARK : '';
  return `${shortModel(name)} (${point.model_year}년형)${mark}`;
}

/** 대상을 항상 맨 왼쪽에 두고 경쟁은 원본 순서(판매 상위 순)를 유지한다. */
function buildRows(market: CompetitionMarket): SafetyRow[] {
  const rows: SafetyRow[] = [];
  const target = targetSafety(market.safety);
  if (target) {
    rows.push({
      label: rowLabel(targetModelName(market), target),
      recalls: target.recall_count,
      complaints: target.complaint_count,
      color: TARGET_COLOR,
    });
  }
  // flatMap 으로 좁혀 `model` 이 확정된 항목만 남긴다(비-null 단언 없이 타입이 좁혀진다).
  market.safety
    .flatMap((point) => (point.model ? [{ point, name: point.model }] : []))
    .forEach(({ point, name }, i) => {
      rows.push({
        label: rowLabel(name, point),
        recalls: point.recall_count,
        complaints: point.complaint_count,
        color: rivalColor(i),
      });
    });
  return rows;
}

/**
 * 색은 이미 "대상/경쟁"에 쓰여 지표를 가르는 데 못 쓴다. 그래서 지표 구분자는 채움 방식(꽉 참 =
 * 리콜 / 테두리만 = 불만)이고 범례도 색이 아니라 그 채움 방식을 보여 준다. 공용 `LegendRow` 는
 * rect·line 두 모양뿐이라 "테두리만" 칩을 못 그려 이 차트 안에서만 쓰는 최소 범례를 둔다.
 */
function MetricLegend() {
  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-base font-medium">
      <span className="inline-flex items-center gap-1.5">
        <span
          className="inline-block h-4 w-4 rounded-sm"
          style={{ background: 'var(--foreground)' }}
        />
        리콜 건수 (왼쪽 축)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="inline-block h-4 w-4 rounded-sm"
          style={{ border: '2px solid var(--foreground)' }}
        />
        불만 건수 (오른쪽 축)
      </span>
    </div>
  );
}

export default function SafetyChart({ market }: { market: CompetitionMarket }) {
  const h = useChartHeight(280, 360, 440);
  const rows = buildRows(market);
  const unknown = market.safety.filter((s) => s.complaint_count === null).length;

  return (
    <ChartCard
      title="NHTSA 리콜·소비자 불만"
      subtitle="NHTSA(미국 도로교통안전국) 공개 데이터 · 모델연도 기준"
    >
      {rows.length === 0 ? (
        <EmptyChart reason="NHTSA 데이터 없음 (미국 미판매 차종)" />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={h}>
            <ComposedChart data={rows} margin={{ top: 32, right: 24, bottom: 10, left: 10 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                className="stroke-border"
                strokeOpacity={GRID_STROKE_OPACITY}
                vertical={false}
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 14 }}
                interval={0}
                angle={-25}
                textAnchor="end"
                height={80}
              />
              <YAxis
                yAxisId="recall"
                domain={COUNT_DOMAIN}
                allowDecimals={false}
                tickFormatter={(v: number) => fmtFull(v)}
                tick={{ fontSize: 14 }}
                width={48}
              />
              <YAxis
                yAxisId="complaint"
                orientation="right"
                domain={COUNT_DOMAIN}
                allowDecimals={false}
                tickFormatter={(v: number) => fmtFull(v)}
                tick={{ fontSize: 14 }}
                width={56}
              />
              {/* filterNull=false 여야 조회 실패(null)가 툴팁에서 사라지지 않고 "조회 실패"로 남는다. */}
              <Tooltip
                cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
                contentStyle={TOOLTIP_CONTENT_STYLE}
                filterNull={false}
                formatter={(value, name) =>
                  value == null
                    ? ['조회 실패', String(name)]
                    : [`${fmtFull(Number(value))}건`, String(name)]
                }
              />
              <Legend
                verticalAlign="top"
                align="center"
                wrapperStyle={{ paddingBottom: 4 }}
                content={() => <MetricLegend />}
              />
              <Bar yAxisId="recall" dataKey="recalls" name="리콜 건수" radius={[2, 2, 0, 0]}>
                {rows.map((r, i) => (
                  <Cell key={`${r.label}-${i}`} fill={r.color} />
                ))}
                <LabelList
                  dataKey="recalls"
                  position="top"
                  formatter={(v: unknown) => (v == null ? '' : fmtFull(Number(v)))}
                  style={DATA_LABEL_STYLE}
                />
              </Bar>
              <Bar yAxisId="complaint" dataKey="complaints" name="불만 건수" radius={[2, 2, 0, 0]}>
                {rows.map((r, i) => (
                  <Cell
                    key={`${r.label}-${i}`}
                    fill={r.color}
                    fillOpacity={0.3}
                    stroke={r.color}
                    strokeWidth={1.5}
                  />
                ))}
                <LabelList
                  dataKey="complaints"
                  position="top"
                  formatter={(v: unknown) => (v == null ? '' : fmtFull(Number(v)))}
                  style={DATA_LABEL_STYLE}
                />
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
          <p className="mt-1 text-xs text-muted-foreground">
            좌우 축의 눈금이 서로 다르다 — 막대 높이를 직접 견주지 말고 숫자를 볼 것.
            {unknown > 0 &&
              ` ${UNKNOWN_MARK} 표시는 불만 건수 조회 실패로, 막대 없음이 0건을 뜻하지 않는다.`}
          </p>
        </>
      )}
    </ChartCard>
  );
}
