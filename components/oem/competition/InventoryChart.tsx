'use client';

/**
 * 딜러 재고일수 비교 — 대상 브랜드 vs 경쟁 브랜드.
 *
 * 재고일수는 "지금 팔리는 속도로 딜러 재고를 소진하는 데 걸리는 날"이라 값 하나만 보면 해석이
 * 안 되고 **옆에 뭐가 있느냐**로 읽힌다. 그래서 순위형 가로 막대로 나란히 세우고, 절대 기준
 * 하나(업계 통상선)를 세로 점선으로 겹쳐 상대·절대 두 방향을 한 화면에서 읽게 했다.
 */
import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
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
import { evaluateMarket, SIGNAL_THRESHOLDS, targetInventory } from '@/lib/oem-competition/signals';
import type { Signal } from '@/lib/oem-competition/signals';
import type { CompetitionMarket, InventoryPoint } from '@/lib/oem-competition/types';
import {
  ChartCard,
  EmptyChart,
  fmtYmFull,
  rivalColor,
  shortModel,
  SignalDot,
  TARGET_COLOR,
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
}

/** 신호등 임계값(75/110일)과는 별개인 업계 관행선. 이 값 하나만 바꾸면 선·문구가 함께 따라온다. */
const INDUSTRY_NORMAL_DAYS = 60;

/** '일' 을 문자열로 박으면 임계값 문구와 갈린다 — 단위도 상수에서 가져온다. */
const UNIT = SIGNAL_THRESHOLDS.inventory.unit;

const DOT_SIZE = 10;
/** 막대 끝 ↔ 신호등 점 ↔ 숫자 사이 여백(px). 라벨 좌표를 직접 계산하므로 상수로 둔다. */
const LABEL_GAP = 8;

function buildRows(inventory: InventoryPoint[]): InventoryRow[] {
  const target = targetInventory(inventory);
  if (!target) return [];

  // model 이 있으면 경쟁 차종. 배열 순서가 곧 판매 순위라 rivalColor(i) 를 여기서 확정해야
  // 아래에서 재고일수 순으로 다시 정렬해도 다른 차트와 색이 어긋나지 않는다.
  const rivals = inventory.filter((p): p is InventoryPoint & { model: string } => Boolean(p.model));

  const rows: InventoryRow[] = [
    {
      key: 'target',
      // 대상은 브랜드만 알고 차종 매칭이 없다 — 차종명을 지어내지 않는다.
      label: `${target.brand} (대상)`,
      days: target.days_supply,
      ym: target.year_month,
      color: TARGET_COLOR,
      isTarget: true,
    },
    ...rivals.map((r, i) => ({
      key: `${r.brand}-${r.model}-${i}`,
      label: `${shortModel(r.model)} (${r.brand})`,
      days: r.days_supply,
      ym: r.year_month,
      color: rivalColor(i),
      isTarget: false,
    })),
  ];

  // 재고 부담이 큰 순. 이 차트의 질문은 "누가 무거운가"라 순위가 곧 답이고,
  // 대상은 색으로 이미 도드라져 위치가 바뀌어도 놓치지 않는다.
  return rows.sort((a, b) => b.days - a.days);
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
  const target = useMemo(() => targetInventory(market.inventory), [market.inventory]);
  const rows = useMemo(() => buildRows(market.inventory), [market.inventory]);
  const inventorySignal = useMemo(
    () => evaluateMarket(market).find((r) => r.key === 'inventory') ?? null,
    [market]
  );

  // Cox 는 값이 업계평균을 크게 벗어난 달을 비워 두고, 수집기는 브랜드별 **최신 non-null** 월을
  // 집는다(`_load_inventory_by_brand`) → 막대마다 기준월이 다를 수 있다. 하나의 기준월인 척하면
  // 서로 다른 달을 같은 달처럼 비교하게 되므로, 섞였을 때는 그 사실을 화면에 적는다.
  const mixedMonth = new Set(rows.map((r) => r.ym)).size > 1;
  const anchor = target ? ` · 대상 ${fmtYmFull(target.year_month)} 기준` : '';
  const subtitle = (
    <>
      미국 시장 · 브랜드 단위(차종 아님) · Cox Automotive{anchor}
      <br />
      같은 브랜드의 다른 차종에도 같은 값이 쓰인다 — 이 차종만의 재고가 아니다.
      {mixedMonth && (
        <>
          <br />
          브랜드별 최신 집계월이 서로 다르다 — 같은 달끼리의 비교가 아니다.
        </>
      )}
    </>
  );

  if (rows.length === 0) {
    return (
      <ChartCard title="딜러 재고일수" subtitle={subtitle}>
        <EmptyChart reason="Cox 재고일수 미제공 (미국 미판매 브랜드이거나 Cox 로스터에 없음)" />
      </ChartCard>
    );
  }

  const legendItems = [
    { key: 'target', label: '대상 브랜드', shape: 'rect' as const, color: TARGET_COLOR },
    ...(rows.length > 1
      ? [{ key: 'rival', label: '경쟁 브랜드', shape: 'rect' as const, color: rivalColor(0) }]
      : []),
  ];

  return (
    <ChartCard title="딜러 재고일수" subtitle={subtitle}>
      <ResponsiveContainer width="100%" height={h}>
        <BarChart data={rows} layout="vertical" margin={{ top: 5, right: 90, bottom: 5, left: 10 }}>
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
            formatter={(v) => [`${fmtFull(Number(v))}${UNIT}`, '재고일수']}
            cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
            contentStyle={TOOLTIP_CONTENT_STYLE}
          />
          <Legend
            verticalAlign="top"
            align="center"
            wrapperStyle={{ paddingBottom: 8 }}
            content={() => <LegendRow items={legendItems} />}
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
