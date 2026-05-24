'use client';

import { Fragment, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import BasisToggle from './BasisToggle';
import GroupMultiSelect from '@/components/common/GroupMultiSelect';
import { useChartHeight } from '@/lib/useChartHeight';
import { aggregateMonthly } from '@/lib/pnl/aggregate';
import { METRIC_LABELS, type Basis, type MetricKey, type PnlEntry } from '@/lib/pnl/types';
import type { EntriesByBasis } from './PnlDashboard';
import { OEM_COLORS } from '@/components/oem/helpers';

interface Props {
  monthlyByBasis: EntriesByBasis;
}

const SUPPORTED_METRICS: readonly MetricKey[] = ['revenue', 'op_income'];

function fmtMillion(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return Math.round(n).toLocaleString('ko-KR');
}

function fmtYoy(pct: number | null): string {
  if (pct == null) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface ChartRow {
  month: number;
  monthLabel: string;
  base: number;
  compare: number;
}

/**
 * 11. 전년 대비 월별 비교 — 고객·제품 필터 + 단일 지표(매출/영업이익).
 *
 * - 9번과 동일한 막대 비교 패턴, 단 지표는 매출/영업이익 중 1개만 선택(디폴트=매출)
 * - 고객/제품 multi-select 필터 — 미선택 = 전체
 */
export default function YoyMonthlyFiltered({ monthlyByBasis }: Props) {
  const [basis, setBasis] = useState<Basis>('consolidated');
  const basisMonthly = monthlyByBasis[basis];

  /** 월별 데이터가 존재하는 연도 옵션 (2023~2026 범위) */
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

  /** 단일 지표 선택 — 디폴트 매출 */
  const [metric, setMetric] = useState<MetricKey>('revenue');

  /** 고객·제품 옵션 (현재 basis 월별 데이터에서 매출 desc 정렬) */
  const customerOptions = useMemo(() => {
    const totals = new Map<string, number>();
    for (const e of basisMonthly) {
      if (e.basis !== basis) continue;
      if (e.period_month < 1 || e.period_month > 12) continue;
      const v = e.revenue ?? 0;
      totals.set(e.customer, (totals.get(e.customer) ?? 0) + v);
    }
    return Array.from(totals.entries())
      .filter(([c]) => c.length > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([c]) => c);
  }, [basisMonthly, basis]);

  const productOptions = useMemo(() => {
    const totals = new Map<string, number>();
    for (const e of basisMonthly) {
      if (e.basis !== basis) continue;
      if (e.period_month < 1 || e.period_month > 12) continue;
      const v = e.revenue ?? 0;
      totals.set(e.product, (totals.get(e.product) ?? 0) + v);
    }
    return Array.from(totals.entries())
      .filter(([p]) => p.length > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([p]) => p);
  }, [basisMonthly, basis]);

  const [selectedCustomers, setSelectedCustomers] = useState<string[]>(['Stellantis NA']);
  const [selectedProducts, setSelectedProducts] = useState<string[]>(['HALFSHAFT']);
  const onToggleCustomer = (c: string) =>
    setSelectedCustomers((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  const onToggleProduct = (p: string) =>
    setSelectedProducts((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const chartData: ChartRow[] = useMemo(() => {
    if (!effBase || !effCompare) return [];
    const baseNum = parseInt(effBase, 10);
    const compareNum = parseInt(effCompare, 10);
    const filter = (e: PnlEntry) => {
      if (selectedCustomers.length > 0 && !selectedCustomers.includes(e.customer)) return false;
      if (selectedProducts.length > 0 && !selectedProducts.includes(e.product)) return false;
      return true;
    };
    const baseAgg = aggregateMonthly(basisMonthly, basis, baseNum, filter);
    const compareAgg = aggregateMonthly(basisMonthly, basis, compareNum, filter);
    const rows: ChartRow[] = [];
    for (let i = 0; i < 12; i += 1) {
      rows.push({
        month: i + 1,
        monthLabel: `${i + 1}월`,
        base: baseAgg[i][metric],
        compare: compareAgg[i][metric],
      });
    }
    return rows;
  }, [basisMonthly, basis, effBase, effCompare, metric, selectedCustomers, selectedProducts]);

  const h = useChartHeight(300, 400, 480);
  const baseColor = OEM_COLORS[0];
  const compareColor = hexToRgba(baseColor, 0.45);

  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <header className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-lg font-semibold">11. 전년 대비 월별 비교 (고객·제품 선택)</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <BasisToggle value={basis} onChange={setBasis} />
          <YearDropdown label="기준" options={yearOptions} value={effBase} onChange={setBaseYear} />
          <YearDropdown
            label="비교"
            options={yearOptions}
            value={effCompare}
            onChange={setCompareYear}
          />
          <MetricToggle value={metric} onChange={setMetric} />
          <GroupMultiSelect
            label="고객"
            options={customerOptions}
            selected={selectedCustomers}
            onToggle={onToggleCustomer}
            onReset={() => setSelectedCustomers([])}
          />
          <GroupMultiSelect
            label="제품"
            options={productOptions}
            selected={selectedProducts}
            onToggle={onToggleProduct}
            onReset={() => setSelectedProducts([])}
          />
        </div>
      </header>
      {chartData.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          월별 데이터가 없습니다.
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
                <FilteredTooltip metric={metric} baseYear={effBase} compareYear={effCompare} />
              }
            />
            <Legend
              verticalAlign="top"
              wrapperStyle={{ paddingBottom: 4 }}
              content={({ payload }) => (
                <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-sm">
                  {(payload ?? []).map((entry) => (
                    <span
                      key={String(entry.value)}
                      className="inline-flex items-center gap-1.5 font-medium"
                      style={{ color: entry.color }}
                    >
                      <span
                        className="inline-block w-3 h-3 rounded-sm"
                        style={{ background: entry.color }}
                      />
                      {entry.value}
                    </span>
                  ))}
                </div>
              )}
            />
            <Fragment>
              <Bar
                dataKey="compare"
                name={`${METRIC_LABELS[metric]} ${effCompare}`}
                fill={compareColor}
                radius={[2, 2, 0, 0]}
              />
              <Bar
                dataKey="base"
                name={`${METRIC_LABELS[metric]} ${effBase}`}
                fill={baseColor}
                radius={[2, 2, 0, 0]}
              />
            </Fragment>
          </BarChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}

function negCls(v: number | null | undefined): string {
  return v != null && v < 0 ? 'text-red-500 font-bold' : 'font-medium';
}

function FilteredTooltip({
  active,
  payload,
  label,
  metric,
  baseYear,
  compareYear,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number | string | null }>;
  label?: string;
  metric: MetricKey;
  baseYear: string;
  compareYear: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const basePayload = payload.find((p) => p.dataKey === 'base');
  const comparePayload = payload.find((p) => p.dataKey === 'compare');
  const baseVal = basePayload ? Number(basePayload.value ?? 0) : 0;
  const compVal = comparePayload ? Number(comparePayload.value ?? 0) : 0;
  const yoy = compVal !== 0 ? ((baseVal - compVal) / Math.abs(compVal)) * 100 : null;
  return (
    <div
      className="rounded-md p-2 text-base"
      style={{
        backgroundColor: 'var(--card)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="font-semibold mb-1">{label}</div>
      <div className="mb-1 leading-relaxed">
        <span className="text-muted-foreground">{METRIC_LABELS[metric]}:</span>{' '}
        <span className={negCls(baseVal)}>{fmtMillion(baseVal)}</span>
        <span className="text-muted-foreground"> ({baseYear})</span>
        <span className="text-muted-foreground"> / 전년 {compareYear} </span>
        <span className={negCls(compVal)}>{fmtMillion(compVal)}</span>
        <span className="text-muted-foreground"> / YoY </span>
        <span className={negCls(yoy)}>{fmtYoy(yoy)}</span>
      </div>
    </div>
  );
}

/** 매출/영업이익 토글 (세그먼트 버튼) */
function MetricToggle({ value, onChange }: { value: MetricKey; onChange: (v: MetricKey) => void }) {
  return (
    <div className="inline-flex items-center rounded-md border border-border bg-muted/40 p-0.5">
      {SUPPORTED_METRICS.map((m) => {
        const active = m === value;
        return (
          <button
            key={m}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(m)}
            className={`text-sm px-2.5 py-1 rounded-sm transition-colors ${
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {METRIC_LABELS[m]}
          </button>
        );
      })}
    </div>
  );
}

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
