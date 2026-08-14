'use client';

/**
 * 딜러 유통재고일수의 **추이** — 대상 브랜드 + 경쟁 브랜드, 월별 라인.
 *
 * 옆 카드(`InventoryChart`)는 최신 한 달을 막대로 견준다. 재고는 수준보다 **방향**이 중요하다 —
 * 160일이라도 200일에서 내려오는 중이면 인센티브가 먹히고 있다는 뜻이고, 120일에서 올라오는
 * 중이면 같은 160일이 훨씬 나쁜 신호다. 최신 1점만으로는 그 둘이 구별되지 않는다.
 *
 * 🔴 값이 빈 달을 "모름"으로 다루지 않는다. Cox 는 업계 평균의 2배를 넘는 브랜드의 수치를 아예
 * 공개하지 않으므로, 그 구간은 **가장 나쁜 구간**이다 — 선을 끊고 표식으로 따로 알린다.
 */
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TOOLTIP_CONTENT_STYLE } from '@/components/charts/chartTheme';
import { LegendRow } from '@/components/charts/ChartLegend';
import { GRID_STROKE_OPACITY } from '@/components/oem-companies/common/chartStyle';
import { useHiddenSeries } from '@/components/oem-companies/common/useHiddenSeries';
import type { BrandInventoryTrend, CompetitionMarket } from '@/lib/oem-competition/types';
import { SIGNAL_THRESHOLDS } from '@/lib/oem-competition/signals';
import { useChartHeight } from '@/lib/useChartHeight';
import {
  ChartCard,
  EmptyChart,
  fmtYm,
  fmtYmFull,
  INDUSTRY_NORMAL_DAYS,
  rivalDistinctColor,
  shortModel,
  TARGET_COLOR,
  UsMetricBadge,
} from './shared';

interface LineMeta {
  key: string;
  name: string;
  color: string;
  strokeWidth: number;
  isTarget: boolean;
}

type TrendRow = Record<string, number | null> & { ym: number };

/** 라벨은 "브랜드" 가 아니라 "차종(브랜드)" 로 — 경쟁 막대 카드와 같은 표기를 쓴다. */
function labelFor(t: BrandInventoryTrend): string {
  return t.model ? `${shortModel(t.model)} (${t.brand})` : t.brand;
}

function buildTrend(trends: BrandInventoryTrend[]): {
  lines: LineMeta[];
  rows: TrendRow[];
  hidden: { brand: string; months: number[] }[];
} {
  const ordered = [...trends].sort((a, b) => Number(b.isTarget) - Number(a.isTarget));

  let rivalIndex = 0;
  const lines: LineMeta[] = ordered.map((t, i) => ({
    key: `s${i}`,
    name: labelFor(t),
    color: t.isTarget ? TARGET_COLOR : rivalDistinctColor(rivalIndex++),
    strokeWidth: t.isTarget ? 2.5 : 1.5,
    isTarget: t.isTarget,
  }));

  const months = [...new Set(ordered.flatMap((t) => t.points.map((p) => p.yearMonth)))].sort(
    (a, b) => a - b
  );
  const lookups = ordered.map((t) => new Map(t.points.map((p) => [p.yearMonth, p])));

  const rows: TrendRow[] = months.map((ym) => {
    const row: TrendRow = { ym };
    lines.forEach((l, i) => {
      row[l.key] = lookups[i].get(ym)?.daysSupply ?? null;
    });
    return row;
  });

  // "값이 없다"가 아니라 "너무 높아서 감췄다"인 달만 따로 모은다.
  const hidden = ordered
    .map((t) => ({
      brand: labelFor(t),
      months: t.points.filter((p) => p.outlierExcluded).map((p) => p.yearMonth),
    }))
    .filter((h) => h.months.length > 0);

  return { lines, rows, hidden };
}

export default function InventoryTrendChart({ market }: { market: CompetitionMarket }) {
  const height = useChartHeight(220, 280, 320);
  const { hidden: hiddenKeys, isHidden, toggle } = useHiddenSeries();
  // `?? []` 가 필요한 이유는 `ShareTrendChart` 의 같은 자리 주석 참고(옛 캐시 페이로드 방어).
  const { lines, rows, hidden } = buildTrend(market.inventoryTrend ?? []);
  const title = '딜러 유통재고일수 추이';

  if (rows.length === 0) {
    return (
      <ChartCard title={title} subtitle="Cox Automotive · 미국 딜러 기준">
        <EmptyChart reason="이 시장에는 Cox 유통재고 데이터가 없습니다." />
      </ChartCard>
    );
  }

  const subtitle = (
    <>
      {`브랜드 단위 · 공장 재고가 아니라 딜러에 깔린 미판매 신차 기준 · ${fmtYmFull(
        rows[0].ym
      )}~${fmtYmFull(rows[rows.length - 1].ym)} · 범례 클릭으로 브랜드 숨김`}
      <UsMetricBadge basis={market.usMetricsBasis} />
    </>
  );

  return (
    <ChartCard title={title} subtitle={subtitle}>
      {/* 🔴 범례를 recharts 안에 두면 `ReferenceLine` 라벨과 plot 상단을 두고 자리 다툼을 한다
          (chart-guide §7-A). 카드 본문에 직접 두면 그 문제가 아예 없어진다. */}
      <LegendRow
        items={lines.map((l) => ({
          key: l.key,
          label: l.name,
          shape: 'line' as const,
          color: l.color,
        }))}
        hidden={hiddenKeys}
        onToggle={toggle}
      />
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={rows} margin={{ top: 14, right: 20, bottom: 5, left: 5 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            className="stroke-border"
            strokeOpacity={GRID_STROKE_OPACITY}
            vertical={false}
          />
          <XAxis
            dataKey="ym"
            tick={{ fontSize: 14 }}
            tickFormatter={(v) => fmtYm(Number(v))}
            interval={0}
          />
          <YAxis
            tick={{ fontSize: 14 }}
            tickFormatter={(v) => `${Number(v).toFixed(0)}일`}
            width={48}
          />
          {/* 업계 관행선은 옆 막대 카드와 **같은 상수**를 쓴다(shared.tsx) — 두 카드가 다른 선을
              그으면 어느 쪽이 맞는지 알 수 없다. */}
          <ReferenceLine
            y={INDUSTRY_NORMAL_DAYS}
            stroke="var(--muted-foreground)"
            strokeDasharray="4 4"
            label={{
              value: `업계 통상 ${INDUSTRY_NORMAL_DAYS}${SIGNAL_THRESHOLDS.inventory.unit}`,
              position: 'insideTopLeft',
              fontSize: 13,
              fill: 'var(--muted-foreground)',
            }}
          />
          <Tooltip
            contentStyle={TOOLTIP_CONTENT_STYLE}
            cursor={{ strokeDasharray: '3 3' }}
            labelFormatter={(label) => fmtYmFull(Number(label))}
            filterNull={false}
            formatter={(value, name) =>
              value == null ? ['미공개(평균 2배 초과)', name] : [`${Number(value)}일`, name]
            }
          />
          {lines.map((l) => (
            <Line
              key={l.key}
              type="monotone"
              dataKey={l.key}
              name={l.name}
              stroke={l.color}
              strokeWidth={l.strokeWidth}
              hide={isHidden(l.key)}
              // 7개월치라 점이 뭉치지 않는다. 오히려 점이 있어야 결측월(선 끊김)이 눈에 띈다.
              dot={{ r: 2.5 }}
              activeDot={{ r: 4 }}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      {hidden.length > 0 && (
        <div
          className="mt-1 rounded border px-2 py-1 text-xs"
          style={{ borderColor: 'var(--border)' }}
        >
          <span className="font-medium">선이 끊긴 구간은 “값 없음”이 아니다</span> — Cox 가 업계
          평균 2배 초과로 수치를 감춘 달이다(실제 재고는 마지막 공개값보다 나쁘다):{' '}
          {hidden.map((h) => `${h.brand} ${h.months.map(fmtYmFull).join('·')}`).join(' / ')}
        </div>
      )}
    </ChartCard>
  );
}
