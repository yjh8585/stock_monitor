'use client';

/**
 * 경쟁군 내 점유율의 이동 — 차종 한 줄에 덤벨 하나, 현재 쪽 끝은 **화살촉**이다.
 *
 * 전년·현재를 막대 두 개로 세우면 "얼마나 움직였나"를 눈으로 빼야 하지만, 덤벨은 이동 자체가
 * 선분의 길이·색으로 바로 읽힌다. 다만 점 두 개만으로는 어느 쪽이 현재인지 매번 범례를 봐야 해서
 * 현재 끝을 화살촉으로 바꿨다(사용자 선택 2026-08-14) — 방향이 곧 상승/하락이다.
 *
 * recharts 에는 덤벨 프리미티브가 없어 산점+에러바로 흉내 내야 하는데, 행마다 차종명과 정확한
 * 수치를 붙이는 이 레이아웃에서는 div/CSS 가 더 짧고 정확하다.
 * (docs/chart-guide.md §7-2 의 "카테고리 축" 레시피가 다루지 못하는 형태)
 */
import { useState, type ReactNode } from 'react';
import { TOOLTIP_CONTENT_STYLE } from '@/components/charts/chartTheme';
import { LegendRow } from '@/components/charts/ChartLegend';
import { GRID_STROKE_OPACITY } from '@/components/oem-companies/common/chartStyle';
import { fmtFull, fmtUnits } from '@/components/oem/helpers';
import type { CompetitionMarket, PeriodAggregate } from '@/lib/oem-competition/types';
import { useChartHeight } from '@/lib/useChartHeight';
import {
  basisPeriodLabel,
  ChartCard,
  EmptyChart,
  fmtLevel,
  fmtPct,
  fmtPp,
  rivalColor,
  SegmentedToggle,
  shortModel,
  SIGNAL_COLORS,
  TARGET_COLOR,
  targetModelName,
  usePeriodBasis,
} from './shared';

/** 점유율 상승은 신호등의 GREEN 과 같은 뜻이라 색을 새로 만들지 않고 그대로 쓴다. */
const RISE_COLOR = SIGNAL_COLORS.GREEN;
const FALL_COLOR = SIGNAL_COLORS.RED;

/** 세 열의 폭은 본문 행과 축 행이 정확히 같아야 눈금이 점과 어긋나지 않는다. */
const LABEL_COL = 'w-20 shrink-0 sm:w-28';
/** "12.3% → 14.1% (+1.8%p)" 를 접지 않고 다 싣기 위한 폭(사용자 지시 2026-08-14). */
const VALUE_COL = 'w-36 shrink-0 sm:w-52';
const TRACK_COL = 'min-w-0 flex-1 px-2';

/** 축 최대값 후보. 어느 값을 골라도 절반이 정수라 눈금 라벨이 지저분해지지 않는다. */
const AXIS_STEPS = [10, 20, 30, 40, 50, 60, 80, 100];

interface ShareRow {
  model: string;
  isTarget: boolean;
  sales: number;
  /** 전년 동기 판매. 역산으로도 못 구하면 null. */
  prevSales: number | null;
  yoyPct: number | null;
  /** 현재 점유율(%) */
  cur: number;
  /** 전년 점유율(%). 전년 실적을 모르면 null. */
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

/**
 * 월별 뷰 재집계에서 바로 만든다 — 전년 판매·점유율을 **실제로 알고 있어** 역산이 필요 없다.
 * (아래 폴백 경로는 저장 스냅샷뿐일 때만 쓰이고, 거기서는 YoY 로 되돌린 근사값이다.)
 */
function rowsFromPeriod(active: PeriodAggregate, targetName: string): ShareRow[] {
  let rivalIndex = 0;
  return active.models.map((m) => ({
    model: shortModel(m.isTarget ? targetName : m.model),
    isTarget: m.isTarget,
    sales: m.sales,
    prevSales: m.prevSales,
    yoyPct: m.yoyPct,
    cur: m.sharePct,
    prev: m.prevSharePct,
    color: m.isTarget ? TARGET_COLOR : rivalColor(rivalIndex++),
  }));
}

/** 월별 뷰에 이 시장이 없을 때의 폴백 — 저장 스냅샷 + YoY 역산. */
function rowsFromSnapshot(market: CompetitionMarket, total: number): ShareRow[] {
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
      prevSales: targetPrevSales,
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
        prevSales,
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

/**
 * 현재 위치 표식 — 이동 방향으로 향한 화살촉.
 *
 * clip-path 로 삼각형을 만든다. border 트릭보다 크기·색을 한 곳에서 다루기 쉽고, 방향 전환이
 * 폴리곤 좌표 한 줄이라 좌우 두 벌을 따로 관리하지 않아도 된다.
 */
function ArrowHead({
  left,
  color,
  size,
  dir,
}: {
  left: number;
  color: string;
  size: number;
  dir: 'right' | 'left';
}) {
  return (
    <span
      className="absolute"
      style={{
        left: `${left}%`,
        top: '50%',
        width: size,
        height: size,
        marginLeft: dir === 'right' ? -size * 0.65 : -size * 0.35,
        marginTop: -size / 2,
        backgroundColor: color,
        clipPath:
          dir === 'right' ? 'polygon(0 0, 100% 50%, 0 100%)' : 'polygon(100% 0, 0 50%, 100% 100%)',
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
    <span className="inline-block h-[4px] w-4 rounded-full" style={{ backgroundColor: color }} />
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

function LegendArrow({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5"
      style={{ backgroundColor: color, clipPath: 'polygon(0 0, 100% 50%, 0 100%)' }}
    />
  );
}

export interface ShareDumbbellProps {
  market: CompetitionMarket;
}

export default function ShareDumbbell({ market }: ShareDumbbellProps) {
  // 행 수가 경쟁군 크기(최대 9종)에 따라 달라져 총 높이를 고정할 수 없다 → 한 줄 높이를 폭에 맞춘다.
  const rowHeight = useChartHeight(34, 38, 42);
  const { active, options, basis, setBasis } = usePeriodBasis(market.periods);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());

  const snapshotTotal = market.sales + market.competitors.reduce((acc, c) => acc + c.sales, 0);
  const allRows = active
    ? rowsFromPeriod(active, targetModelName(market))
    : rowsFromSnapshot(market, snapshotTotal);
  const rows = allRows.filter((r) => !hidden.has(r.isTarget ? 'target' : 'rival'));

  const total = active ? active.totalSales : snapshotTotal;
  const prevTotal = active ? active.prevTotalSales : null;

  const periodToggle = (
    <SegmentedToggle options={options} value={basis} onChange={setBasis} ariaLabel="집계 기준" />
  );

  if (allRows.length === 0) {
    return (
      <ChartCard
        title="경쟁군 내 점유율 변화"
        subtitle={basisPeriodLabel(market, active) || undefined}
        actions={periodToggle}
      >
        <EmptyChart reason={emptyReason(market, snapshotTotal)} />
      </ChartCard>
    );
  }

  // prev 가 없는 행은 축 계산에서 아예 뺀다 — 0 을 대신 넣으면 '전년 점유율 0%'를 사실처럼 다루게 된다.
  const maxShare = Math.max(
    ...allRows.flatMap((r) => (r.prev === null ? [r.cur] : [r.cur, r.prev]))
  );
  const axisMax = AXIS_STEPS.find((s) => s >= maxShare) ?? 100;
  const ticks = [0, axisMax / 2, axisMax];
  const pos = (value: number) => (value / axisMax) * 100;

  // 비교 대상이 무엇인지 숫자로 못 박는다 — "합계 대비"만 쓰면 분모가 작년 것인지 올해 것인지
  // 알 수 없다(사용자 지시 2026-08-14).
  const subtitle = `${basisPeriodLabel(market, active)} · 경쟁군 합계 ${fmtUnits(total)}대${
    prevTotal !== null && prevTotal > 0 ? ` (전년 동기 ${fmtUnits(prevTotal)}대)` : ''
  } 대비${active ? '' : ' · 경쟁 차종의 전년 점유율은 YoY로 역산한 값'}`;

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

  return (
    <ChartCard title="경쟁군 내 점유율 변화" subtitle={subtitle} actions={periodToggle}>
      <LegendRow items={legendItems} hidden={hidden} onToggle={toggle} />
      <div
        className="mt-1 mb-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1"
        style={{ fontSize: 13 }}
      >
        <LegendItem swatch={<LegendDot color="var(--muted-foreground)" />} label="과거" />
        <LegendItem swatch={<LegendArrow color={TARGET_COLOR} />} label="현재(화살촉)" />
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
                      className="absolute rounded-full"
                      style={{
                        left: `${pos(Math.min(row.prev, row.cur))}%`,
                        width: `${Math.abs(pos(row.cur) - pos(row.prev))}%`,
                        top: '50%',
                        height: 4,
                        marginTop: -2,
                        backgroundColor: lineColor,
                      }}
                    />
                  )}
                  {row.prev !== null && (
                    <Dot left={pos(row.prev)} color="var(--muted-foreground)" size={9} />
                  )}
                  {/* 이동이 없거나 전년을 모르면 방향이 없다 → 화살촉 대신 점을 찍는다. */}
                  {delta === null || delta === 0 ? (
                    <Dot left={pos(row.cur)} color={row.color} size={row.isTarget ? 13 : 11} />
                  ) : (
                    <ArrowHead
                      left={pos(row.cur)}
                      color={row.color}
                      size={row.isTarget ? 15 : 12}
                      dir={delta > 0 ? 'right' : 'left'}
                    />
                  )}
                </div>
              </div>

              <div
                className={`${VALUE_COL} flex items-center justify-end gap-1 text-[11px] tabular-nums sm:text-xs`}
              >
                {/* 과거 → 현재 (증감) 를 좁은 화면에서도 접지 않는다(사용자 지시 2026-08-14). */}
                <span className="text-muted-foreground">{fmtLevel(row.prev)}</span>
                <span className="text-muted-foreground">→</span>
                <span className={row.isTarget ? 'font-semibold' : ''}>{fmtLevel(row.cur)}</span>
                <span
                  className="font-medium"
                  style={{
                    color:
                      delta === null
                        ? 'var(--muted-foreground)'
                        : delta < 0
                          ? FALL_COLOR
                          : RISE_COLOR,
                  }}
                >
                  ({fmtPp(delta)})
                </span>
              </div>

              <div
                className="pointer-events-none absolute top-full left-1/2 z-20 hidden -translate-x-1/2 rounded px-2 py-1 whitespace-nowrap group-hover:block"
                style={TOOLTIP_CONTENT_STYLE}
              >
                <div className="font-medium">{row.model}</div>
                <div className="text-muted-foreground">
                  판매 {row.prevSales !== null ? `${fmtFull(Math.round(row.prevSales))}대 → ` : ''}
                  {fmtFull(row.sales)}대 · YoY {fmtPct(row.yoyPct)}
                </div>
                <div className="text-muted-foreground">
                  점유율 {fmtLevel(row.prev)} → {fmtLevel(row.cur)} {fmtPp(delta)}
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
