'use client';

/**
 * NHTSA 리콜 · 소비자 불만 — 한 번에 **한 지표만** 그리고 버튼으로 갈아 끼운다.
 *
 * 옛 버전은 두 지표를 이중 Y축에 나란히 세웠다. 자릿수가 달라(리콜 한 자리 · 불만 수십~수백) 축을
 * 나눌 수밖에 없었는데, 축이 둘이면 막대 높이끼리 견줄 수 없어 "숫자를 보라"는 각주를 달아야 했다
 * — 각주로 막아야 하는 차트는 이미 진 차트다(사용자 지적 2026-08-14). 지표를 갈라 단일 축으로
 * 두면 막대 길이가 곧 비교가 된다. 기본값은 리콜이다(확정된 결함이라 판단 근거로 더 무겁다).
 */
import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TOOLTIP_CONTENT_STYLE } from '@/components/charts/chartTheme';
import { LegendRow } from '@/components/charts/ChartLegend';
import {
  DATA_LABEL_STYLE,
  GRID_STROKE_OPACITY,
} from '@/components/oem-companies/common/chartStyle';
import { fmtFull } from '@/components/oem/helpers';
import { targetSafety } from '@/lib/oem-competition/signals';
import type { CompetitionMarket, SafetyPoint } from '@/lib/oem-competition/types';
import { useChartHeight } from '@/lib/useChartHeight';
import {
  ChartCard,
  EmptyChart,
  rivalColor,
  SegmentedToggle,
  shortModel,
  TARGET_COLOR,
  targetModelName,
  UsMetricBadge,
} from './shared';

type Metric = 'recall' | 'complaint';

/**
 * 두 지표의 뜻 — 화면에 항상 띄운다. "리콜 3건 vs 불만 204건" 을 나란히 놓으면 불만이 68배 심각해
 * 보이지만 둘은 애초에 세는 대상이 다르다(사용자 질문 2026-08-14).
 */
const METRIC_META: Record<Metric, { button: string; series: string; unit: string; what: string }> =
  {
    recall: {
      button: '리콜',
      series: '리콜 건수',
      unit: '건',
      what: '제작사가 안전 결함·연방 안전기준 미달을 인정했거나 NHTSA 가 강제해 **무상 수리를 공식 시행**한 조치. 캠페인 단위라 건수는 작지만 한 건이 수만~수십만 대를 대상으로 하는 확정된 결함이다.',
    },
    complaint: {
      button: '소비자 불만',
      series: '불만 건수',
      unit: '건',
      what: '차주가 NHTSA 에 직접 접수한 **신고**. 검증 전 민원이라 한 건 = 한 사람의 주장이고 수십~수백 건이 쌓인다. 같은 부품 불만이 누적되면 NHTSA 가 조사를 열고 리콜로 이어지기도 해 **리콜의 선행지표**로 본다.',
    },
  };

/** 불만 건수를 못 가져온 차종의 x축 라벨 꼬리표. 캡션의 각주와 짝을 이룬다. */
const UNKNOWN_MARK = '*';

/**
 * 공용 `Y_AXIS_PADDED_DOMAIN`(×1.1)을 쓰지 않는다: 리콜은 전 차종 0건인 경우가 흔한데 그때
 * domain 이 [0, 0]으로 접혀 축이 무너진다. 하한 1을 보장하고, 15px 데이터 라벨이 들어갈 자리를
 * 위해 1.25배까지 벌린다.
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
  isTarget: boolean;
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
      isTarget: true,
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
        isTarget: false,
      });
    });
  return rows;
}

/** 문장 안 `**강조**` 만 굵게 — 설명 문구를 상수에 두면서 핵심어를 살리기 위한 최소 처리. */
function Emphasized({ text }: { text: string }) {
  return (
    <>
      {text
        .split('**')
        .map((part, i) =>
          i % 2 === 1 ? <strong key={i}>{part}</strong> : <span key={i}>{part}</span>
        )}
    </>
  );
}

/**
 * "무슨 리콜·불만인가" — 기본은 접혀 있고 눌러야 펼쳐진다(사용자 지시 2026-08-14).
 *
 * 상세는 **대상 차종만** 수집한다. 경쟁 차종까지 받으면 NHTSA 호출이 차종×연도로 불어나
 * 수집 시간이 배로 든다. 그래서 "경쟁은 건수만"이라는 사실을 펼친 안에 명시한다.
 */
function SafetyDetails({ target, metric }: { target: SafetyPoint | null; metric: Metric }) {
  const meta = METRIC_META[metric];
  const components = metric === 'recall' ? target?.recallComponents : target?.complaintComponents;
  const summaries = metric === 'recall' ? target?.recallSummaries : undefined;
  const hasDetail = (components?.length ?? 0) > 0 || (summaries?.length ?? 0) > 0;

  return (
    <details className="mt-2 rounded-md border border-border">
      <summary className="cursor-pointer px-2.5 py-1.5 text-xs font-medium select-none">
        무슨 {meta.button}인가 — 부품군·요약 보기
      </summary>
      <div className="space-y-2 px-2.5 pt-1 pb-2.5 text-xs">
        <p className="leading-relaxed text-muted-foreground">
          <Emphasized text={meta.what} />
        </p>

        {hasDetail ? (
          <>
            {(components?.length ?? 0) > 0 && (
              <div>
                <div className="font-medium">
                  {target?.model_year}년형 대상 차종 · {meta.button}이 몰린 부품군
                </div>
                <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
                  {components?.map(([name, count]) => (
                    <li key={name} className="tabular-nums">
                      {name} — {fmtFull(count)}
                      {meta.unit}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(summaries?.length ?? 0) > 0 && (
              <div>
                <div className="font-medium">최근 {meta.button} 요약</div>
                <ul className="mt-0.5 space-y-1 text-muted-foreground">
                  {summaries?.map((s, i) => (
                    <li key={i} className="leading-relaxed">
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">
            {metric === 'complaint'
              ? '불만 내역은 다음 수집(매월 21일)부터 부품군별로 쌓인다 — 그 이전 적재분에는 건수만 있다.'
              : '이 차종의 리콜 내역이 없다.'}
          </p>
        )}

        <p className="text-muted-foreground">
          내역은 <strong>대상 차종만</strong> 수집한다(경쟁 차종은 건수만). 원문은 NHTSA 공개
          데이터이며 미국 등록 차량 한정이다.
        </p>
      </div>
    </details>
  );
}

export default function SafetyChart({ market }: { market: CompetitionMarket }) {
  const h = useChartHeight(280, 360, 440);
  const [metric, setMetric] = useState<Metric>('recall');
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());

  const allRows = buildRows(market);
  const rows = allRows.filter((r) => !hidden.has(r.isTarget ? 'target' : 'rival'));
  const unknown = market.safety.filter((s) => s.complaint_count === null).length;
  const meta = METRIC_META[metric];

  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const legendItems = [
    { key: 'target', label: '대상 차종', shape: 'rect' as const, color: TARGET_COLOR },
    ...(allRows.length > 1
      ? [{ key: 'rival', label: '경쟁 차종', shape: 'rect' as const, color: rivalColor(0) }]
      : []),
  ];

  const subtitle = (
    <>
      NHTSA(미국 도로교통안전국) 공개 데이터 · 모델연도 기준
      <UsMetricBadge basis={market.usMetricsBasis} />
    </>
  );

  const metricToggle = (
    <SegmentedToggle
      options={(['recall', 'complaint'] as const).map((m) => ({
        value: m,
        label: METRIC_META[m].button,
      }))}
      value={metric}
      onChange={setMetric}
      ariaLabel="표시 지표"
    />
  );

  return (
    <ChartCard title="NHTSA 리콜 · 소비자 불만" subtitle={subtitle} actions={metricToggle}>
      {allRows.length === 0 ? (
        <EmptyChart reason="NHTSA 데이터 없음 (미국 미판매 차종)" />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={h}>
            <BarChart data={rows} margin={{ top: 24, right: 16, bottom: 10, left: 10 }}>
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
                domain={COUNT_DOMAIN}
                allowDecimals={false}
                tickFormatter={(v: number) => fmtFull(v)}
                tick={{ fontSize: 14 }}
                width={48}
              />
              {/* filterNull=false 여야 조회 실패(null)가 툴팁에서 사라지지 않고 "조회 실패"로 남는다. */}
              <Tooltip
                cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
                contentStyle={TOOLTIP_CONTENT_STYLE}
                filterNull={false}
                formatter={(value, name) =>
                  value == null
                    ? ['조회 실패', String(name)]
                    : [`${fmtFull(Number(value))}${meta.unit}`, String(name)]
                }
              />
              <Legend
                verticalAlign="top"
                align="center"
                wrapperStyle={{ paddingBottom: 8 }}
                content={() => <LegendRow items={legendItems} hidden={hidden} onToggle={toggle} />}
              />
              {/*
                🔴 minPointSize 로 0건에도 3px 을 남긴다. 없으면 막대도 라벨도 안 그려져 x축에
                이름만 남는데, 그 모습이 **"조회 실패(=알 수 없음)"와 똑같다**(2026-08-14 화면 확인
                — Ford F-Series 리콜 0건). 이 페이지에서 가장 조심하는 오독이 "0건을 데이터 없음으로,
                데이터 없음을 0건으로" 읽는 것이라 둘은 눈으로 갈려야 한다.
              */}
              <Bar
                dataKey={metric === 'recall' ? 'recalls' : 'complaints'}
                name={meta.series}
                radius={[2, 2, 0, 0]}
                maxBarSize={64}
                minPointSize={3}
              >
                {rows.map((r, i) => (
                  <Cell key={`${r.label}-${i}`} fill={r.color} />
                ))}
                <LabelList
                  dataKey={metric === 'recall' ? 'recalls' : 'complaints'}
                  position="top"
                  formatter={(v: unknown) => (v == null ? '' : fmtFull(Number(v)))}
                  style={DATA_LABEL_STYLE}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {metric === 'complaint' && unknown > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {UNKNOWN_MARK} 표시는 불만 건수 조회 실패로, 막대 없음이 0건을 뜻하지 않는다.
            </p>
          )}

          <SafetyDetails target={targetSafety(market.safety)} metric={metric} />
        </>
      )}
    </ChartCard>
  );
}
