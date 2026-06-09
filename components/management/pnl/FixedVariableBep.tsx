'use client';

import { useMemo } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Label,
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TOOLTIP_CONTENT_STYLE } from '@/components/charts/chartTheme';
import { OEM_COLORS } from '@/components/charts/palette';
import {
  DATA_LABEL_STYLE,
  GRID_STROKE_OPACITY,
} from '@/components/oem-companies/common/chartStyle';
import { useChartHeight } from '@/lib/useChartHeight';
import type { FixedVariableRow } from '@/lib/pnl/types';

interface Props {
  fixedVariable: FixedVariableRow[];
}

const BEP1_COLOR = OEM_COLORS[3]; // amber
const BEP2_COLOR = OEM_COLORS[6]; // orange
const REVENUE_COLOR = OEM_COLORS[0]; // blue
const RATIO_COLOR = '#dc2626'; // 고정비율 라인 (달성율 라인 컨벤션)

interface ChartRow {
  year: string;
  bep1: number | null; // 손익분기점1 = 고정비 / 공헌이익률
  bep2: number | null; // 손익분기점2 = 비용합계(고정비+변동비)
  revenue: number | null; // 매출
  fixedRatio: number | null; // 고정비율(%) = 고정비 / 매출
}

function maxYtdMonth(rows: readonly FixedVariableRow[]): number {
  let m = 0;
  for (const r of rows) {
    if (r.period_year === 2026 && r.period_kind === 'monthly' && r.period_month > m)
      m = r.period_month;
  }
  return m;
}

/** 연도별 BEP·매출·고정비율 집계. 매출/비용이 모두 없는 연도는 제외. */
function buildData(rows: readonly FixedVariableRow[]): ChartRow[] {
  const ytd = maxYtdMonth(rows);
  const defs: { year: string; match: (r: FixedVariableRow) => boolean }[] = [
    { year: '2023', match: (r) => r.period_year === 2023 && r.period_kind === 'annual' },
    { year: '2024', match: (r) => r.period_year === 2024 && r.period_kind === 'annual' },
    { year: '2025', match: (r) => r.period_year === 2025 && r.period_kind === 'annual' },
    {
      year: ytd === 12 ? '2026' : '2026 YTD',
      match: (r) =>
        r.period_year === 2026 &&
        r.period_kind === 'monthly' &&
        r.period_month >= 1 &&
        r.period_month <= ytd,
    },
  ];

  const out: ChartRow[] = [];
  for (const d of defs) {
    let rev: number | null = null;
    let fixed: number | null = null;
    let varc: number | null = null;
    for (const r of rows) {
      if (!d.match(r) || r.value_mwon === null) continue;
      if (r.cost_type === '매출') rev = (rev ?? 0) + r.value_mwon;
      else if (r.cost_type === '고정비') fixed = (fixed ?? 0) + r.value_mwon;
      else if (r.cost_type === '변동비') varc = (varc ?? 0) + r.value_mwon;
    }
    if (rev === null && fixed === null && varc === null) continue;

    // 공헌이익률 = (매출 − 변동비) / 매출
    const cmRate = rev !== null && rev !== 0 && varc !== null ? (rev - varc) / rev : null;
    const bep1 = fixed !== null && cmRate !== null && cmRate > 0 ? fixed / cmRate : null;
    const bep2 = fixed !== null || varc !== null ? (fixed ?? 0) + (varc ?? 0) : null;
    const fixedRatio = fixed !== null && rev !== null && rev !== 0 ? (fixed / rev) * 100 : null;

    out.push({ year: d.year, bep1, bep2, revenue: rev, fixedRatio });
  }
  return out;
}

const fmt = (v: number | null | undefined): string =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : Math.round(v).toLocaleString('ko-KR');

const SERIES: { key: keyof ChartRow; label: string; color: string }[] = [
  { key: 'bep1', label: '손익분기점1 매출', color: BEP1_COLOR },
  { key: 'bep2', label: '손익분기점2 매출', color: BEP2_COLOR },
  { key: 'revenue', label: '매출', color: REVENUE_COLOR },
];

interface TooltipEntry {
  dataKey: keyof ChartRow;
  value: number | null;
  color: string;
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div style={TOOLTIP_CONTENT_STYLE} className="rounded-md px-3 py-2">
      <div className="mb-1 font-semibold">{label}</div>
      {payload.map((e) => {
        const isRatio = e.dataKey === 'fixedRatio';
        const text = isRatio
          ? e.value === null
            ? '—'
            : `${e.value.toFixed(1)}%`
          : `${fmt(e.value)} 백만원`;
        const name =
          SERIES.find((s) => s.key === e.dataKey)?.label ??
          (isRatio ? '고정비율' : String(e.dataKey));
        return (
          <div key={e.dataKey} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: e.color }}
              />
              {name}
            </span>
            <span className="tabular-nums">{text}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 2-2. 손익분기점(BEP) 분석 — 콤보차트.
 *
 * - 묶은 세로막대: 손익분기점1 매출(고정비/공헌이익률) · 손익분기점2 매출(비용합계) · 매출
 * - 표식 꺾은선: 고정비율(= 고정비/매출, 우측 % 축)
 * - 공헌이익률 = (매출 − 변동비)/매출
 */
export default function FixedVariableBep({ fixedVariable }: Props) {
  const data = useMemo(() => buildData(fixedVariable), [fixedVariable]);
  const height = useChartHeight(320, 400, 460);

  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <header className="mb-3">
        <h2 className="text-lg font-semibold">2-2. 손익분기점(BEP) 분석</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          연결 기준 · 막대 단위 백만원 · 손익분기점1 = 고정비 ÷ 공헌이익률((매출−변동비)/매출) ·
          손익분기점2 = 비용합계(고정비+변동비) · 꺾은선 고정비율(%) = 고정비 ÷ 매출
        </p>
      </header>
      {data.length === 0 ? (
        <div className="py-12 text-center text-base text-muted-foreground">데이터가 없습니다.</div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={data} margin={{ top: 28, right: 16, bottom: 8, left: 12 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              className="stroke-border"
              strokeOpacity={GRID_STROKE_OPACITY}
              vertical={false}
            />
            <XAxis dataKey="year" tick={{ fontSize: 13 }} />
            <YAxis
              yAxisId="amount"
              tickFormatter={(v) => (v as number).toLocaleString('ko-KR')}
              tick={{ fontSize: 13 }}
              width={64}
              // 막대를 하단 ~45%로 압축 → 상단에 꺾은선(고정비율)과 시각적 분리
              domain={[0, (max: number) => Math.round(max * 2.2)]}
            >
              <Label
                value="백만원"
                position="top"
                offset={12}
                style={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
              />
            </YAxis>
            <YAxis
              yAxisId="ratio"
              orientation="right"
              tickFormatter={(v) => `${Math.round(v as number)}%`}
              tick={{ fontSize: 13 }}
              width={48}
              // 꺾은선을 상단 ~87%에 배치 → 하단 막대와 시각적 분리
              domain={[0, (max: number) => Math.max(Math.ceil((max * 1.15) / 5) * 5, 5)]}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--muted)', opacity: 0.3 }} />
            <Legend
              verticalAlign="top"
              align="center"
              wrapperStyle={{ fontSize: 14, paddingBottom: 8 }}
            />
            {SERIES.map((s) => (
              <Bar
                key={s.key}
                yAxisId="amount"
                dataKey={s.key}
                name={s.label}
                fill={s.color}
                radius={[3, 3, 0, 0]}
              />
            ))}
            <Line
              yAxisId="ratio"
              type="monotone"
              dataKey="fixedRatio"
              name="고정비율"
              stroke={RATIO_COLOR}
              strokeWidth={2}
              dot={{ r: 4, fill: RATIO_COLOR }}
              activeDot={{ r: 6 }}
              connectNulls
            >
              <LabelList
                dataKey="fixedRatio"
                position="top"
                formatter={(value) => {
                  const n = typeof value === 'number' ? value : null;
                  return n === null || Number.isNaN(n) ? '' : `${n.toFixed(1)}%`;
                }}
                style={{ ...DATA_LABEL_STYLE, fill: RATIO_COLOR, fontSize: 13 }}
              />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}
