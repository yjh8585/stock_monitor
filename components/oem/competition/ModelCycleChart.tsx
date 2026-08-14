'use client';

/**
 * 신차 사이클 비교 — "판매가 밀리는 게 **경쟁 대비 노후화** 때문인가"에 답하는 카드.
 *
 * 이 정보는 원래도 수집되고 있었지만 `outlook`(판매 전망) **서술 안의 문장**으로만 있었다. 그래서
 * (1) 접힌 채 묻혔고 (2) 무엇보다 **대상 차종 얘기만** 했다 — 노후 여부는 정의상 상대적인데
 * 비교 상대가 화면에 없었다(사용자 지시 2026-08-14).
 *
 * 🔴 **막대를 두 토막으로 나눈 이유**(실측으로 뒤집힌 설계): 처음에는 "마지막 개선 이후 경과"
 * 하나만 그리려 했는데, 그랜드체로키는 2021년 세대에 2026년 페이스리프트를 받아 그 값이 0년이다.
 * 그것만 보면 경쟁(2024년형, 2년차)보다 **더 신선해** 보인다. 반대로 세대 나이만 보면 2020년
 * 세대인 Explorer 가 가장 늙었는데 정작 2024년에 손을 봤다. 둘 중 하나만 쓰면 정반대 결론이 나온다.
 * → 막대 **전체 길이 = 세대 나이**, **진한 오른쪽 토막 = 마지막 개선 이후 경과**로 둘을 한 그림에.
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
  TOTAL_LABEL_ANCHOR,
} from '@/components/oem-companies/common/chartStyle';
import { useHiddenSeries } from '@/components/oem-companies/common/useHiddenSeries';
import type { CompetitionMarket, ModelCycleEntry } from '@/lib/oem-competition/types';
import { useChartHeight } from '@/lib/useChartHeight';
import {
  ChartCard,
  EmptyChart,
  rivalColor,
  displayModel,
  SIGNAL_COLORS,
  TARGET_COLOR,
} from './shared';

const RIVAL_BAR_COLOR = rivalColor(0);

/** 개선 전 구간(옛 토막)의 채움 농도. `ShareChangeBars` 의 "과거=옅게" 문법과 같다. */
const PRE_FILL_OPACITY = 0.28;

/** y축 라벨 칸 — 차종명 + 세대 연식 두 줄. */
const Y_AXIS_WIDTH = 186;
const MODEL_NAME_MAX = 24;

/** "5.0년차 · 2021→2026" 라벨이 잘리지 않을 오른쪽 여백(px). */
const LABEL_MARGIN = 128;

interface CycleRow {
  model: string;
  isTarget: boolean;
  color: string;
  /** 세대 출시 → 마지막 개선까지의 연수. 개선이 없었으면 0. */
  preUpdate: number;
  /** 마지막 개선 → 기준연도까지의 연수. */
  postUpdate: number;
  /** 세대 나이 = preUpdate + postUpdate. */
  age: number;
  entry: ModelCycleEntry;
  ageLabel: string;
  /** 라벨 전용 무한소 앵커 — 0 이면 recharts 가 행을 건너뛰어 라벨 index 가 밀린다. */
  __anchor: number;
}

/**
 * 기준 연도는 판정일(note_date)의 연도다. 브라우저의 오늘을 쓰면 **서버·클라이언트 렌더가
 * 갈릴 수 있고**, 무엇보다 6개월 전 판정을 오늘 기준으로 재계산해 없는 신선도를 만든다.
 *
 * ⚠️ 미국 시장은 **모델 연식**(2027년형이 2026년에 출시)을 쓰므로 연식이 기준연도보다 앞설 수
 * 있다 — 실측(2026-08-14) 셀토스 USA 가 `2027`. 음수 나이는 의미가 없으므로 0 으로 눌러
 * "신형"으로 다룬다. 그 시장 안에서는 경쟁 차종도 같은 표기 체계라 비교 자체는 성립한다.
 */
function buildRows(
  entries: ModelCycleEntry[],
  baseYear: number,
  brands: Record<string, string>
): CycleRow[] {
  return entries
    .map((e) => {
      const preUpdate = Math.max(0, e.lastUpdate - e.lastFullChange);
      const postUpdate = Math.max(0, baseYear - e.lastUpdate);
      return {
        model: displayModel(e.model, brands),
        isTarget: e.isTarget,
        color: e.isTarget ? TARGET_COLOR : RIVAL_BAR_COLOR,
        preUpdate,
        postUpdate,
        age: preUpdate + postUpdate,
        entry: e,
        ageLabel: `${preUpdate + postUpdate}년차`,
        __anchor: TOTAL_LABEL_ANCHOR,
      };
    })
    .sort((a, b) => b.age - a.age);
}

/** 대상이 경쟁 대비 얼마나 늙었나 — 이 카드가 답해야 할 한 문장. */
function summaryText(rows: CycleRow[]): string | null {
  const target = rows.find((r) => r.isTarget);
  const rivals = rows.filter((r) => !r.isTarget);
  if (!target || rivals.length === 0) return null;
  const rivalAvg = rivals.reduce((acc, r) => acc + r.age, 0) / rivals.length;
  const gap = target.age - rivalAvg;
  const verdict = gap > 0.5 ? '노후' : gap < -0.5 ? '신선' : '대등';
  return `${target.model} 세대 나이 ${target.age}년 · 경쟁 평균 ${rivalAvg.toFixed(
    1
  )}년 → ${gap > 0 ? '+' : ''}${gap.toFixed(1)}년 ${verdict}`;
}

function ModelTick({
  x,
  y,
  payload,
  rows,
}: {
  x?: number;
  y?: number;
  payload?: { value?: string | number };
  rows: CycleRow[];
}) {
  const name = String(payload?.value ?? '');
  const row = rows.find((r) => r.model === name);
  const cx = (x ?? 0) - 6;
  return (
    <g>
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
        {row ? `${row.entry.lastFullChange} 세대` : ''}
      </text>
    </g>
  );
}

function CycleTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: CycleRow }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const e = row.entry;
  return (
    <div className="max-w-xs rounded px-2 py-1 text-xs" style={TOOLTIP_CONTENT_STYLE}>
      <div className="font-medium">{row.model}</div>
      <div className="text-muted-foreground">
        {e.lastFullChange} 완전변경 → {row.age}년차
      </div>
      <div className="text-muted-foreground">
        마지막 개선 {e.lastUpdate}
        {e.lastUpdateType ? ` ${e.lastUpdateType}` : ''} · 이후 {row.postUpdate}년
      </div>
      {e.nextEventType && e.nextEventType !== '미정' && (
        <div className="text-muted-foreground">
          다음 {e.nextEventType}
          {e.nextEventTiming ? ` · ${e.nextEventTiming}` : ''}
        </div>
      )}
      {e.note && <div className="mt-0.5 text-muted-foreground">{e.note}</div>}
    </div>
  );
}

/** 막대 오른쪽 라벨 — 세대 나이. 대상만 색을 줘 눈이 먼저 가게 한다. */
function AgeLabel({
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
  rows: CycleRow[];
}) {
  const row = rows[index ?? -1];
  if (!row) return null;
  return (
    <text
      x={(x ?? 0) + (width ?? 0) + 6}
      y={(y ?? 0) + (height ?? 0) / 2}
      dominantBaseline="central"
      // 🔴 색은 style 안에서 덮는다 — DATA_LABEL_STYLE 의 CSS fill 이 fill= 속성을 이긴다.
      style={{ ...DATA_LABEL_STYLE, fill: row.isTarget ? TARGET_COLOR : 'var(--foreground)' }}
    >
      {row.ageLabel}
    </text>
  );
}

export default function ModelCycleChart({
  market,
  noteDate,
}: {
  market: CompetitionMarket;
  noteDate?: string;
}) {
  const rowHeight = useChartHeight(48, 56, 64);
  const { hidden, isHidden, toggle } = useHiddenSeries();
  const baseYear = Number(noteDate?.slice(0, 4)) || new Date().getFullYear();
  // `?? []` — 2026-08-14 이전 적재분에는 이 필드가 아예 없다(캐시 페이로드 방어와 같은 이유).
  const rows = buildRows(market.modelCycle ?? [], baseYear, market.modelBrands);
  const title = '신차 사이클 비교';

  if (rows.length === 0) {
    return (
      <ChartCard title={title} subtitle="세대 연식 · 경쟁 대비 노후도">
        <EmptyChart reason="신차 사이클은 2026-08-14 이후 수집분부터 표시됩니다." />
      </ChartCard>
    );
  }

  const summary = summaryText(rows);
  const upcoming = rows.filter((r) => r.entry.nextEventType && r.entry.nextEventType !== '미정');

  const legendItems = [
    {
      key: 'preUpdate',
      label: '세대 출시~마지막 개선(옅은 막대)',
      shape: 'rect' as const,
      color: 'var(--muted-foreground)',
    },
    {
      key: 'postUpdate',
      label: '마지막 개선 이후(진한 막대)',
      shape: 'rect' as const,
      color: TARGET_COLOR,
    },
  ];

  return (
    <ChartCard
      title={title}
      subtitle={`막대 전체 = 현행 세대 나이 · 진한 부분 = 마지막 상품성 개선 이후 경과 · ${baseYear}년 기준 · Claude Sonnet 5 판정`}
    >
      <LegendRow items={legendItems} hidden={hidden} onToggle={toggle} />
      <ResponsiveContainer width="100%" height={rows.length * rowHeight + 32}>
        <BarChart
          data={rows}
          layout="vertical"
          barCategoryGap="26%"
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
            tickFormatter={(v: number) => `${v}년`}
            tick={{ fontSize: 13, fill: 'var(--muted-foreground)' }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <YAxis
            type="category"
            dataKey="model"
            width={Y_AXIS_WIDTH}
            tick={<ModelTick rows={rows} />}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CycleTooltip />} cursor={{ fill: 'var(--muted)', opacity: 0.3 }} />
          {/* 두 토막은 **누적**이라야 전체 길이가 세대 나이가 된다(stackId 공유). */}
          <Bar
            dataKey="preUpdate"
            stackId="age"
            hide={isHidden('preUpdate')}
            isAnimationActive={false}
          >
            {rows.map((r) => (
              <Cell
                key={r.model}
                fill={r.color}
                fillOpacity={PRE_FILL_OPACITY}
                stroke={r.color}
                strokeWidth={1}
              />
            ))}
          </Bar>
          <Bar
            dataKey="postUpdate"
            stackId="age"
            hide={isHidden('postUpdate')}
            isAnimationActive={false}
            radius={[0, 2, 2, 0]}
            // 🔴 0 이면 막대가 아예 안 그려져 "데이터 없음"과 구별되지 않는다(chart-guide §7-A).
            // 0 이 실제로 나온다: 올해 개선을 받은 차종(그랜드체로키 2026 페이스리프트)과, 미국
            // **모델 연식** 표기라 기준연도보다 앞선 신형(셀토스 2027년형)이 둘 다 여기 걸린다.
            minPointSize={3}
          >
            {rows.map((r) => (
              <Cell key={r.model} fill={r.color} />
            ))}
          </Bar>
          {/*
            🔴 라벨을 **투명 앵커 막대**에 붙인다(chart-guide §4-D 의 TOTAL_LABEL_ANCHOR 패턴).
            postUpdate 에 직접 붙였더니 값이 0 인 행(방금 페이스리프트를 받은 차종)의 막대를
            recharts 가 아예 건너뛰고 **남은 라벨의 index 를 당겨 써서** 라벨이 한 칸씩 밀려
            엉뚱한 차종에 붙었다(2026-08-14 화면 확인 — Traverse 자리에 그랜드체로키의 "5년차").
            앵커는 항상 0 보다 커서 모든 행이 렌더되므로 index 가 행과 1:1 로 유지된다.
          */}
          <Bar
            dataKey="__anchor"
            stackId="age"
            fill="transparent"
            legendType="none"
            tooltipType="none"
            isAnimationActive={false}
          >
            <LabelList dataKey="__anchor" content={<AgeLabel rows={rows} />} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {summary && (
        <div
          className="mt-1 rounded px-2 py-1 text-xs font-medium tabular-nums"
          style={{
            backgroundColor: `color-mix(in srgb, ${
              summary.includes('노후') ? SIGNAL_COLORS.RED : SIGNAL_COLORS.GREEN
            } 10%, var(--card))`,
          }}
        >
          {summary}
        </div>
      )}
      {upcoming.length > 0 && (
        <div className="mt-1 text-xs text-muted-foreground">
          예정 —{' '}
          {upcoming
            .map(
              (r) =>
                `${r.model}: ${r.entry.nextEventType}${
                  r.entry.nextEventTiming ? ` (${r.entry.nextEventTiming})` : ''
                }`
            )
            .join(' · ')}
        </div>
      )}
    </ChartCard>
  );
}
