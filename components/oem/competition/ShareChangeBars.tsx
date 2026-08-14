'use client';

/**
 * 경쟁군 내 점유율 변화 — 차종 한 줄에 **가로 막대 두 개**(전년 동기 / 현재)를 나란히.
 *
 * 앞서 두 번 다른 그림을 시도했다: ①점 두 개를 잇는 덤벨 → 어느 쪽이 현재인지 매번 범례를 봐야
 * 했고, ②현재 끝을 화살촉으로 바꾼 덤벨 → 방향은 읽히지만 **길이가 곧 값이 아니라서** "얼마나
 * 큰가"가 전달되지 않았다(사용자 지적 2026-08-14: *"여전히 전달이 잘 안되네"*).
 *
 * 막대는 원점에서 뻗으므로 **길이 = 점유율**이 그대로 읽히고, 두 막대의 길이 차가 곧 변화량이다.
 * 사람이 각도·위치보다 길이를 훨씬 정확히 비교한다는 점에서도 여기서는 막대가 맞다.
 * 과거 막대는 **같은 색의 옅은 톤 + 윤곽선** — 계획/실적 대비에서 이미 쓰는 문법이다
 * (docs/chart-guide.md §5-A "같은 색의 투명도 변형").
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
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
import { useHiddenSeries } from '@/components/oem-companies/common/useHiddenSeries';
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

/**
 * 경쟁 차종은 **전부 같은 회색**을 쓴다. 차종 이름이 y축에 이미 붙어 있어 색으로 다시 구별할
 * 필요가 없고, 옅은 회색(`rivalColor` 뒤쪽 값)에 다시 28% 투명도를 먹이면 과거 막대가 배경에
 * 묻혀 사라진다.
 */
const RIVAL_BAR_COLOR = rivalColor(0);

/** 과거 막대의 채움 투명도. 윤곽선을 함께 그려 다크모드에서도 형태가 남는다. */
const PREV_FILL_OPACITY = 0.28;

/**
 * 축 최대값 후보와 그 눈금 간격. 간격까지 함께 정하는 이유는 recharts 자동 눈금이 상한을
 * 배수로 나누지 않기 때문이다 — 상한 30 에서 `0·8·16·24·30` 이 나와 마지막 칸만 좁았다
 * (2026-08-14 화면 확인).
 */
const AXIS_SCALES = [
  { max: 10, step: 5 },
  { max: 20, step: 5 },
  { max: 30, step: 10 },
  { max: 40, step: 10 },
  { max: 50, step: 10 },
  { max: 60, step: 20 },
  { max: 80, step: 20 },
  { max: 100, step: 25 },
] as const;

/** "14.1% (+1.8%p)" 라벨이 잘리지 않을 만큼의 오른쪽 여백(px). */
const LABEL_MARGIN = 118;

/**
 * y축 라벨 칸 — 차종명 + 판매대수 두 줄이 들어간다.
 * 104px 로는 'Grand Cherokee'·'Grand Highlander' 가 잘렸다(2026-08-14 화면 확인) → 넓혔다.
 * 13px 기준 영문 ≈7px/자 · 한글 ≈13px/자 이므로 아래 잘림 한도(18자)와 짝을 맞춰 둔다.
 */
const Y_AXIS_WIDTH = 140;

/** 이 글자 수를 넘으면 말줄임(전체 이름은 `<title>` 로 마우스 오버에 나온다). */
const MODEL_NAME_MAX = 18;

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
  return active.models.map((m) => ({
    model: shortModel(m.isTarget ? targetName : m.model),
    isTarget: m.isTarget,
    sales: m.sales,
    prevSales: m.prevSales,
    yoyPct: m.yoyPct,
    cur: m.sharePct,
    prev: m.prevSharePct,
    color: m.isTarget ? TARGET_COLOR : RIVAL_BAR_COLOR,
  }));
}

/** 월별 뷰에 이 시장이 없을 때의 폴백 — 저장 스냅샷 + YoY 역산. */
function rowsFromSnapshot(market: CompetitionMarket, total: number): ShareRow[] {
  const { sharePct, prevSharePct } = market;
  // competitors 와 share_pct 는 서로 다른 JSONB 컬럼에서 오므로 "경쟁군은 비었는데 점유율은 있는"
  // 상태가 실제로 나온다. 그대로 그리면 대상 혼자 선 막대에 "경쟁군 합계 = 대상 판매량"이 붙는다.
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
    ...market.competitors.map((c) => {
      const prevSales = prevSalesFromYoy(c.sales, c.yoy_pct);
      return {
        model: shortModel(c.model),
        isTarget: false,
        sales: c.sales,
        prevSales,
        yoyPct: c.yoy_pct,
        cur: (c.sales / total) * 100,
        prev: prevSales !== null && prevTotal !== null ? (prevSales / prevTotal) * 100 : null,
        color: RIVAL_BAR_COLOR,
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

/** 차트에 넘기는 행 — 라벨 문자열까지 미리 만들어 두면 렌더러가 계산을 다시 하지 않는다. */
interface ChartRow extends ShareRow {
  delta: number | null;
  curLabel: string;
  prevLabel: string;
}

function toChartRows(rows: ShareRow[]): ChartRow[] {
  return rows.map((r) => {
    const delta = r.prev === null ? null : r.cur - r.prev;
    return {
      ...r,
      delta,
      curLabel: `${fmtLevel(r.cur)}${delta === null ? '' : ` (${fmtPp(delta)})`}`,
      prevLabel: fmtLevel(r.prev),
    };
  });
}

/**
 * y축 라벨 — 차종명 + 판매대수 두 줄. recharts 기본 tick 은 한 줄뿐이라 직접 그린다.
 * 대상 차종은 굵게·파랑으로 두어 스크롤 중에도 자기 차를 바로 찾는다.
 */
function ModelTick({
  x,
  y,
  payload,
  rows,
}: {
  x?: number;
  y?: number;
  payload?: { value?: string | number };
  rows: ChartRow[];
}) {
  const name = String(payload?.value ?? '');
  const row = rows.find((r) => r.model === name);
  const cx = (x ?? 0) - 6;
  return (
    <g>
      {/* 잘린 이름은 마우스를 올려 전체를 볼 수 있어야 한다(svg 는 title 자식이 곧 툴팁). */}
      <title>{name}</title>
      <text
        x={cx}
        y={(y ?? 0) - 3}
        textAnchor="end"
        fontSize={13}
        fontWeight={row?.isTarget ? 700 : 400}
        fill={row?.isTarget ? TARGET_COLOR : 'var(--foreground)'}
      >
        {name.length > MODEL_NAME_MAX ? `${name.slice(0, MODEL_NAME_MAX)}…` : name}
      </text>
      <text x={cx} y={(y ?? 0) + 12} textAnchor="end" fontSize={11} fill="var(--muted-foreground)">
        {row ? `${fmtUnits(row.sales)}대` : ''}
      </text>
    </g>
  );
}

/**
 * props 를 옵셔널로 좁혀 받는다 — recharts v3 의 `TooltipContentProps` 를 그대로 쓰면
 * `content={<X />}` 자리에서 "필수 props 누락"으로 걸린다(주입은 런타임에 일어난다).
 * 같은 이유로 `PositionBubble` 등 기존 커스텀 툴팁도 전부 이 형태다.
 */
function ShareTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartRow }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded px-2 py-1 text-xs" style={TOOLTIP_CONTENT_STYLE}>
      <div className="font-medium">{row.model}</div>
      <div className="text-muted-foreground">
        판매 {row.prevSales !== null ? `${fmtFull(Math.round(row.prevSales))}대 → ` : ''}
        {fmtFull(row.sales)}대 · YoY {fmtPct(row.yoyPct)}
      </div>
      <div className="text-muted-foreground">
        점유율 {fmtLevel(row.prev)} → {fmtLevel(row.cur)} {fmtPp(row.delta)}
      </div>
    </div>
  );
}

/** 현재 막대 오른쪽 라벨 — 증감 부호에 따라 색이 갈려야 상승/하락이 글자로도 읽힌다. */
function CurLabel({
  x,
  y,
  width,
  height,
  index,
  rows,
}: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  rows: ChartRow[];
}) {
  const row = rows[index ?? -1];
  if (!row) return null;
  const color =
    row.delta === null || row.delta === 0
      ? 'var(--foreground)'
      : row.delta > 0
        ? RISE_COLOR
        : FALL_COLOR;
  return (
    <text
      x={(x ?? 0) + (width ?? 0) + 6}
      y={(y ?? 0) + (height ?? 0) / 2}
      dominantBaseline="central"
      // 🔴 색은 반드시 style 안에서 덮는다 — `DATA_LABEL_STYLE` 이 `fill: var(--foreground)` 를
      // CSS 로 들고 있어서, `fill=` **속성**으로 주면 CSS 가 이겨 전부 검정으로 나온다
      // (2026-08-14 화면 확인. 타입·lint 는 통과한다).
      style={{ ...DATA_LABEL_STYLE, fill: color }}
    >
      {row.curLabel}
    </text>
  );
}

export interface ShareChangeBarsProps {
  market: CompetitionMarket;
}

export default function ShareChangeBars({ market }: ShareChangeBarsProps) {
  // 행 수가 경쟁군 크기(최대 9종)에 따라 달라져 총 높이를 고정할 수 없다 → 한 줄 높이를 폭에
  // 맞추고 행 수를 곱한다(useChartHeight 3-tier 는 행 수가 고정된 차트를 전제한다).
  const rowHeight = useChartHeight(48, 56, 64);
  const { active, options, basis, setBasis } = usePeriodBasis(market.periods);
  const { hidden, isHidden, toggle } = useHiddenSeries();

  const snapshotTotal = market.sales + market.competitors.reduce((acc, c) => acc + c.sales, 0);
  const allRows = active
    ? rowsFromPeriod(active, targetModelName(market))
    : rowsFromSnapshot(market, snapshotTotal);
  const rows = toChartRows(allRows);

  const total = active ? active.totalSales : snapshotTotal;
  const prevTotal = active ? active.prevTotalSales : null;

  const periodToggle = (
    <SegmentedToggle options={options} value={basis} onChange={setBasis} ariaLabel="집계 기준" />
  );

  if (rows.length === 0) {
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
  const maxShare = Math.max(...rows.flatMap((r) => (r.prev === null ? [r.cur] : [r.cur, r.prev])));
  const scale = AXIS_SCALES.find((s) => s.max >= maxShare) ?? AXIS_SCALES[AXIS_SCALES.length - 1];
  const ticks = Array.from({ length: scale.max / scale.step + 1 }, (_, i) => i * scale.step);

  // 비교 대상이 무엇인지 숫자로 못 박는다 — "합계 대비"만 쓰면 분모가 작년 것인지 올해 것인지
  // 알 수 없다(사용자 지시 2026-08-14).
  const subtitle = `${basisPeriodLabel(market, active)} · 경쟁군 합계 ${fmtUnits(total)}대${
    prevTotal !== null && prevTotal > 0 ? ` (전년 동기 ${fmtUnits(prevTotal)}대)` : ''
  } 대비${active ? '' : ' · 경쟁 차종의 전년 점유율은 YoY로 역산한 값'}`;

  // 범례 색만으로는 "옅은 = 과거"를 알 수 없다(대상의 과거 막대는 옅은 파랑, 경쟁은 옅은 회색이라
  // 한 가지 색으로 대표할 수 없다) → 라벨에 채움 농도를 함께 적는다.
  // 🔴 색은 견본뿐 아니라 `LegendRow` 의 **글자색**이기도 하다 — 옅은 회색을 주면 라벨이 안 읽힌다
  // (2026-08-14 화면 확인). 농도는 글자로 알리고 색은 읽히는 값을 쓴다.
  const legendItems = [
    {
      key: 'prev',
      label: '전년 동기(옅은 막대)',
      shape: 'rect' as const,
      color: 'var(--muted-foreground)',
    },
    { key: 'cur', label: '현재(진한 막대)', shape: 'rect' as const, color: TARGET_COLOR },
  ];

  return (
    <ChartCard title="경쟁군 내 점유율 변화" subtitle={subtitle} actions={periodToggle}>
      <LegendRow items={legendItems} hidden={hidden} onToggle={toggle} />
      <ResponsiveContainer width="100%" height={rows.length * rowHeight + 32}>
        <BarChart
          data={rows}
          layout="vertical"
          barCategoryGap="24%"
          barGap={2}
          margin={{ top: 4, right: LABEL_MARGIN, bottom: 4, left: 4 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            horizontal={false}
            className="stroke-border"
            strokeOpacity={GRID_STROKE_OPACITY}
          />
          <XAxis
            type="number"
            domain={[0, scale.max]}
            ticks={ticks}
            tickFormatter={(v: number) => `${v}%`}
            tick={{ fontSize: 13, fill: 'var(--muted-foreground)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="model"
            width={Y_AXIS_WIDTH}
            tick={<ModelTick rows={rows} />}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<ShareTooltip />} cursor={{ fill: 'var(--muted)', opacity: 0.3 }} />
          <Bar
            dataKey="prev"
            name="전년 동기"
            hide={isHidden('prev')}
            isAnimationActive={false}
            radius={[0, 2, 2, 0]}
          >
            {rows.map((r) => (
              <Cell
                key={r.model}
                fill={r.color}
                fillOpacity={PREV_FILL_OPACITY}
                stroke={r.color}
                strokeWidth={1}
              />
            ))}
            <LabelList
              dataKey="prevLabel"
              position="right"
              offset={6}
              style={{ fill: 'var(--muted-foreground)', fontSize: 13 }}
            />
          </Bar>
          <Bar
            dataKey="cur"
            name="현재"
            hide={isHidden('cur')}
            isAnimationActive={false}
            radius={[0, 2, 2, 0]}
          >
            {rows.map((r) => (
              <Cell key={r.model} fill={r.color} />
            ))}
            <LabelList dataKey="cur" content={<CurLabel rows={rows} />} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
