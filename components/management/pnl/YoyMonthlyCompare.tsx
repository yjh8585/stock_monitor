'use client';

import dynamic from 'next/dynamic';
import { Fragment, useMemo, useState } from 'react';
import BasisToggle from './BasisToggle';
import GroupMultiSelect from '@/components/common/GroupMultiSelect';
import { useChartHeight } from '@/lib/useChartHeight';
import { aggregateMonthly, getMonthlyYears } from '@/lib/pnl/aggregate';
import {
  METRIC_LABELS,
  METRIC_ORDER,
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
const ComposedChart = dynamic(() => import('recharts').then((m) => m.ComposedChart), {
  ssr: false,
  loading: ChartFallback,
});
const Line = dynamic(() => import('recharts').then((m) => m.Line), { ssr: false });
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

interface ChartRow {
  month: number;
  monthLabel: string;
  /** 동적 키: `${metric}_base`, `${metric}_compare` */
  [k: string]: number | string | null;
}

/**
 * 추가 3: 전년 대비 전사 월별 비교 차트.
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
  const yearOptions = useMemo(
    () => getMonthlyYears(basisMonthly, basis).map(String),
    [basisMonthly, basis]
  );

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

  // 지표 선택 — 기본: 매출 + 영업이익
  const [selectedMetrics, setSelectedMetrics] = useState<MetricKey[]>(['revenue', 'op_income']);
  const onToggleMetric = (m: string) => {
    setSelectedMetrics((prev) =>
      (prev as string[]).includes(m)
        ? (prev as string[]).filter((x) => x !== m).map((x) => x as MetricKey)
        : [...prev, m as MetricKey]
    );
  };
  const onResetMetrics = () => setSelectedMetrics(['revenue', 'op_income']);

  // 월별 데이터 계산
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

  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <header className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-base font-semibold">추가 3. 전년 대비 월별 비교</h2>
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
          />
        </div>
      </header>
      {chartData.length === 0 || selectedMetrics.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          {selectedMetrics.length === 0 ? '지표를 1개 이상 선택하세요.' : '월별 데이터가 없습니다.'}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={h}>
          <ComposedChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} />
            <YAxis
              tickFormatter={(v: number) => fmtMillion(v)}
              tick={{ fontSize: 11 }}
              width={70}
            />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              contentStyle={{
                backgroundColor: 'var(--card)',
                border: '1px solid var(--border)',
                fontSize: '12px',
              }}
              content={
                <YoyTooltip metrics={selectedMetrics} baseYear={effBase} compareYear={effCompare} />
              }
            />
            <Legend
              verticalAlign="top"
              wrapperStyle={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                gap: '6px 10px',
                paddingBottom: 4,
              }}
            />
            {selectedMetrics.map((m, i) => {
              const color = OEM_COLORS[i % OEM_COLORS.length];
              return (
                <Fragment key={m}>
                  <Line
                    type="monotone"
                    dataKey={`${m}_base`}
                    name={`${METRIC_LABELS[m]} ${effBase}`}
                    stroke={color}
                    strokeWidth={2}
                    dot={{ r: 2 }}
                  />
                  <Line
                    type="monotone"
                    dataKey={`${m}_compare`}
                    name={`${METRIC_LABELS[m]} ${effCompare}`}
                    stroke={color}
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    dot={false}
                  />
                </Fragment>
              );
            })}
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}

/** 호버 툴팁 — 지표별 기준값 / 비교값 / YoY% */
function YoyTooltip({
  active,
  payload,
  label,
  metrics,
  baseYear,
  compareYear,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number | string | null; dataKey: string }>;
  label?: string;
  metrics: MetricKey[];
  baseYear: string;
  compareYear: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  // payload에서 metric별 base/compare 값 추출
  const rows = metrics
    .map((m) => {
      const basePayload = payload.find((p) => p.dataKey === `${m}_base`);
      const comparePayload = payload.find((p) => p.dataKey === `${m}_compare`);
      const baseVal = basePayload ? Number(basePayload.value ?? 0) : 0;
      const compVal = comparePayload ? Number(comparePayload.value ?? 0) : 0;
      const yoy = compVal !== 0 ? ((baseVal - compVal) / Math.abs(compVal)) * 100 : null;
      return { metric: m, baseVal, compVal, yoy };
    })
    .sort((a, b) => Math.abs(b.baseVal) - Math.abs(a.baseVal));
  return (
    <div
      className="rounded-md p-2 text-xs"
      style={{
        backgroundColor: 'var(--card)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="font-semibold mb-1">{label}</div>
      {rows.map((r) => (
        <div key={r.metric} className="mb-0.5">
          <span className="text-muted-foreground">{METRIC_LABELS[r.metric]}:</span>{' '}
          <span className="font-medium">{fmtMillion(r.baseVal)}</span>
          <span className="text-muted-foreground">
            {' '}
            ({baseYear} / 전년 {compareYear} {fmtMillion(r.compVal)} / YoY {fmtYoy(r.yoy)})
          </span>
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
    <label className="inline-flex items-center gap-1.5 text-xs">
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
