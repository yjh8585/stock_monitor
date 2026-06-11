'use client';

import { useMemo, useState } from 'react';
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
import { LegendRow } from '@/components/charts/ChartLegend';
import { OEM_COLORS } from '@/components/charts/palette';
import { GRID_STROKE_OPACITY } from '@/components/oem-companies/common/chartStyle';
import { useChartHeight } from '@/lib/useChartHeight';
import type { FixedVariableRow } from '@/lib/pnl/types';

interface Props {
  fixedVariable: FixedVariableRow[];
}

/** 차트 모드 — 손익분기점(억원) / 공헌이익률(%) */
type Mode = 'bep' | 'cm';

const BLUE = OEM_COLORS[0]; // blue-600
const OPMARGIN_COLOR = '#dc2626'; // 영업이익률 라인 (달성율/비율선 컨벤션)

/** hex(#RRGGBB) → rgba. 12번 차트(YoyMonthlyCompare)와 동일한 2톤 음영 패턴. */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
const BLUE_LIGHT = hexToRgba(BLUE, 0.45);

/** 데이터 라벨 — 경영관리 차트 표준 16px(12번 등 동일, chart-guide §5 "콤보·인원 라벨 16px"). */
const BAR_LABEL_STYLE = { fontSize: 16, fill: 'var(--foreground)', fontWeight: 600 } as const;

/** 백만원 → 억원 */
const UNIT_DIVISOR = 100;

interface ChartRow {
  year: string;
  bep: number | null; // 손익분기점 = 고정비 / 공헌이익률 (억원)
  revenue: number | null; // 매출 (억원)
  cmRate: number | null; // 공헌이익률(%) = (매출 − 변동비) / 매출
  fixedRatio: number | null; // 고정비율(%) = 고정비 / 매출
  opMargin: number | null; // 영업이익률(%) = 공헌이익률 − 고정비율
}

function maxYtdMonth(rows: readonly FixedVariableRow[]): number {
  let m = 0;
  for (const r of rows) {
    if (r.period_year === 2026 && r.period_kind === 'monthly' && r.period_month > m)
      m = r.period_month;
  }
  return m;
}

/** 연도별 손익분기점·매출·공헌이익률·고정비율·영업이익률 집계. 매출/비용이 모두 없는 연도는 제외. */
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

    // 공헌이익률 = (매출 − 변동비) / 매출, 고정비율 = 고정비 / 매출 (둘 다 0~1)
    const cmR = rev !== null && rev !== 0 && varc !== null ? (rev - varc) / rev : null;
    const fixedR = fixed !== null && rev !== null && rev !== 0 ? fixed / rev : null;
    const bepMwon = fixed !== null && cmR !== null && cmR > 0 ? fixed / cmR : null;
    const opMargin = cmR !== null && fixedR !== null ? (cmR - fixedR) * 100 : null;

    out.push({
      year: d.year,
      bep: bepMwon !== null ? bepMwon / UNIT_DIVISOR : null,
      revenue: rev !== null ? rev / UNIT_DIVISOR : null,
      cmRate: cmR !== null ? cmR * 100 : null,
      fixedRatio: fixedR !== null ? fixedR * 100 : null,
      opMargin,
    });
  }
  return out;
}

const fmtAmount = (v: number | null | undefined): string =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : Math.round(v).toLocaleString('ko-KR');
const fmtPct = (v: number | null | undefined): string =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : `${v.toFixed(1)}%`;

/** dataKey별 라벨·단위. 모드 전환과 무관하게 툴팁에서 공용. */
const SERIES_META: Record<
  keyof Omit<ChartRow, 'year'>,
  { label: string; kind: 'amount' | 'pct'; color: string }
> = {
  bep: { label: '손익분기점', kind: 'amount', color: BLUE_LIGHT },
  revenue: { label: '매출', kind: 'amount', color: BLUE },
  cmRate: { label: '공헌이익률', kind: 'pct', color: BLUE },
  fixedRatio: { label: '고정비율', kind: 'pct', color: BLUE_LIGHT },
  opMargin: { label: '영업이익률', kind: 'pct', color: OPMARGIN_COLOR },
};

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
        const meta = SERIES_META[e.dataKey as keyof Omit<ChartRow, 'year'>];
        if (!meta) return null;
        const text = meta.kind === 'amount' ? `${fmtAmount(e.value)} 억원` : fmtPct(e.value);
        return (
          <div key={e.dataKey} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: e.color }}
              />
              {meta.label}
            </span>
            <span className="tabular-nums">{text}</span>
          </div>
        );
      })}
    </div>
  );
}

/** 우상단 모드 토글 (BasisToggle/SegToggle 양식). */
function ModeToggle({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  const options: { v: Mode; label: string }[] = [
    { v: 'bep', label: '손익분기점' },
    { v: 'cm', label: '공헌이익률' },
  ];
  return (
    <div className="inline-flex items-center rounded-md border border-border bg-muted/40 p-0.5">
      {options.map((opt) => {
        const active = opt.v === value;
        return (
          <button
            key={opt.v}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.v)}
            className={`text-sm px-2.5 py-1 rounded-sm transition-colors ${
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

const amountLabel = (value: unknown) => (typeof value === 'number' ? fmtAmount(value) : '');
const pctLabel = (value: unknown) =>
  typeof value === 'number' && !Number.isNaN(value) ? `${value.toFixed(1)}%` : '';

/**
 * 2-1. 손익분기점(BEP) 분석 — 콤보차트 (모드 토글).
 *
 * - 손익분기점 모드: 묶은 막대 손익분기점·매출(억원, 좌축) + 표식 꺾은선 영업이익률(%, 우축)
 * - 공헌이익률 모드: 묶은 막대 공헌이익률·고정비율(%, 좌축) + 표식 꺾은선 영업이익률(%, 우축)
 * - 막대 음영: 12번 차트와 동일한 blue-600 2톤(진한/45% 투명).
 * - 이중축 영역 분리(chart-guide §4-F): 좌축 막대 [0, max×2.5] → 하단,
 *   우축 영업이익률선 [-opMax×1.5, opMax×1.1] → 상단. 두 영역이 겹치지 않는다.
 * - 데이터 라벨: 경영관리 표준 16px(BAR_LABEL_STYLE). 영업이익률 = 공헌이익률 − 고정비율.
 */
export default function FixedVariableBep({ fixedVariable }: Props) {
  const [mode, setMode] = useState<Mode>('bep');
  const data = useMemo(() => buildData(fixedVariable), [fixedVariable]);
  const height = useChartHeight(360, 440, 520);

  // 이중축 영역 분리용 max (chart-guide §4-F)
  const amountMax = Math.max(1, ...data.map((d) => Math.max(d.bep ?? 0, d.revenue ?? 0)));
  const pctBarMax = Math.max(5, ...data.map((d) => Math.max(d.cmRate ?? 0, d.fixedRatio ?? 0)));
  const opMax = Math.max(5, ...data.map((d) => Math.abs(d.opMargin ?? 0)));

  // 막대(좌축): 상한 ×2.5 → 하단 ~40% 밴드. 선(우축): 음수 하한 → 상단 밴드.
  const leftDomain: [number, number] =
    mode === 'bep' ? [0, Math.round(amountMax * 2.5)] : [0, Math.round(pctBarMax * 2.5)];
  const rightDomain: [number, number] = [-opMax * 1.5, opMax * 1.1];

  // 콤보 범례 순서(chart-guide §4-F): 막대(왼→오) → 꺾은선.
  const legendItems =
    mode === 'bep'
      ? [
          { key: 'bep', label: '손익분기점', shape: 'rect' as const, color: BLUE_LIGHT },
          { key: 'revenue', label: '매출', shape: 'rect' as const, color: BLUE },
          { key: 'opMargin', label: '영업이익률', shape: 'line' as const, color: OPMARGIN_COLOR },
        ]
      : [
          { key: 'cmRate', label: '공헌이익률', shape: 'rect' as const, color: BLUE },
          { key: 'fixedRatio', label: '고정비율', shape: 'rect' as const, color: BLUE_LIGHT },
          { key: 'opMargin', label: '영업이익률', shape: 'line' as const, color: OPMARGIN_COLOR },
        ];

  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">2-1. 손익분기점(BEP) 분석</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === 'bep'
              ? '연결 기준 · 막대 단위 억원 · 손익분기점 = 고정비 ÷ 공헌이익률 · 공헌이익률 = (매출−변동비)/매출 · 꺾은선 영업이익률(%) = 영업이익 ÷ 매출'
              : '연결 기준 · 막대·꺾은선 단위 % · 공헌이익률 = (매출−변동비)/매출 · 고정비율 = 고정비 ÷ 매출 · 꺾은선 영업이익률(%)'}
            {' · 영업이익률 = 공헌이익률 − 고정비율'}
          </p>
        </div>
        <ModeToggle value={mode} onChange={setMode} />
      </header>
      {data.length === 0 ? (
        <div className="py-12 text-center text-base text-muted-foreground">데이터가 없습니다.</div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart
            key={mode}
            data={data}
            margin={{ top: 32, right: 20, bottom: 8, left: 12 }}
            barGap={4}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              className="stroke-border"
              strokeOpacity={GRID_STROKE_OPACITY}
              vertical={false}
            />
            <XAxis dataKey="year" tick={{ fontSize: 13 }} />
            <YAxis
              yAxisId="left"
              tickFormatter={(v) =>
                mode === 'bep'
                  ? (v as number).toLocaleString('ko-KR')
                  : `${Math.round(v as number)}%`
              }
              tick={{ fontSize: 13 }}
              width={mode === 'bep' ? 64 : 52}
              domain={leftDomain}
            >
              <Label
                value={mode === 'bep' ? '억원' : '%'}
                position="top"
                offset={12}
                style={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
              />
            </YAxis>
            <YAxis
              yAxisId="right"
              orientation="right"
              tickFormatter={(v) => `${Math.round(v as number)}%`}
              tick={{ fontSize: 13 }}
              width={48}
              domain={rightDomain}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--muted)', opacity: 0.3 }} />
            <Legend
              verticalAlign="top"
              align="center"
              wrapperStyle={{ paddingBottom: 8 }}
              content={() => <LegendRow items={legendItems} />}
            />
            {mode === 'bep' ? (
              <>
                <Bar
                  yAxisId="left"
                  dataKey="bep"
                  name="손익분기점"
                  fill={BLUE_LIGHT}
                  radius={[3, 3, 0, 0]}
                >
                  <LabelList
                    dataKey="bep"
                    position="top"
                    formatter={amountLabel}
                    style={BAR_LABEL_STYLE}
                  />
                </Bar>
                <Bar yAxisId="left" dataKey="revenue" name="매출" fill={BLUE} radius={[3, 3, 0, 0]}>
                  <LabelList
                    dataKey="revenue"
                    position="top"
                    formatter={amountLabel}
                    style={BAR_LABEL_STYLE}
                  />
                </Bar>
              </>
            ) : (
              <>
                <Bar
                  yAxisId="left"
                  dataKey="cmRate"
                  name="공헌이익률"
                  fill={BLUE}
                  radius={[3, 3, 0, 0]}
                >
                  <LabelList
                    dataKey="cmRate"
                    position="top"
                    formatter={pctLabel}
                    style={BAR_LABEL_STYLE}
                  />
                </Bar>
                <Bar
                  yAxisId="left"
                  dataKey="fixedRatio"
                  name="고정비율"
                  fill={BLUE_LIGHT}
                  radius={[3, 3, 0, 0]}
                >
                  <LabelList
                    dataKey="fixedRatio"
                    position="top"
                    formatter={pctLabel}
                    style={BAR_LABEL_STYLE}
                  />
                </Bar>
              </>
            )}
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="opMargin"
              name="영업이익률"
              stroke={OPMARGIN_COLOR}
              strokeWidth={2.5}
              dot={{ r: 4, fill: OPMARGIN_COLOR }}
              activeDot={{ r: 6 }}
              connectNulls
            >
              <LabelList
                dataKey="opMargin"
                position="top"
                formatter={pctLabel}
                style={{ ...BAR_LABEL_STYLE, fill: OPMARGIN_COLOR }}
                offset={12}
              />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}
