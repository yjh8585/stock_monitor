'use client';

/**
 * 경쟁군 전체 판매 순위 — 대상 차종이 몇 위인지 한눈에 잡아 주는 가로 막대.
 *
 * 순위는 "얼마나 팔았나"(막대 길이)와 "어디에 서 있나"(위에서 몇 번째)를 동시에 물어보는 질문이라
 * 세로 막대가 아니라 가로 막대다. 차종명이 길어 세로축에 눕히면 라벨이 회전 없이 읽히고,
 * 위→아래 순서가 곧 순위가 된다.
 */
import { useMemo } from 'react';
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

/** 경쟁 차종은 전부 같은 회색이라야 파란 대상 막대가 순위표에서 즉시 튄다. */
const RIVAL_COLOR = rivalColor(0);

/**
 * YoY 글자색은 신호등 팔레트를 그대로 빌린다. 같은 페이지 안에서 "증가=초록"이
 * 신호등과 막대 라벨에서 서로 다른 초록이면 같은 뜻으로 안 읽힌다.
 */
const YOY_LABEL_UP = { ...DATA_LABEL_STYLE, fill: SIGNAL_COLORS.GREEN };
const YOY_LABEL_DOWN = { ...DATA_LABEL_STYLE, fill: SIGNAL_COLORS.RED };
const YOY_LABEL_FLAT = { ...DATA_LABEL_STYLE, fill: 'var(--muted-foreground)' };

const LEGEND_ITEMS = [
  { key: 'target', label: '대상 차종', shape: 'rect' as const, color: TARGET_COLOR },
  { key: 'rival', label: '경쟁 차종', shape: 'rect' as const, color: RIVAL_COLOR },
];

interface RankRow {
  /** 축 라벨용 단축명. 동명이 겹칠 수 있어 React key 로는 쓰지 않는다. */
  name: string;
  /** 툴팁에는 괄호 부연까지 살린 원래 이름을 보여 준다. */
  fullName: string;
  sales: number;
  yoyPct: number | null;
  isTarget: boolean;
  /**
   * 증가·감소·판정불가를 서로 다른 dataKey 로 갈라 둔다. LabelList 는 style 이 리스트 단위라
   * 한 키로는 막대마다 색을 바꿀 수 없다. 해당 없는 행은 undefined 로 두면 그 라벨은 렌더되지 않는다.
   */
  yoyUp?: string;
  yoyDown?: string;
  yoyFlat?: string;
}

function buildRows(market: CompetitionMarket): RankRow[] {
  // 대상 차종 이름의 출처는 소비자 평가뿐이다. 점수 수집이 실패해도 순위 자체는 그려야 하므로 폴백을 둔다.
  const targetName = market.consumerScores.find((s) => s.is_target)?.model ?? '대상 차종';

  const raw = [
    { model: targetName, sales: market.sales, yoyPct: market.yoyPct, isTarget: true },
    ...market.competitors.map((c) => ({
      model: c.model,
      sales: c.sales,
      yoyPct: c.yoy_pct,
      isTarget: false,
    })),
  ];

  return raw
    .filter((r) => Number.isFinite(r.sales))
    .sort((a, b) => b.sales - a.sales)
    .map((r) => {
      const label = fmtPct(r.yoyPct);
      const up = r.yoyPct !== null && r.yoyPct > 0;
      const down = r.yoyPct !== null && r.yoyPct < 0;
      return {
        name: shortModel(r.model),
        fullName: r.model,
        sales: r.sales,
        yoyPct: r.yoyPct,
        isTarget: r.isTarget,
        yoyUp: up ? label : undefined,
        yoyDown: down ? label : undefined,
        yoyFlat: up || down ? undefined : label,
      };
    });
}

export default function CompetitorRankChart({ market }: { market: CompetitionMarket }) {
  // 훅은 조기 반환보다 먼저 — 데이터 유무에 따라 호출 수가 달라지면 안 된다.
  const h = useChartHeight(280, 360, 440);
  const rows = useMemo(() => buildRows(market), [market]);

  // 막대 하나짜리 순위표는 "몇 위인가"에 답하지 못한다. 그릴 바에 이유를 밝힌다.
  // 원본 competitors 길이가 아니라 **걸러내고 남은 행**으로 판정한다 — 경쟁 차종이 들어 있어도
  // sales 가 결측이면 Number.isFinite 필터에서 전부 빠져 "1종 중 1위"만 남는다.
  if (rows.every((r) => r.isTarget)) {
    return (
      <ChartCard title="경쟁군 판매 순위" subtitle={market.label}>
        <EmptyChart reason="경쟁 차종 판매 데이터가 없어 순위를 낼 수 없습니다." />
      </ChartCard>
    );
  }

  if (rows.every((r) => r.sales <= 0)) {
    return (
      <ChartCard title="경쟁군 판매 순위" subtitle={market.label}>
        <EmptyChart reason="경쟁군 전체의 누계 판매량이 0입니다." />
      </ChartCard>
    );
  }

  const targetRank = rows.findIndex((r) => r.isTarget) + 1;
  const subtitle = [
    market.label,
    periodLabel(market),
    targetRank > 0 ? `${rows.length}종 중 ${targetRank}위` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <ChartCard title="경쟁군 판매 순위" subtitle={subtitle}>
      <ResponsiveContainer width="100%" height={h}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 60, bottom: 4, left: 8 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            className="stroke-border"
            strokeOpacity={GRID_STROKE_OPACITY}
            horizontal={false}
          />
          <XAxis type="number" tickFormatter={(v: number) => fmtUnits(v)} tick={{ fontSize: 14 }} />
          <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 14 }} interval={0} />
          <Tooltip
            cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
            contentStyle={TOOLTIP_CONTENT_STYLE}
            labelFormatter={(label, payload) => {
              const d = payload?.[0]?.payload as RankRow | undefined;
              return d?.fullName ?? String(label);
            }}
            formatter={(value, _name, item) => {
              const d = (item as { payload?: RankRow }).payload;
              return [
                `${fmtFull(Number(value))}대 · YoY ${fmtPct(d?.yoyPct ?? null)}`,
                '누계 판매',
              ];
            }}
          />
          <Legend
            verticalAlign="top"
            align="center"
            wrapperStyle={{ paddingBottom: 8 }}
            content={() => <LegendRow items={LEGEND_ITEMS} />}
          />
          {/* 차종 수가 적으면 막대가 과하게 두꺼워져 순위표로 안 읽힌다. */}
          <Bar dataKey="sales" name="누계 판매" radius={[0, 4, 4, 0]} maxBarSize={32}>
            {rows.map((r, i) => (
              <Cell key={`${r.fullName}-${i}`} fill={r.isTarget ? TARGET_COLOR : RIVAL_COLOR} />
            ))}
            <LabelList dataKey="yoyUp" position="right" style={YOY_LABEL_UP} />
            <LabelList dataKey="yoyDown" position="right" style={YOY_LABEL_DOWN} />
            <LabelList dataKey="yoyFlat" position="right" style={YOY_LABEL_FLAT} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
