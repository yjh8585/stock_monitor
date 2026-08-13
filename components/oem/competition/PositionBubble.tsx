'use client';

/**
 * 시장 내 위치 — 판매 증감률(x) × 경쟁군 내 점유율(y) × 판매량(원 크기).
 *
 * 표·시계열로는 "잘 팔리는가"와 "커지고 있는가"를 따로 봐야 하는데, 경쟁에서 실제로 문제가 되는
 * 조합은 그 둘의 교차(작은데 줄고 있다 / 큰데 줄고 있다)다. 한 평면에 얹어야 그 조합이 보인다.
 *
 * 규모를 y축이 아니라 원 크기로 둔 이유: 판매량을 축으로 쓰면 대형 차종 1~2개가 축을 독점해
 * 나머지가 뭉개진다. 크기는 순위 감각만 주면 충분하다.
 */
import {
  CartesianGrid,
  LabelList,
  Legend,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import { TOOLTIP_CONTENT_STYLE } from '@/components/charts/chartTheme';
import { GRID_STROKE_OPACITY } from '@/components/oem-companies/common/chartStyle';
import { fmtFull, fmtUnits } from '@/components/oem/helpers';
import { useChartHeight } from '@/lib/useChartHeight';
import type { CompetitionMarket } from '@/lib/oem-competition/types';
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

interface BubblePoint {
  /** 차트에 찍는 라벨(축약형). 툴팁은 fullName 을 쓴다. */
  name: string;
  fullName: string;
  /** X: 판매 증감률(%) */
  yoy: number;
  /** Y: 경쟁군 내 점유율(%) */
  share: number;
  /** Z: 누계 판매량(대) — 원 크기 */
  sales: number;
  isTarget: boolean;
  /** 라벨을 원 아래에 그릴지 — 차트 상단에 붙은 점의 라벨이 잘리는 것만 피한다. */
  labelBelow: boolean;
}

/** 사분면 음영 색 — docs/chart-guide.md §5-A 의 강조 양수/음수 값(다크모드에서도 0.08 이면 뭉개지지 않는다). */
const POSITIVE_FILL = '#3b82f6';
const NEGATIVE_FILL = '#ef4444';

/** 점이 하나뿐이면 min=max 라 축 폭이 0이 되어 recharts 가 눈금을 못 만든다. */
function paddedDomain(lo: number, hi: number, ratio = 0.12): [number, number] {
  if (hi - lo < 1e-9) return [lo - 1, hi + 1];
  const pad = (hi - lo) * ratio;
  return [lo - pad, hi + pad];
}

/**
 * 대상 차종 이름 — market 에는 이름 필드가 따로 없어 시계열/소비자평가의 대상 플래그에서 꺼낸다.
 * 둘 다 비어 있어도 점 하나는 그려야 하므로 마지막에 총칭으로 떨어진다.
 */
function targetName(market: CompetitionMarket): string {
  return (
    market.series.find((s) => s.isTarget)?.model ??
    market.consumerScores.find((s) => s.is_target)?.model ??
    '대상 차종'
  );
}

export default function PositionBubble({ market }: { market: CompetitionMarket }) {
  const h = useChartHeight(280, 380, 460);

  const rivals = market.competitors;
  /**
   * 점유율 분모는 "대상 + 모든 경쟁"이다. 증감률이 없어 차트에서 빠지는 차종도 분모에는 남긴다 —
   * 빼면 남은 차종의 점유율이 실제보다 부풀려져 KPI(market.sharePct)와 어긋난다.
   *
   * 판매량은 검증 없이 캐스팅된 JSONB 원본(`source.ts` 의 `asArray`)이라 숫자가 아닐 수 있다.
   * 그대로 더하면 합계가 NaN 이 되고, `NaN > 0` 이 false 라 **모든 점유율이 조용히 0** 으로
   * 떨어진다(= 모르는 값을 0 으로 뭉갠다). 유한한 값만 더해 그 경로를 막는다.
   */
  const total = [market.sales, ...rivals.map((c) => c.sales)]
    .filter((n) => Number.isFinite(n))
    .reduce((sum, n) => sum + n, 0);

  const raw: Omit<BubblePoint, 'labelBelow'>[] = [
    {
      name: shortModel(targetName(market)),
      fullName: targetName(market),
      yoy: market.yoyPct ?? Number.NaN,
      share: total > 0 ? (market.sales / total) * 100 : 0,
      sales: market.sales,
      isTarget: true,
    },
    ...rivals.map((c) => ({
      name: shortModel(c.model),
      fullName: c.model,
      yoy: c.yoy_pct ?? Number.NaN,
      share: total > 0 ? (c.sales / total) * 100 : 0,
      sales: c.sales,
      isTarget: false,
    })),
  ];

  // 증감률이 null 이면 x 좌표 자체가 없다. 0 으로 놓으면 "보합"이라는 없는 사실을 그리게 된다.
  // 판매량이 숫자가 아니면 원 크기(z)를 정할 수 없고 maxSales 까지 NaN 으로 만들므로 같이 뺀다.
  const plotted = raw.filter((p) => Number.isFinite(p.yoy) && Number.isFinite(p.sales));
  const droppedCount = raw.length - plotted.length;
  const targetDropped = !plotted.some((p) => p.isTarget);

  // 균등 점유율(=100/차종수). 점유율에는 0 같은 자연 기준선이 없어 "몫을 균등하게 나눴을 때"를 기준으로 삼는다.
  const evenShare = raw.length > 0 ? 100 / raw.length : 0;

  const xDomain = paddedDomain(
    Math.min(0, ...plotted.map((p) => p.yoy)),
    Math.max(0, ...plotted.map((p) => p.yoy))
  );
  // 기준선이 도메인 밖이면 사분면 음영이 잘리므로 evenShare 를 범위에 포함시킨다.
  const yRaw = paddedDomain(
    Math.min(evenShare, ...plotted.map((p) => p.share)),
    Math.max(evenShare, ...plotted.map((p) => p.share))
  );
  const yDomain: [number, number] = [Math.max(0, yRaw[0]), yRaw[1]];

  const yTop = yDomain[1] - (yDomain[1] - yDomain[0]) * 0.12;
  const points: BubblePoint[] = plotted.map((p) => ({ ...p, labelBelow: p.share > yTop }));
  const targetPoints = points.filter((p) => p.isTarget);
  const rivalPoints = points.filter((p) => !p.isTarget);
  const maxSales = Math.max(1, ...points.map((p) => p.sales));

  const subtitle = (
    <>
      가로 = 판매 증감률 · 세로 = 경쟁군 내 점유율 · 원 크기 = 판매량
      {periodLabel(market) ? ` · ${periodLabel(market)}` : ''}
    </>
  );

  if (rivals.length === 0) {
    return (
      <ChartCard title={`시장 내 위치 · ${market.label}`} subtitle={subtitle}>
        <EmptyChart reason="경쟁 차종 데이터가 없어 시장 내 위치를 그릴 수 없습니다." />
      </ChartCard>
    );
  }
  // 조건을 뒤집어 둔 것은 NaN 때문이다 — `NaN <= 0` 은 false 라 그대로 두면 빈 차트를 그린다.
  if (!(total > 0)) {
    return (
      <ChartCard title={`시장 내 위치 · ${market.label}`} subtitle={subtitle}>
        <EmptyChart reason="경쟁군 판매량 합계가 0이라 점유율을 계산할 수 없습니다." />
      </ChartCard>
    );
  }
  if (points.length === 0) {
    return (
      <ChartCard title={`시장 내 위치 · ${market.label}`} subtitle={subtitle}>
        <EmptyChart
          reason={`판매 증감률·판매량을 함께 아는 차종이 없습니다(${raw.length}종 전부 미상).`}
        />
      </ChartCard>
    );
  }

  const xSpan = xDomain[1] - xDomain[0];
  const ySpan = yDomain[1] - yDomain[0];
  const fmtAxis = (v: number, span: number) => `${v.toFixed(span < 10 ? 1 : 0)}%`;

  return (
    <ChartCard title={`시장 내 위치 · ${market.label}`} subtitle={subtitle}>
      <ResponsiveContainer width="100%" height={h}>
        <ScatterChart margin={{ top: 16, right: 24, bottom: 10, left: 10 }}>
          {/* 오른쪽 위(성장 + 균등 이상 점유) 파랑, 왼쪽 아래(역성장 + 균등 미만) 빨강 */}
          <ReferenceArea
            x1={0}
            x2={xDomain[1]}
            y1={evenShare}
            y2={yDomain[1]}
            fill={POSITIVE_FILL}
            fillOpacity={0.08}
            stroke="none"
            ifOverflow="visible"
          />
          <ReferenceArea
            x1={xDomain[0]}
            x2={0}
            y1={yDomain[0]}
            y2={evenShare}
            fill={NEGATIVE_FILL}
            fillOpacity={0.08}
            stroke="none"
            ifOverflow="visible"
          />
          <CartesianGrid
            strokeDasharray="3 3"
            className="stroke-border"
            strokeOpacity={GRID_STROKE_OPACITY}
          />
          <XAxis
            type="number"
            dataKey="yoy"
            domain={xDomain}
            tickFormatter={(v: number) => fmtAxis(v, xSpan)}
            tick={{ fontSize: 14 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="number"
            dataKey="share"
            domain={yDomain}
            tickFormatter={(v: number) => fmtAxis(v, ySpan)}
            tick={{ fontSize: 14 }}
            axisLine={false}
            tickLine={false}
            width={52}
          />
          <ZAxis
            type="number"
            dataKey="sales"
            range={[80, 800]}
            domain={[0, maxSales]}
            name="판매량"
          />
          <ReferenceLine
            x={0}
            stroke="var(--foreground)"
            strokeWidth={1.5}
            ifOverflow="extendDomain"
            label={{
              value: '증감률 0%',
              position: 'insideTopLeft',
              fontSize: 12,
              fill: 'var(--muted-foreground)',
            }}
          />
          <ReferenceLine
            y={evenShare}
            stroke="var(--foreground)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            ifOverflow="extendDomain"
            label={{
              value: `균등 점유 ${evenShare.toFixed(1)}%`,
              position: 'insideTopRight',
              fontSize: 12,
              fill: 'var(--muted-foreground)',
            }}
          />
          <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<BubbleTooltip />} />
          <Legend
            verticalAlign="top"
            align="center"
            wrapperStyle={{ fontSize: '14px', paddingBottom: 4 }}
          />
          {/*
            대상을 먼저 선언해 범례가 "대상 → 경쟁" 순서로 나오게 한다(읽는 순서와 일치).
            그만큼 경쟁 원이 위에 그려지므로 경쟁은 반투명으로 두어 대상이 가려지지 않게 한다.
          */}
          <Scatter
            name="대상 차종"
            data={targetPoints}
            fill={TARGET_COLOR}
            stroke="var(--foreground)"
            strokeWidth={2}
            shape="circle"
          >
            <LabelList dataKey="name" content={makeLabelRenderer(targetPoints)} />
          </Scatter>
          <Scatter
            name="경쟁 차종"
            data={rivalPoints}
            fill={rivalColor(0)}
            fillOpacity={0.85}
            shape="circle"
          >
            <LabelList dataKey="name" content={makeLabelRenderer(rivalPoints)} />
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <div className="mt-2 text-xs text-muted-foreground">
        오른쪽 위 = 성장하며 점유율도 높음 · 왼쪽 아래 = 역성장하며 점유율도 낮음. 점유율은
        대상+경쟁 {raw.length}종 합계 {fmtUnits(total)}대 기준.
        {droppedCount > 0 && ` 증감률·판매량을 알 수 없어 ${droppedCount}종 제외.`}
        {targetDropped && ' 대상 차종은 증감률·판매량이 없어 표시되지 않았습니다.'}
      </div>
    </ChartCard>
  );
}

/** LabelList content 가 실제로 받는 값 — recharts 는 SVG 속성과 value·index 만 넘긴다. */
interface PointLabelProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  value?: string | number;
  index?: number;
}

/**
 * 점 라벨 렌더러 — 시리즈별로 따로 만든다.
 *
 * recharts 3.8 의 LabelList 는 content 에 원본 행(payload)을 넘기지 않고 SVG 속성만 통과시키므로
 * (`svgPropertiesAndEvents`), 배치 정보는 배열을 클로저로 잡아 index 로 되찾는다. index 는 Scatter
 * 시리즈마다 0 부터 다시 세기 때문에 대상용·경쟁용 렌더러를 공유하면 라벨이 엉뚱한 점을 따라간다.
 */
function makeLabelRenderer(points: readonly BubblePoint[]) {
  return function PointLabel(props: unknown) {
    const { x = 0, y = 0, width = 0, height = 0, value, index = 0 } = props as PointLabelProps;
    if (value == null) return null;
    // Scatter 의 x·y 는 버블 외접 사각형의 좌상단(x = cx − 반지름)이다. 중심으로 되돌리지 않으면
    // 큰 버블일수록 라벨이 왼쪽·위로 밀린다.
    const below = points[index]?.labelBelow ?? false;
    return (
      <text
        x={x + width / 2}
        y={below ? y + height + 14 : y - 6}
        textAnchor="middle"
        fontSize={12}
        fontWeight={500}
        fill="var(--foreground)"
        pointerEvents="none"
      >
        {String(value)}
      </text>
    );
  };
}

function BubbleTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: BubblePoint }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  /**
   * 증감 색은 신호등 팔레트를 그대로 쓴다. 같은 페이지의 순위 막대(CompetitorRankChart)·
   * 점유율 덤벨(ShareDumbbell)이 이미 SIGNAL_COLORS 를 쓰므로, 여기만 Tailwind `text-red-500`
   * 을 쓰면 "감소"가 한 화면에서 서로 다른 빨강 두 개로 보인다.
   */
  const yoyColor =
    p.yoy > 0 ? SIGNAL_COLORS.GREEN : p.yoy < 0 ? SIGNAL_COLORS.RED : 'var(--muted-foreground)';
  return (
    <div className="rounded-md p-2" style={TOOLTIP_CONTENT_STYLE}>
      <div className="font-semibold mb-1">
        {p.fullName}
        {p.isTarget && <span className="ml-1 text-xs text-muted-foreground">대상</span>}
      </div>
      <div>판매량 {fmtFull(p.sales)}대</div>
      <div>
        판매 증감률{' '}
        <span className="font-semibold" style={{ color: yoyColor }}>
          {fmtPct(p.yoy)}
        </span>
      </div>
      <div>경쟁군 내 점유율 {p.share.toFixed(1)}%</div>
    </div>
  );
}
