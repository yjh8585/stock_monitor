'use client';

/**
 * 딜러 **유통재고**일수 비교 — 대상 브랜드 vs 경쟁 브랜드.
 *
 * 유통재고일수는 "지금 팔리는 속도로 **딜러 판매점에 깔린** 재고를 소진하는 데 걸리는 날"이다.
 * 공장 재고가 아니라 판매망에 풀린 물량이라는 점을 화면 문구에도 못 박는다(사용자 확인 2026-08-14).
 * 값 하나만 보면 해석이 안 되고 **옆에 뭐가 있느냐**로 읽히므로 순위형 가로 막대로 나란히 세우고,
 * 절대 기준 하나(업계 통상선)를 세로 점선으로 겹쳐 상대·절대 두 방향을 한 화면에서 읽게 했다.
 */
import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type LabelProps,
} from 'recharts';
import { TOOLTIP_CONTENT_STYLE } from '@/components/charts/chartTheme';
import { LegendRow } from '@/components/charts/ChartLegend';
import {
  DATA_LABEL_STYLE,
  GRID_STROKE_OPACITY,
} from '@/components/oem-companies/common/chartStyle';
import { fmtFull } from '@/components/oem/helpers';
import { useChartHeight } from '@/lib/useChartHeight';
import {
  evaluateMarket,
  inventoryDelta,
  SIGNAL_THRESHOLDS,
  targetInventory,
} from '@/lib/oem-competition/signals';
import type { Signal } from '@/lib/oem-competition/signals';
import type { CompetitionMarket, InventoryPoint } from '@/lib/oem-competition/types';
import {
  ChartCard,
  EmptyChart,
  fmtPct,
  fmtYmFull,
  INDUSTRY_NORMAL_DAYS,
  rivalColor,
  shortModel,
  SignalDot,
  SIGNAL_COLORS,
  TARGET_COLOR,
  UsMetricBadge,
} from './shared';

interface InventoryChartProps {
  market: CompetitionMarket;
}

/** 차트 한 줄. 색은 정렬 전에 확정해 둔다(아래 buildRows 주석 참고). */
interface InventoryRow {
  key: string;
  label: string;
  days: number;
  /** 이 막대의 Cox 집계월(YYYYMM). 브랜드마다 다를 수 있어 행마다 들고 있어야 한다. */
  ym: number;
  color: string;
  isTarget: boolean;
  /** 최신 집계월에 Cox 가 수치를 감췄는가(= 업계 평균 2배 초과). 막대 값은 그 직전 공개월 것이다. */
  outlier: boolean;
  /** 직전 공개월 대비 증감(일수·%). 비교 대상이 없으면 null. */
  delta: { days: number; pct: number } | null;
  prevYm: number | null;
}

// 업계 관행선(60일)은 추이 카드(`InventoryTrendChart`)와 **같은 선이어야** 하므로 shared.tsx 에 있다.

/** '일' 을 문자열로 박으면 임계값 문구와 갈린다 — 단위도 상수에서 가져온다. */
const UNIT = SIGNAL_THRESHOLDS.inventory.unit;

const DOT_SIZE = 10;
/** 막대 끝 ↔ 신호등 점 ↔ 숫자 사이 여백(px). 라벨 좌표를 직접 계산하므로 상수로 둔다. */
const LABEL_GAP = 8;

/** 막대 하나로 접기 — days 가 없으면(브랜드가 Cox 로스터에 아예 없음) 행을 만들지 않는다. */
function toRow(
  p: InventoryPoint,
  key: string,
  label: string,
  color: string,
  isTarget: boolean
): InventoryRow | null {
  if (p.days_supply === null) return null;
  return {
    key,
    label,
    days: p.days_supply,
    ym: p.year_month,
    color,
    isTarget,
    outlier: p.outlierExcluded === true,
    delta: inventoryDelta(p),
    prevYm: p.prevYearMonth ?? null,
  };
}

function buildRows(inventory: InventoryPoint[]): InventoryRow[] {
  const target = targetInventory(inventory);
  if (!target) return [];

  // model 이 있으면 경쟁 차종. 배열 순서가 곧 판매 순위라 rivalColor(i) 를 여기서 확정해야
  // 아래에서 재고일수 순으로 다시 정렬해도 다른 차트와 색이 어긋나지 않는다.
  const rivals = inventory.filter((p): p is InventoryPoint & { model: string } => Boolean(p.model));

  const rows = [
    // 대상은 브랜드만 알고 차종 매칭이 없다 — 차종명을 지어내지 않는다.
    toRow(target, 'target', `${target.brand} (대상)`, TARGET_COLOR, true),
    ...rivals.map((r, i) =>
      toRow(
        r,
        `${r.brand}-${r.model}-${i}`,
        `${shortModel(r.model)} (${r.brand})`,
        rivalColor(i),
        false
      )
    ),
  ].filter((r): r is InventoryRow => r !== null);

  // 재고 부담이 큰 순. 이 차트의 질문은 "누가 무거운가"라 순위가 곧 답이고,
  // 대상은 색으로 이미 도드라져 위치가 바뀌어도 놓치지 않는다.
  return rows.sort((a, b) => b.days - a.days);
}

/**
 * Cox 가 수치를 감춘 브랜드 경고.
 *
 * 🔴 이 카드에서 가장 중요한 문장이다. Cox 는 업계 평균의 2배를 넘는 브랜드를 막대에서 빼고 이름만
 * 싣는데, 그대로 두면 화면에는 **직전 달 값이 아무 일 없다는 듯** 남아 "데이터가 없네" 로 읽힌다.
 * 실제로는 그 반대 — 값이 없다는 게 재고가 가장 심각하다는 신호다(사용자 지적 2026-08-14).
 */
function OutlierNotice({ rows }: { rows: InventoryRow[] }) {
  const flagged = rows.filter((r) => r.outlier);
  if (flagged.length === 0) return null;
  return (
    <div
      className="mb-2 rounded-md px-2.5 py-2 text-xs leading-relaxed"
      style={{ backgroundColor: `${SIGNAL_COLORS.RED}14`, color: 'var(--foreground)' }}
    >
      <span className="font-semibold" style={{ color: SIGNAL_COLORS.RED }}>
        수치 미공개 = 재고 심각
      </span>{' '}
      {/* 브랜드명이 영문이라 조사(은/는)를 붙이면 어색하다 — 콜론으로 끊는다. */}
      <span className="font-medium">
        {' '}
        {flagged.map((r) => r.label.replace(' (대상)', '')).join(' · ')}
      </span>
      : 최신 집계월에 업계 평균의 <strong>2배를 초과</strong>해 Cox 가 값을 공개하지 않았다. 아래
      막대는 <strong>마지막으로 공개된 달</strong>의 값이라 실제 재고는 이보다 나쁠 수 있다.
    </div>
  );
}

/**
 * 막대 끝 라벨(신호등 점 + 일수).
 *
 * recharts 는 `content` 가 함수면 `position` 을 좌표로 풀어 주지 않고 막대 사각형(viewBox)만
 * 넘긴다 → 좌표를 직접 계산한다. 점은 SVG 안이라 `<foreignObject>` 로 감싸 공용 `SignalDot` 을
 * 그대로 쓴다. SVG `<circle>` 로 다시 그리면 신호등 색 규칙이 두 벌이 된다.
 */
function renderBarEndLabel(
  props: LabelProps,
  rows: InventoryRow[],
  signal: Signal | null,
  hint: string
) {
  const box = props.viewBox;
  const row = props.index === undefined ? undefined : rows[props.index];
  if (!box || !('x' in box) || !row) return <g />;

  const centerY = box.y + box.height / 2;
  const dotX = box.x + box.width + LABEL_GAP;
  // 대상에만 점을 붙이므로 숫자 시작점이 행마다 다르다. 막대 길이가 제각각이라 어차피
  // 라벨이 한 열로 정렬되지 않고, 각 숫자가 제 막대에 붙어 있는 편이 읽기 쉽다.
  const textX = row.isTarget ? dotX + DOT_SIZE + LABEL_GAP : dotX;

  return (
    <g>
      {row.isTarget && (
        <foreignObject
          x={dotX}
          y={centerY - (DOT_SIZE + 4) / 2}
          width={DOT_SIZE + 4}
          height={DOT_SIZE + 4}
        >
          {/* inline-block 은 baseline 에 얹혀 아래로 밀린다 — flex 로 강제 중앙 정렬. */}
          <div className="flex h-full w-full items-center justify-center">
            <SignalDot signal={signal} size={DOT_SIZE} title={hint} />
          </div>
        </foreignObject>
      )}
      <text
        x={textX}
        y={centerY}
        textAnchor="start"
        dominantBaseline="central"
        style={DATA_LABEL_STYLE}
      >
        {`${fmtFull(row.days)}${UNIT}`}
      </text>
    </g>
  );
}

export default function InventoryChart({ market }: InventoryChartProps) {
  const h = useChartHeight(280, 360, 440);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const target = useMemo(() => targetInventory(market.inventory), [market.inventory]);
  const allRows = useMemo(() => buildRows(market.inventory), [market.inventory]);
  const rows = useMemo(
    () => allRows.filter((r) => !hidden.has(r.isTarget ? 'target' : 'rival')),
    [allRows, hidden]
  );
  const inventorySignal = useMemo(
    () => evaluateMarket(market).find((r) => r.key === 'inventory') ?? null,
    [market]
  );

  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Cox 는 값이 업계평균을 크게 벗어난 달을 비워 두므로 브랜드별 **최신 공개월**이 서로 다를 수
  // 있다. 하나의 기준월인 척하면 서로 다른 달을 같은 달처럼 비교하게 되므로 그 사실을 적는다.
  const mixedMonth = new Set(allRows.map((r) => r.ym)).size > 1;
  const anchor = target ? ` · 대상 ${fmtYmFull(target.year_month)} 기준` : '';
  const subtitle = (
    <>
      미국 딜러 판매점에 깔린 미판매 신차 기준 · <strong>공장 재고 아님</strong> · 브랜드 단위(차종
      아님) · Cox Automotive{anchor}
      <UsMetricBadge basis={market.usMetricsBasis} />
      <br />
      같은 브랜드의 다른 차종에도 같은 값이 쓰인다 — 이 차종만의 재고가 아니다.
      {mixedMonth && (
        <>
          <br />
          브랜드별 최신 공개월이 서로 다르다 — 같은 달끼리의 비교가 아니다.
        </>
      )}
    </>
  );

  if (allRows.length === 0) {
    return (
      <ChartCard title="딜러 유통재고일수" subtitle={subtitle}>
        <EmptyChart reason="Cox 유통재고 미제공 (미국 미판매 브랜드이거나 Cox 로스터에 없음)" />
      </ChartCard>
    );
  }

  const legendItems = [
    { key: 'target', label: '대상 브랜드', shape: 'rect' as const, color: TARGET_COLOR },
    ...(allRows.length > 1
      ? [{ key: 'rival', label: '경쟁 브랜드', shape: 'rect' as const, color: rivalColor(0) }]
      : []),
  ];

  return (
    <ChartCard title="딜러 유통재고일수" subtitle={subtitle}>
      <OutlierNotice rows={allRows} />
      {/*
        범례를 recharts `<Legend>` 로 두면 "업계 통상 60일" 기준선 라벨과 **같은 줄에 겹쳐** 둘 다
        안 읽힌다(2026-08-14 화면 확인 — margin 을 벌려도 겹친다. 둘 다 plot 상단을 노린다).
        차트 밖으로 빼면 자리 다툼 자체가 없어진다.
      */}
      <div className="mb-1">
        <LegendRow items={legendItems} hidden={hidden} onToggle={toggle} />
      </div>
      <ResponsiveContainer width="100%" height={h}>
        {/* top 여백은 "업계 통상 60일" 기준선 라벨 자리다. */}
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 26, right: 90, bottom: 5, left: 10 }}
        >
          <CartesianGrid
            horizontal={false}
            strokeDasharray="3 3"
            className="stroke-border"
            strokeOpacity={GRID_STROKE_OPACITY}
          />
          <XAxis
            type="number"
            tickFormatter={(v: number) => `${v}${UNIT}`}
            tick={{ fontSize: 14 }}
          />
          <YAxis type="category" dataKey="label" width={170} tick={{ fontSize: 14 }} interval={0} />
          <Tooltip
            formatter={(v, _n, item) => {
              const d = (item as { payload?: InventoryRow }).payload;
              const base = `${fmtFull(Number(v))}${UNIT} (${d ? fmtYmFull(d.ym) : '-'})`;
              // 수준만 보면 "많다/적다"는 알아도 "쌓이는 중인지"는 모른다 → 직전 공개월 대비를 붙인다.
              const move =
                d?.delta && d.prevYm
                  ? ` · ${fmtYmFull(d.prevYm)} 대비 ${d.delta.days > 0 ? '+' : ''}${
                      d.delta.days
                    }${UNIT} (${fmtPct(d.delta.pct)})`
                  : '';
              const flag = d?.outlier ? ' · 최신월 미공개(평균 2배 초과)' : '';
              return [`${base}${move}${flag}`, '유통재고일수'];
            }}
            cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
            contentStyle={TOOLTIP_CONTENT_STYLE}
          />
          <ReferenceLine
            x={INDUSTRY_NORMAL_DAYS}
            stroke="var(--muted-foreground)"
            strokeDasharray="4 4"
            label={{
              value: `업계 통상 ${INDUSTRY_NORMAL_DAYS}${UNIT}`,
              position: 'top',
              fill: 'var(--muted-foreground)',
              fontSize: 13,
            }}
          />
          <Bar dataKey="days" radius={[0, 4, 4, 0]} maxBarSize={28} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.key} fill={r.color} />
            ))}
            <LabelList
              dataKey="days"
              content={(props: LabelProps) =>
                renderBarEndLabel(
                  props,
                  rows,
                  inventorySignal?.signal ?? null,
                  inventorySignal?.hint ?? ''
                )
              }
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
