'use client';

import dynamic from 'next/dynamic';
import { Fragment, useCallback, useMemo, useState } from 'react';
import BasisToggle from './BasisToggle';
import GroupMultiSelect from '@/components/common/GroupMultiSelect';
import { useChartHeight } from '@/lib/useChartHeight';
import { aggregateMonthly } from '@/lib/pnl/aggregate';
import {
  METRIC_LABELS,
  METRIC_ORDER,
  METRICS_WITH_RATIO,
  type Basis,
  type MetricKey,
  type PnlEntry,
} from '@/lib/pnl/types';
import type { EntriesByBasis } from './PnlDashboard';
import { OEM_COLORS } from '@/components/oem/helpers';

const ChartFallback = () => (
  <div className="h-[280px] md:h-[380px] bg-muted/20 animate-pulse rounded" />
);

// 동적 import
const BarChart = dynamic(() => import('recharts').then((m) => m.BarChart), {
  ssr: false,
  loading: ChartFallback,
});
const Bar = dynamic(() => import('recharts').then((m) => m.Bar), { ssr: false });
const XAxis = dynamic(() => import('recharts').then((m) => m.XAxis), { ssr: false });
const YAxis = dynamic(() => import('recharts').then((m) => m.YAxis), { ssr: false });
const CartesianGrid = dynamic(() => import('recharts').then((m) => m.CartesianGrid), {
  ssr: false,
});
const Tooltip = dynamic(() => import('recharts').then((m) => m.Tooltip), { ssr: false });
const ResponsiveContainer = dynamic(() => import('recharts').then((m) => m.ResponsiveContainer), {
  ssr: false,
});
const Legend = dynamic(() => import('recharts').then((m) => m.Legend), { ssr: false });

interface Props {
  /** 원본 데이터 (월별 행 포함) */
  data: PnlEntry[];
  /** basis별 월별 원본 분리 — 토글 반응성 개선 */
  monthlyByBasis: EntriesByBasis;
}

/** 백만원 천 단위 콤마. null/NaN은 '—' */
function fmtMillion(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return Math.round(n).toLocaleString('ko-KR');
}

/** YoY% 포맷 — null은 '—' */
function fmtYoy(pct: number | null): string {
  if (pct == null) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

/** hex(#RRGGBB) → rgba(r,g,b,a) 변환. fillOpacity 대신 색 자체에 알파를 넣어
 *  Legend가 표시하는 색과 막대의 실제 색이 일치하도록 한다. */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface ChartRow {
  month: number;
  monthLabel: string;
  /** 비율 계산용 매출 (매출이 selectedMetrics에 없어도 항상 채워둠) */
  _baseRev?: number;
  _compareRev?: number;
  /** 동적 키: `${metric}_base`, `${metric}_compare` */
  [k: string]: number | string | null | undefined;
}

/**
 * 10. 전년 대비 전사 월별 비교 차트.
 *
 * - basis 토글 + 기준 연도 + 비교 연도 + 지표 multi-select
 * - X = 1~12월
 * - Y = 선택 지표 (기준 진한 색 / 비교 동일 색 dashed)
 * - 호버: 절대값 + YoY%
 */
export default function YoyMonthlyCompare({ monthlyByBasis }: Props) {
  const [basis, setBasis] = useState<Basis>('consolidated');
  /** 현재 basis의 작은 reference 배열 */
  const basisMonthly = monthlyByBasis[basis];
  // 월별 데이터(period_month=1~12)가 있는 연도만 옵션에 노출 — 빈 차트 옵션을 만들지 않는다.
  // consolidated: 2025, 2026. standalone: 2023, 2024, 2025.
  const yearOptions = useMemo(() => {
    const years = new Set<number>();
    for (const e of basisMonthly) {
      if (e.basis !== basis) continue;
      if (e.period_month < 1 || e.period_month > 12) continue;
      if (e.period_year >= 2023 && e.period_year <= 2026) years.add(e.period_year);
    }
    return Array.from(years)
      .sort((a, b) => a - b)
      .map(String);
  }, [basisMonthly, basis]);

  // 기본: 최신=기준, 그 전 연도=비교
  const defaultBase = yearOptions[yearOptions.length - 1] ?? '';
  const defaultCompare = yearOptions[yearOptions.length - 2] ?? defaultBase;
  const [baseYear, setBaseYear] = useState<string>('');
  const [compareYear, setCompareYear] = useState<string>('');
  const effBase = useMemo(
    () => (baseYear && yearOptions.includes(baseYear) ? baseYear : defaultBase),
    [baseYear, yearOptions, defaultBase]
  );
  const effCompare = useMemo(
    () => (compareYear && yearOptions.includes(compareYear) ? compareYear : defaultCompare),
    [compareYear, yearOptions, defaultCompare]
  );

  // 지표 선택 — 기본: 매출만
  const [selectedMetrics, setSelectedMetrics] = useState<MetricKey[]>(['revenue']);
  const onToggleMetric = (m: string) => {
    const key = m as MetricKey;
    setSelectedMetrics((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]
    );
  };
  const onResetMetrics = () => setSelectedMetrics(['revenue']);

  // 월별 데이터 계산. 비율 계산을 위해 매출(_baseRev / _compareRev)은 항상 포함.
  const chartData: ChartRow[] = useMemo(() => {
    if (!effBase || !effCompare) return [];
    const baseNum = parseInt(effBase, 10);
    const compareNum = parseInt(effCompare, 10);
    const baseAgg = aggregateMonthly(basisMonthly, basis, baseNum);
    const compareAgg = aggregateMonthly(basisMonthly, basis, compareNum);
    const rows: ChartRow[] = [];
    for (let i = 0; i < 12; i += 1) {
      const month = i + 1;
      const row: ChartRow = {
        month,
        monthLabel: `${month}월`,
        _baseRev: baseAgg[i].revenue,
        _compareRev: compareAgg[i].revenue,
      };
      for (const m of selectedMetrics) {
        row[`${m}_base`] = baseAgg[i][m];
        row[`${m}_compare`] = compareAgg[i][m];
      }
      rows.push(row);
    }
    return rows;
  }, [basisMonthly, basis, effBase, effCompare, selectedMetrics]);

  const h = useChartHeight(300, 400, 480);

  const renderLegend = useCallback(
    ({ payload }: { payload?: ReadonlyArray<{ value: unknown; color?: string }> }) => (
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-sm">
        {(payload ?? []).map((entry) => (
          <span
            key={String(entry.value)}
            className="inline-flex items-center gap-1.5 font-medium"
            style={{ color: entry.color }}
          >
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: entry.color }} />
            {String(entry.value)}
          </span>
        ))}
      </div>
    ),
    []
  );

  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <header className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-lg font-semibold">10. 전년 대비 월별 비교</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <BasisToggle value={basis} onChange={setBasis} />
          <YearDropdown label="기준" options={yearOptions} value={effBase} onChange={setBaseYear} />
          <YearDropdown
            label="비교"
            options={yearOptions}
            value={effCompare}
            onChange={setCompareYear}
          />
          <GroupMultiSelect
            label="지표"
            options={METRIC_ORDER}
            selected={selectedMetrics}
            onToggle={onToggleMetric}
            onReset={onResetMetrics}
            getLabel={(m) => METRIC_LABELS[m as MetricKey]}
          />
        </div>
      </header>
      {chartData.length === 0 || selectedMetrics.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          {selectedMetrics.length === 0 ? '지표를 1개 이상 선택하세요.' : '월별 데이터가 없습니다.'}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={h}>
          <BarChart
            data={chartData}
            margin={{ top: 10, right: 20, bottom: 10, left: 10 }}
            barGap={2}
            barCategoryGap="20%"
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="monthLabel" tick={{ fontSize: 14 }} />
            <YAxis
              tickFormatter={(v: number) => fmtMillion(v)}
              tick={{ fontSize: 14 }}
              width={80}
            />
            <Tooltip
              cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
              contentStyle={{
                backgroundColor: 'var(--card)',
                border: '1px solid var(--border)',
                fontSize: '16px',
              }}
              content={
                <YoyTooltip metrics={selectedMetrics} baseYear={effBase} compareYear={effCompare} />
              }
            />
            <Legend
              verticalAlign="top"
              wrapperStyle={{
                paddingBottom: 4,
              }}
              content={renderLegend}
            />
            {selectedMetrics.map((m, i) => {
              const baseColor = OEM_COLORS[i % OEM_COLORS.length];
              const compareColor = hexToRgba(baseColor, 0.45);
              return (
                <Fragment key={m}>
                  <Bar
                    dataKey={`${m}_compare`}
                    name={`${METRIC_LABELS[m]} ${effCompare}`}
                    fill={compareColor}
                    radius={[2, 2, 0, 0]}
                  />
                  <Bar
                    dataKey={`${m}_base`}
                    name={`${METRIC_LABELS[m]} ${effBase}`}
                    fill={baseColor}
                    radius={[2, 2, 0, 0]}
                  />
                </Fragment>
              );
            })}
          </BarChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}

/** 음수면 빨강 볼드 */
function negCls(v: number | null | undefined): string {
  return v != null && v < 0 ? 'text-red-500 font-bold' : 'font-medium';
}

/** 매출 대비 % — 매출이 0이면 null */
function ratio(value: number, rev: number): number | null {
  if (!rev) return null;
  return (value / rev) * 100;
}

function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(1)}%`;
}

/** 호버 툴팁 — 지표별 기준값 / 비교값 / YoY% + 매출 제외 비율(매출 대비 %) */
function YoyTooltip({
  active,
  payload,
  label,
  metrics,
  baseYear,
  compareYear,
}: {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number | string | null;
    dataKey: string;
    payload?: ChartRow;
  }>;
  label?: string;
  metrics: MetricKey[];
  baseYear: string;
  compareYear: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  // 같은 row의 매출(_baseRev / _compareRev) 추출 — 비율 계산용
  const row = payload[0]?.payload;
  const baseRev = Number(row?._baseRev ?? 0);
  const compareRev = Number(row?._compareRev ?? 0);

  const rows = metrics
    .map((m) => {
      const basePayload = payload.find((p) => p.dataKey === `${m}_base`);
      const comparePayload = payload.find((p) => p.dataKey === `${m}_compare`);
      const baseVal = basePayload ? Number(basePayload.value ?? 0) : 0;
      const compVal = comparePayload ? Number(comparePayload.value ?? 0) : 0;
      const yoy = compVal !== 0 ? ((baseVal - compVal) / Math.abs(compVal)) * 100 : null;
      const baseRatio = METRICS_WITH_RATIO.has(m) ? ratio(baseVal, baseRev) : null;
      const compRatio = METRICS_WITH_RATIO.has(m) ? ratio(compVal, compareRev) : null;
      return { metric: m, baseVal, compVal, yoy, baseRatio, compRatio };
    })
    .sort((a, b) => Math.abs(b.baseVal) - Math.abs(a.baseVal));
  return (
    <div
      className="rounded-md p-2 text-base"
      style={{
        backgroundColor: 'var(--card)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="font-semibold mb-1">{label}</div>
      {rows.map((r) => (
        <div key={r.metric} className="mb-1 leading-relaxed">
          <span className="text-muted-foreground">{METRIC_LABELS[r.metric]}:</span>{' '}
          <span className={negCls(r.baseVal)}>{fmtMillion(r.baseVal)}</span>
          {r.baseRatio != null && (
            <span className={`ml-1 ${negCls(r.baseRatio)}`}>[{fmtPct(r.baseRatio)}]</span>
          )}
          <span className="text-muted-foreground"> ({baseYear})</span>
          <span className="text-muted-foreground"> / 전년 {compareYear} </span>
          <span className={negCls(r.compVal)}>{fmtMillion(r.compVal)}</span>
          {r.compRatio != null && (
            <span className={`ml-1 ${negCls(r.compRatio)}`}>[{fmtPct(r.compRatio)}]</span>
          )}
          <span className="text-muted-foreground"> / YoY </span>
          <span className={negCls(r.yoy)}>{fmtYoy(r.yoy)}</span>
        </div>
      ))}
    </div>
  );
}

/** 연도 단일 선택 드롭다운 (native select) */
function YearDropdown({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-sm">
      <span className="text-muted-foreground">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={options.length === 0}
        className="px-2 py-1 rounded-md border border-border bg-background text-foreground hover:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary"
      >
        {options.length === 0 && <option value="">(없음)</option>}
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </label>
  );
}
