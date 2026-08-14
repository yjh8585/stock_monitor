'use client';

/**
 * 대상 차종 vs 판매 상위 경쟁 3종의 월별 판매 추이(한 축에 겹친 라인).
 *
 * 이 페이지의 다른 숫자는 전부 "N개월 누계"라 수준(level)만 보여 준다. 누계는 정의상 완만해서
 * 최근 두세 달의 반전이 묻히고, 경쟁차가 치고 올라오는 시점도 드러나지 않는다. 그래서 이 카드만
 * 월별 원계열을 쓰고, 부제에 "누계 아님"을 못 박아 다른 카드와 헷갈리지 않게 한다.
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
import { fmtFull, fmtUnits } from '@/components/oem/helpers';
import type { CompetitionMarket, ModelSeries } from '@/lib/oem-competition/types';
import { useChartHeight } from '@/lib/useChartHeight';
import {
  ChartCard,
  EmptyChart,
  fmtPct,
  fmtYm,
  fmtYmFull,
  rivalDistinctColor,
  displayModel,
  TARGET_COLOR,
} from './shared';

interface SalesTrendChartProps {
  market: CompetitionMarket;
}

/** 라인 하나의 렌더 정보. 데이터(rows)와 분리해 색·굵기·순서 규칙을 한곳에 모은다. */
interface LineMeta {
  key: string;
  name: string;
  color: string;
  strokeWidth: number;
  isTarget: boolean;
}

/**
 * x축 한 칸. 시리즈 값은 결측월에 null 이 들어간다(0 이 아니다 — buildTrend 주석 참고).
 * 시리즈 `sN` 마다 전년 동월 대비를 `sN_yoy` 로 같이 실어 툴팁에서 되찾는다.
 */
type TrendRow = Record<string, number | null> & { ym: number };

/** 툴팁에서 시리즈 키로 YoY 를 되찾기 위한 접미사. 데이터 키와 규칙이 갈리면 조용히 안 나온다. */
const YOY_SUFFIX = '_yoy';

function buildTrend(
  series: ModelSeries[],
  brands: Record<string, string>
): { lines: LineMeta[]; rows: TrendRow[] } {
  // 대상이 먼저 그려져야 범례·툴팁의 첫 줄을 차지한다. series[0]=대상 계약에 기대지 않고 isTarget 으로 가른다.
  const ordered = [...series].sort((a, b) => Number(b.isTarget) - Number(a.isTarget));

  let rivalIndex = 0;
  const lines: LineMeta[] = ordered.map((s, i) => ({
    // 차종명을 dataKey 로 쓰면 'GLE 3.0' 처럼 점이 든 이름을 recharts 가 중첩 경로로 해석해 라인이 통째로 빈다.
    key: `s${i}`,
    name: displayModel(s.model, brands),
    // 순위 막대와 달리 여기는 선 4개가 서로 얽히므로 경쟁끼리도 구별돼야 한다. 회색 계열을 쓰면
    // 옅은 쪽(#e2e8f0)이 배경에 묻혀 **선도 범례 글자도 안 보인다**(2026-08-14 화면 확인).
    color: s.isTarget ? TARGET_COLOR : rivalDistinctColor(rivalIndex++),
    strokeWidth: s.isTarget ? 2.5 : 1.5,
    isTarget: s.isTarget,
  }));

  // 경쟁차마다 결측월이 달라, 한 시리즈의 월 축을 그대로 쓰면 다른 차종의 달이 잘려 나간다 → 합집합 축.
  const months = [...new Set(ordered.flatMap((s) => s.points.map((p) => p.yearMonth)))].sort(
    (a, b) => a - b
  );

  const lookups = ordered.map((s) => new Map(s.points.map((p) => [p.yearMonth, p])));
  const rows: TrendRow[] = months.map((ym) => {
    const row: TrendRow = { ym };
    lines.forEach((l, i) => {
      const point = lookups[i].get(ym);
      // 미수집 월은 null. 0 으로 채우면 "그 달에 한 대도 못 팔았다"는 전혀 다른 사실이 된다.
      row[l.key] = point?.sales ?? null;
      row[l.key + YOY_SUFFIX] = point?.yoyPct ?? null;
    });
    return row;
  });

  return { lines, rows };
}

/**
 * x축 눈금을 3~5개월 간격(interval 2~4)으로 솎는다.
 * 24개월치를 전부 찍으면 "24.08" 라벨이 서로 겹쳐 축이 읽히지 않는다.
 */
function tickInterval(monthCount: number): number {
  return Math.min(4, Math.max(2, Math.ceil(monthCount / 8) - 1));
}

export default function SalesTrendChart({ market }: SalesTrendChartProps) {
  const height = useChartHeight(220, 280, 320);
  // 훅은 조기 반환보다 먼저 — 데이터 유무로 호출 수가 달라지면 안 된다.
  const { hidden, isHidden, toggle } = useHiddenSeries();
  const { lines, rows } = buildTrend(market.series, market.modelBrands);
  const title = `판매 추이 비교 · ${market.label}`;

  if (rows.length === 0) {
    return (
      <ChartCard title={title} subtitle="월별 판매량">
        <EmptyChart reason="월별 판매 시계열이 없습니다. 이 시장은 누계 집계만 수집돼 있습니다." />
      </ChartCard>
    );
  }

  const subtitle = `월별 판매량(누계 아님) · ${fmtYmFull(rows[0].ym)}~${fmtYmFull(
    rows[rows.length - 1].ym
  )} ${rows.length}개월 · 점에 올리면 전년 동월 대비 · 범례 클릭으로 차종 숨김`;

  return (
    <ChartCard title={title} subtitle={subtitle}>
      {/* 🔴 기본 `<Legend>` 는 payload 를 재정렬해 대상이 앞자리를 잃는다(2026-08-14 화면 확인).
          바로 옆 `ShareTrendChart` 가 같은 4종을 싣는데 순서가 서로 다르면 색-차종 대응을 매번
          다시 읽어야 한다 → 두 카드 모두 `LegendRow` 로 순서를 고정한다. */}
      <LegendRow
        items={lines.map((l) => ({
          key: l.key,
          label: l.name,
          shape: 'line' as const,
          color: l.color,
        }))}
        hidden={hidden}
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
          <YAxis tick={{ fontSize: 14 }} tickFormatter={(v) => fmtUnits(Number(v))} width={48} />
          <Tooltip
            contentStyle={TOOLTIP_CONTENT_STYLE}
            cursor={{ strokeDasharray: '3 3' }}
            labelFormatter={(label) => fmtYmFull(Number(label))}
            // 기본값(true)은 결측 시리즈를 툴팁에서 지워 "경쟁차가 안 팔렸다"로 읽히게 한다.
            // 비교가 목적인 차트라 그 달의 전 차종을 남기고 미수집만 따로 표기한다.
            filterNull={false}
            // 판매량만 보이면 "많이 팔았다"는 알아도 "나아지는 중인지"는 모른다 → 전년 동월 대비를
            // 괄호로 붙인다(사용자 지시 2026-08-14). 24개월 창의 첫 12개월은 비교 대상이 창 밖일
            // 수 있는데, buildSeries 가 자르기 전 원계열에서 계산해 두므로 대부분 값이 있다.
            formatter={(value, name, item) => {
              if (value == null) return ['데이터 없음', name];
              const row = (item as { payload?: TrendRow }).payload;
              const yoy = row?.[String(item.dataKey) + YOY_SUFFIX];
              const suffix = typeof yoy === 'number' ? ` (${fmtPct(yoy)})` : ' (전년 동월 없음)';
              return [`${fmtFull(Number(value))}대${suffix}`, name];
            }}
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
              // 대상만 점을 찍는다 — 라인 4개에 전부 찍으면 24개월치가 뭉개진다.
              dot={l.isTarget ? { r: 2 } : false}
              activeDot={{ r: 4 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
