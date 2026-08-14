'use client';

/**
 * 경쟁군 내 점유율의 **궤적** — 대상 + 상위 경쟁 3종, 12개월 이동 누계 기준.
 *
 * 옆 카드(`ShareChangeBars`)는 전년과 현재 두 점만 견준다. 그것으로는 "17.1%로 내려왔다"는 알아도
 * **언제부터 밀리기 시작했는지**, 즉 추세의 꺾인 지점을 알 수 없다. 두 점 사이에서 반등했다가 다시
 * 빠진 경우와 계속 흘러내린 경우가 화면에서 똑같이 보인다 — 대응이 전혀 다른데도.
 *
 * 12개월 이동 누계를 쓰는 이유는 `types.ts` 의 `ShareTrendPoint` 주석 참고(끝점이 KPI 와 일치한다).
 */
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TOOLTIP_CONTENT_STYLE } from '@/components/charts/chartTheme';
import { LegendRow } from '@/components/charts/ChartLegend';
import { GRID_STROKE_OPACITY } from '@/components/oem-companies/common/chartStyle';
import { useHiddenSeries } from '@/components/oem-companies/common/useHiddenSeries';
import type { CompetitionMarket, ModelShareTrend } from '@/lib/oem-competition/types';
import { useChartHeight } from '@/lib/useChartHeight';
import {
  ChartCard,
  EmptyChart,
  fmtLevel,
  fmtPp,
  fmtYm,
  fmtYmFull,
  rivalDistinctColor,
  displayModel,
  TARGET_COLOR,
} from './shared';

interface LineMeta {
  key: string;
  name: string;
  color: string;
  strokeWidth: number;
  isTarget: boolean;
}

type TrendRow = Record<string, number | null> & { ym: number };

function buildTrend(
  series: ModelShareTrend[],
  brands: Record<string, string>
): { lines: LineMeta[]; rows: TrendRow[] } {
  const ordered = [...series].sort((a, b) => Number(b.isTarget) - Number(a.isTarget));

  let rivalIndex = 0;
  const lines: LineMeta[] = ordered.map((s, i) => ({
    // 차종명을 dataKey 로 쓰면 점(.)이 든 이름을 recharts 가 중첩 경로로 해석해 라인이 통째로 빈다.
    key: `s${i}`,
    name: displayModel(s.model, brands),
    // 선이 4개 얽히므로 경쟁끼리도 구별돼야 한다 → 회색 계열이 아니라 고유색(chart-guide §7-A).
    color: s.isTarget ? TARGET_COLOR : rivalDistinctColor(rivalIndex++),
    strokeWidth: s.isTarget ? 2.5 : 1.5,
    isTarget: s.isTarget,
  }));

  const months = [...new Set(ordered.flatMap((s) => s.points.map((p) => p.yearMonth)))].sort(
    (a, b) => a - b
  );
  const lookups = ordered.map((s) => new Map(s.points.map((p) => [p.yearMonth, p.sharePct])));

  const rows: TrendRow[] = months.map((ym) => {
    const row: TrendRow = { ym };
    lines.forEach((l, i) => {
      row[l.key] = lookups[i].get(ym) ?? null;
    });
    return row;
  });

  // 12개월 창이 덜 찬 앞부분은 전 시리즈가 null 이다 — 그대로 두면 왼쪽이 텅 빈 채 축만 늘어난다.
  const firstValued = rows.findIndex((r) => lines.some((l) => r[l.key] !== null));
  return { lines, rows: firstValued < 0 ? [] : rows.slice(firstValued) };
}

/** x축 눈금 솎기 — 24개월치를 다 찍으면 "24.08" 라벨이 겹친다. */
function tickInterval(monthCount: number): number {
  return Math.min(4, Math.max(2, Math.ceil(monthCount / 8) - 1));
}

/** 대상 차종의 시작→끝 변화 한 줄. 차트를 읽기 전에 결론을 먼저 준다. */
function summaryText(rows: TrendRow[], target: LineMeta | undefined): string | null {
  if (!target) return null;
  const valued = rows.filter((r) => typeof r[target.key] === 'number');
  if (valued.length < 2) return null;
  const first = valued[0][target.key] as number;
  const last = valued[valued.length - 1][target.key] as number;
  return `${target.name} ${fmtYmFull(valued[0].ym)} ${fmtLevel(first)} → ${fmtYmFull(
    valued[valued.length - 1].ym
  )} ${fmtLevel(last)} (${fmtPp(last - first)})`;
}

export default function ShareTrendChart({ market }: { market: CompetitionMarket }) {
  const height = useChartHeight(220, 280, 320);
  // 훅은 조기 반환보다 먼저 — 데이터 유무로 호출 수가 달라지면 안 된다.
  const { hidden: hiddenKeys, isHidden, toggle } = useHiddenSeries();
  // 🔴 `?? []` 는 타입상 불필요해 보이지만 **실제로 페이지를 죽였다**(2026-08-14). `'use cache'` 에
  // 필드가 없던 시절의 페이로드가 남아 있으면 `market.shareTrend` 가 undefined 로 들어오고,
  // 구조분해가 아니라 순회에서 터져 카드가 아니라 **화면 전체**가 클라이언트 렌더로 떨어진다.
  // CompetitionMarket 에 필드를 더할 때마다 같은 창이 열린다.
  const { lines, rows } = buildTrend(market.shareTrend ?? [], market.modelBrands);
  const title = `점유율 추이 · ${market.label}`;

  if (rows.length === 0) {
    return (
      <ChartCard title={title} subtitle="경쟁군 내 점유율(12개월 이동 누계)">
        <EmptyChart reason="월별 판매 시계열이 없어 점유율 추이를 낼 수 없습니다." />
      </ChartCard>
    );
  }

  const target = lines.find((l) => l.isTarget);
  const summary = summaryText(rows, target);
  const subtitle = `경쟁군 내 점유율 · 각 점은 그달까지 12개월 누계 기준 · ${fmtYmFull(
    rows[0].ym
  )}~${fmtYmFull(rows[rows.length - 1].ym)} · 범례 클릭으로 차종 숨김`;

  return (
    <ChartCard title={title} subtitle={subtitle}>
      {/* 🔴 기본 `<Legend>` 는 payload 를 제 순서로 재정렬해 **대상이 2번째로 밀린다**(2026-08-14
          화면 확인 — Explorer 가 Grand Cherokee 앞에 왔다). 읽는 순서는 언제나 "대상 먼저"라
          `LegendRow` 로 직접 통제한다(docs/chart-guide.md 규칙 7). */}
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
        <LineChart data={rows} margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
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
            interval={tickInterval(rows.length)}
          />
          {/* 축을 0 에서 시작한다(`[0, 'auto']`). 점유율에서 축을 잘라 올리면 2%p 변화가 화면
              절반으로 부풀어 실제보다 극적으로 보인다 — 이 카드가 답해야 할 것은 "얼마나 크게
              움직였나"라서 그 왜곡이 곧 오답이 된다. 상한만 데이터에 맞춰 100% 여백을 없앤다. */}
          <YAxis
            domain={[0, 'auto']}
            tick={{ fontSize: 14 }}
            tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
            width={44}
          />
          <Tooltip
            contentStyle={TOOLTIP_CONTENT_STYLE}
            cursor={{ strokeDasharray: '3 3' }}
            labelFormatter={(label) => `${fmtYmFull(Number(label))}까지 12개월`}
            filterNull={false}
            formatter={(value, name) =>
              value == null ? ['데이터 없음', name] : [fmtLevel(Number(value)), name]
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
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      {summary && <div className="mt-1 text-xs tabular-nums text-muted-foreground">{summary}</div>}
    </ChartCard>
  );
}
