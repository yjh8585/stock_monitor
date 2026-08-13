'use client';

/**
 * 경쟁군 내 점유율의 전년 대비 이동 — 차종 한 줄에 덤벨 하나.
 *
 * 전년·현재를 막대 두 개로 세우면 "얼마나 움직였나"를 눈으로 빼야 하지만, 덤벨은 이동 자체가
 * 선분의 길이·색으로 바로 읽힌다. recharts 에는 덤벨 프리미티브가 없어 산점+에러바로 흉내 내야
 * 하는데, 행마다 차종명과 정확한 수치를 붙이는 이 레이아웃에서는 div/CSS 가 더 짧고 정확하다.
 * (docs/chart-guide.md §7-2 의 "카테고리 축" 레시피가 다루지 못하는 형태)
 */
import type { ReactNode } from 'react';
import { TOOLTIP_CONTENT_STYLE } from '@/components/charts/chartTheme';
import { GRID_STROKE_OPACITY } from '@/components/oem-companies/common/chartStyle';
import { fmtFull, fmtUnits } from '@/components/oem/helpers';
import type { CompetitionMarket } from '@/lib/oem-competition/types';
import { useChartHeight } from '@/lib/useChartHeight';
import {
  ChartCard,
  EmptyChart,
  fmtPct,
  periodLabel,
  rivalColor,
  shortModel,
  SIGNAL_COLORS,
  TARGET_COLOR,
} from './shared';

/** 점유율 상승은 신호등의 GREEN 과 같은 뜻이라 색을 새로 만들지 않고 그대로 쓴다. */
const RISE_COLOR = SIGNAL_COLORS.GREEN;
const FALL_COLOR = SIGNAL_COLORS.RED;

/** 세 열의 폭은 본문 행과 축 행이 정확히 같아야 눈금이 점과 어긋나지 않는다. */
const LABEL_COL = 'w-20 shrink-0 sm:w-28';
const VALUE_COL = 'w-24 shrink-0 sm:w-44';
const TRACK_COL = 'min-w-0 flex-1 px-2';

/** 축 최대값 후보. 어느 값을 골라도 절반이 정수라 눈금 라벨이 지저분해지지 않는다. */
const AXIS_STEPS = [10, 20, 30, 40, 50, 60, 80, 100];

interface ShareRow {
  model: string;
  isTarget: boolean;
  sales: number;
  yoyPct: number | null;
  /** 현재 점유율(%) */
  cur: number;
  /** 전년 점유율(%). 경쟁 차종은 YoY 가 없으면 역산이 불가능해 null. */
  prev: number | null;
  color: string;
}

/**
 * YoY(%)로 전년 판매를 역산.
 * -100%(=전년 대비 전멸)면 분모가 0 이 돼 값을 만들 수 없다 — 억지로 0 을 넣지 않고 포기한다.
 */
function prevSalesFromYoy(sales: number, yoyPct: number | null): number | null {
  if (yoyPct === null || yoyPct <= -100) return null;
  return sales / (1 + yoyPct / 100);
}

/** 대상 차종 이름은 CompetitionMarket 에 직접 없다 — 시계열·소비자평가에 붙은 이름을 빌린다. */
function targetModelName(market: CompetitionMarket): string {
  const name =
    market.series.find((s) => s.isTarget)?.model ??
    market.consumerScores.find((s) => s.is_target)?.model;
  return name ? shortModel(name) : '대상 차종';
}

function buildRows(market: CompetitionMarket, total: number): ShareRow[] {
  const { sharePct, prevSharePct } = market;
  // competitors 와 share_pct 는 서로 다른 JSONB 컬럼에서 오므로 "경쟁군은 비었는데 점유율은 있는"
  // 상태가 실제로 나온다. 그대로 그리면 대상 혼자 선 덤벨에 "경쟁군 합계 = 대상 판매량"이 붙는다.
  // total 이 NaN 이면(JSONB 에 숫자 아닌 sales 가 섞이면) `total <= 0` 은 false 라 그냥 통과해
  // 좌표가 전부 NaN 인 차트가 그려지므로 유한성까지 함께 본다.
  if (
    !Number.isFinite(total) ||
    total <= 0 ||
    market.competitors.length === 0 ||
    sharePct === null ||
    prevSharePct === null
  ) {
    return [];
  }

  // 전년 분모는 대상의 저장된 전년 점유율에서 되돌린다. 역산에 성공한 차종만 더해 분모를 만들면
  // YoY 결측 차종의 몫이 통째로 빠져 나머지 차종의 전년 점유율이 조용히 부풀려진다.
  const targetPrevSales = prevSalesFromYoy(market.sales, market.yoyPct);
  const prevTotal =
    targetPrevSales !== null && targetPrevSales > 0 && prevSharePct > 0
      ? targetPrevSales / (prevSharePct / 100)
      : null;

  const rows: ShareRow[] = [
    {
      model: targetModelName(market),
      isTarget: true,
      sales: market.sales,
      yoyPct: market.yoyPct,
      // 대상만은 저장값을 쓴다 — 여기서 다시 계산하면 KPI·스코어보드와 반올림 한 자리가 갈린다.
      cur: sharePct,
      prev: prevSharePct,
      color: TARGET_COLOR,
    },
    ...market.competitors.map((c, i) => {
      const prevSales = prevSalesFromYoy(c.sales, c.yoy_pct);
      return {
        model: shortModel(c.model),
        isTarget: false,
        sales: c.sales,
        yoyPct: c.yoy_pct,
        cur: (c.sales / total) * 100,
        prev: prevSales !== null && prevTotal !== null ? (prevSales / prevTotal) * 100 : null,
        color: rivalColor(i),
      };
    }),
  ];

  return rows.sort((a, b) => b.cur - a.cur);
}

/** 왜 그릴 게 없는지 — 원인마다 문구가 달라야 "데이터 없음"이 어디를 고칠 신호인지 알 수 있다. */
function emptyReason(market: CompetitionMarket, total: number): string {
  if (market.competitors.length === 0) return '경쟁 차종 데이터가 없어 점유율을 낼 수 없습니다.';
  if (!Number.isFinite(total) || total <= 0)
    return '경쟁군 판매량 합계가 0이라 점유율을 계산할 수 없습니다.';
  return '전년 점유율이 없어 점유율 변화를 그릴 수 없습니다.';
}

/** 점유율 '수준' 표기. fmtPct 는 양수에 +를 붙이는 증감용이라 수준값에는 쓸 수 없다. */
function fmtLevel(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

function fmtDeltaPp(delta: number | null): string {
  if (delta === null) return '(전년 —)';
  return `(${delta > 0 ? '+' : ''}${delta.toFixed(1)}%p)`;
}

function Dot({ left, color, size }: { left: number; color: string; size: number }) {
  return (
    <span
      className="absolute rounded-full"
      style={{
        left: `${left}%`,
        top: '50%',
        width: size,
        height: size,
        marginLeft: -size / 2,
        marginTop: -size / 2,
        backgroundColor: color,
        // rivalColor 뒤쪽은 매우 옅은 회색이라 밝은 배경에서 사라진다 — 테두리로 최소 대비 확보.
        boxShadow: '0 0 0 1px var(--border)',
      }}
    />
  );
}

function LegendItem({ swatch, label }: { swatch: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      {swatch}
      {label}
    </span>
  );
}

function LegendBar({ color }: { color: string }) {
  return (
    <span className="inline-block h-[3px] w-4 rounded-full" style={{ backgroundColor: color }} />
  );
}

/** 범례용 점 — 본문 Dot 은 트랙 좌표에 절대배치되므로 인라인 흐름에는 쓸 수 없다. */
function LegendDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full"
      style={{ backgroundColor: color, boxShadow: '0 0 0 1px var(--border)' }}
    />
  );
}

export interface ShareDumbbellProps {
  market: CompetitionMarket;
}

export default function ShareDumbbell({ market }: ShareDumbbellProps) {
  // 행 수가 경쟁군 크기(최대 9종)에 따라 달라져 총 높이를 고정할 수 없다 → 한 줄 높이를 폭에 맞춘다.
  const rowHeight = useChartHeight(34, 38, 42);

  const total = market.sales + market.competitors.reduce((acc, c) => acc + c.sales, 0);
  const rows = buildRows(market, total);
  const period = periodLabel(market);

  if (rows.length === 0) {
    return (
      <ChartCard title="경쟁군 내 점유율 변화" subtitle={period || undefined}>
        <EmptyChart reason={emptyReason(market, total)} />
      </ChartCard>
    );
  }

  // prev 가 없는 행은 축 계산에서 아예 뺀다 — 0 을 대신 넣으면 '전년 점유율 0%'를 사실처럼 다루게 된다.
  const maxShare = Math.max(...rows.flatMap((r) => (r.prev === null ? [r.cur] : [r.cur, r.prev])));
  const axisMax = AXIS_STEPS.find((s) => s >= maxShare) ?? 100;
  const ticks = [0, axisMax / 2, axisMax];
  const pos = (value: number) => (value / axisMax) * 100;

  const subtitle = `${period ? `${period} · ` : ''}경쟁군 합계 ${fmtUnits(total)}대 대비 · 경쟁 차종의 전년 점유율은 YoY로 역산한 값`;

  return (
    <ChartCard title="경쟁군 내 점유율 변화" subtitle={subtitle}>
      <div
        className="mb-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1"
        style={{ fontSize: 14 }}
      >
        <LegendItem swatch={<LegendDot color="var(--muted-foreground)" />} label="전년" />
        <LegendItem swatch={<LegendDot color={TARGET_COLOR} />} label="현재" />
        <LegendItem swatch={<LegendBar color={RISE_COLOR} />} label="상승" />
        <LegendItem swatch={<LegendBar color={FALL_COLOR} />} label="하락" />
      </div>

      <div>
        {rows.map((row, i) => {
          const delta = row.prev === null ? null : row.cur - row.prev;
          const lineColor = delta !== null && delta < 0 ? FALL_COLOR : RISE_COLOR;
          return (
            <div
              key={`${row.model}-${i}`}
              className={`group relative flex items-stretch ${
                row.isTarget ? 'rounded bg-muted/50' : ''
              }`}
              style={{ height: rowHeight }}
            >
              <div className={`${LABEL_COL} flex flex-col justify-center pr-1`}>
                <div
                  className={`truncate text-xs ${row.isTarget ? 'font-semibold' : ''}`}
                  title={row.model}
                  style={row.isTarget ? { color: TARGET_COLOR } : undefined}
                >
                  {row.model}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {fmtUnits(row.sales)}대
                </div>
              </div>

              <div className={TRACK_COL}>
                <div className="relative h-full">
                  {ticks.map((t) => (
                    <div
                      key={t}
                      className="absolute top-0 bottom-0 w-px"
                      style={{
                        left: `${pos(t)}%`,
                        backgroundColor: 'var(--border)',
                        opacity: GRID_STROKE_OPACITY,
                      }}
                    />
                  ))}
                  {row.prev !== null && (
                    <div
                      className="absolute h-[3px] rounded-full"
                      style={{
                        left: `${pos(Math.min(row.prev, row.cur))}%`,
                        width: `${Math.abs(pos(row.cur) - pos(row.prev))}%`,
                        top: '50%',
                        marginTop: -1.5,
                        backgroundColor: lineColor,
                      }}
                    />
                  )}
                  {row.prev !== null && (
                    <Dot left={pos(row.prev)} color="var(--muted-foreground)" size={9} />
                  )}
                  <Dot left={pos(row.cur)} color={row.color} size={row.isTarget ? 13 : 11} />
                </div>
              </div>

              <div className={`${VALUE_COL} flex items-center justify-end gap-1 tabular-nums`}>
                <span className="text-[11px] sm:text-xs">
                  {/* 좁은 화면에선 전년 수치를 접는다 — 툴팁에 같은 값이 그대로 남는다. */}
                  <span className="hidden text-muted-foreground sm:inline">
                    {fmtLevel(row.prev)} →{' '}
                  </span>
                  {fmtLevel(row.cur)}
                </span>
                <span
                  className="text-[11px] font-medium sm:text-xs"
                  style={{
                    color:
                      delta === null
                        ? 'var(--muted-foreground)'
                        : delta < 0
                          ? FALL_COLOR
                          : RISE_COLOR,
                  }}
                >
                  {fmtDeltaPp(delta)}
                </span>
              </div>

              <div
                className="pointer-events-none absolute top-full left-1/2 z-20 hidden -translate-x-1/2 rounded px-2 py-1 whitespace-nowrap group-hover:block"
                style={TOOLTIP_CONTENT_STYLE}
              >
                <div className="font-medium">{row.model}</div>
                <div className="text-muted-foreground">
                  판매 {fmtFull(row.sales)}대 · YoY {fmtPct(row.yoyPct)}
                </div>
                <div className="text-muted-foreground">
                  점유율 {fmtLevel(row.prev)} → {fmtLevel(row.cur)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-stretch">
        <div className={LABEL_COL} />
        <div className={TRACK_COL}>
          <div className="relative h-4">
            {ticks.map((t, i) => (
              <span
                key={t}
                className="absolute text-muted-foreground"
                style={{
                  left: `${pos(t)}%`,
                  // 양 끝 라벨만 안쪽으로 붙인다 — 가운데 정렬하면 트랙 밖으로 삐져나가 잘린다.
                  transform:
                    i === 0
                      ? 'none'
                      : i === ticks.length - 1
                        ? 'translateX(-100%)'
                        : 'translateX(-50%)',
                  fontSize: 14,
                }}
              >
                {t}%
              </span>
            ))}
          </div>
        </div>
        <div className={VALUE_COL} />
      </div>
    </ChartCard>
  );
}
