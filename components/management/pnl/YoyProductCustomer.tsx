'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import BasisToggle from './BasisToggle';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  aggregateBy,
  entriesForYearOrYtd,
  getDisplayYearLabels,
  ytdMonthsOfYear,
} from '@/lib/pnl/aggregate';
import type { AggregatedRow, Basis, PnlEntry } from '@/lib/pnl/types';
import type { EntriesByBasis } from './PnlDashboard';
import { useChartHeight } from '@/lib/useChartHeight';

const ChartFallback = () => <div className="h-[260px] bg-muted/20 animate-pulse rounded" />;

// 모달 내부 라인 차트용 동적 import
const LineChart = dynamic(() => import('recharts').then((m) => m.LineChart), {
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
  /** 원본 데이터 (월별 + 연간) */
  data: PnlEntry[];
  /** 연간 derive 후 (집계용) */
  annualEntries: PnlEntry[];
  /** basis별 연간 분리 — 토글 반응성 개선 */
  annualByBasis: EntriesByBasis;
  /** basis별 월별 원본 분리 — 모달 라인 차트 성능 개선 */
  monthlyByBasis: EntriesByBasis;
}

const TOP_N = 20;

/** 백만원 천 단위 콤마. null/NaN은 '—' */
function fmtMillion(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return Math.round(n).toLocaleString('ko-KR');
}

/** YoY% 포맷 */
function fmtYoy(pct: number | null): string {
  if (pct == null) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

interface HeatmapCell {
  product: string;
  customer: string;
  baseRevenue: number;
  compareRevenue: number;
  yoy: number | null;
}

/**
 * 9. 제품·고객 YoY heatmap + 셀 클릭 시 월별 추이 모달.
 *
 * - basis 토글 + 2개 연도 선택
 * - 행 = 제품(매출 상위), 열 = 고객(매출 상위)
 * - 셀 색조: YoY% (양수=초록, 음수=빨강)
 */
export default function YoyProductCustomer({ annualByBasis, monthlyByBasis }: Props) {
  const [basis, setBasis] = useState<Basis>('consolidated');
  /** 현재 basis의 작은 reference 배열들 */
  const basisAnnual = annualByBasis[basis];
  const basisMonthly = monthlyByBasis[basis];
  // YoY는 직전 연도와 비교 — 2023을 base로 두면 2022 데이터가 없어 yoy=0이 된다.
  const yearLabels = useMemo(
    () => getDisplayYearLabels(basisAnnual, basis).filter((y) => !y.startsWith('2023')),
    [basisAnnual, basis]
  );

  const defaultBase = yearLabels[yearLabels.length - 1] ?? '';
  const [baseYear, setBaseYear] = useState<string>('');
  const effBase = useMemo(
    () => (baseYear && yearLabels.includes(baseYear) ? baseYear : defaultBase),
    [baseYear, yearLabels, defaultBase]
  );

  /**
   * 비교 = 기준 직전 연도. yearLabels에 '2025(E)' 등 suffix가 있을 수 있어 4자리 prefix로 매칭.
   */
  const effCompare = useMemo(() => {
    if (!effBase) return '';
    const m = effBase.match(/(\d{4})/);
    if (!m) return effBase;
    const prev = String(parseInt(m[1], 10) - 1);
    return yearLabels.find((y) => y.startsWith(prev)) ?? effBase;
  }, [effBase, yearLabels]);

  /** 기준 연도가 진행 중이면 비교도 동일 월수까지 잘라 비교 (2026 1~N월 vs 2025 1~N월). */
  const baseYearNum = useMemo(() => {
    const m = effBase.match(/(\d{4})/);
    return m ? parseInt(m[1], 10) : 0;
  }, [effBase]);
  const ytdMonths = useMemo(
    () => (baseYearNum ? ytdMonthsOfYear(basisMonthly, basis, baseYearNum) : 0),
    [basisMonthly, basis, baseYearNum]
  );

  // 매출 상위 N개 (제품, 고객) 쌍 추출 + YoY 계산
  const { rows, products, customers, maxAbsYoy } = useMemo(() => {
    if (!effBase) return { rows: [], products: [], customers: [], maxAbsYoy: 0 };
    const baseEntries = entriesForYearOrYtd(basisAnnual, basisMonthly, basis, effBase, ytdMonths);
    const compareEntries = entriesForYearOrYtd(
      basisAnnual,
      basisMonthly,
      basis,
      effCompare,
      ytdMonths
    );

    const baseAgg = aggregateBy(baseEntries, ['product', 'customer']);
    const compareAgg = aggregateBy(compareEntries, ['product', 'customer']);
    const compareMap = new Map<string, AggregatedRow>();
    for (const r of compareAgg) compareMap.set(r.key, r);

    const cells: HeatmapCell[] = baseAgg
      .map((r) => {
        const compRow = compareMap.get(r.key);
        const compRev = compRow?.revenue ?? 0;
        const yoy = compRev !== 0 ? ((r.revenue - compRev) / Math.abs(compRev)) * 100 : null;
        return {
          product: r.dims.product || '(미분류)',
          customer: r.dims.customer || '(미분류)',
          baseRevenue: r.revenue,
          compareRevenue: compRev,
          yoy,
        };
      })
      .filter((c) => c.baseRevenue > 0 || c.compareRevenue > 0)
      .sort((a, b) => b.baseRevenue - a.baseRevenue)
      .slice(0, TOP_N);

    const productSet = new Set<string>();
    const customerSet = new Set<string>();
    for (const c of cells) {
      productSet.add(c.product);
      customerSet.add(c.customer);
    }
    const products = Array.from(productSet).sort((a, b) => a.localeCompare(b, 'ko'));
    const customers = Array.from(customerSet).sort((a, b) => a.localeCompare(b, 'ko'));
    let maxAbsYoy = 0;
    for (const c of cells) {
      if (c.yoy != null && Math.abs(c.yoy) > maxAbsYoy) maxAbsYoy = Math.abs(c.yoy);
    }
    if (maxAbsYoy === 0) maxAbsYoy = 1;
    return { rows: cells, products, customers, maxAbsYoy };
  }, [basisAnnual, basisMonthly, basis, effBase, effCompare, ytdMonths]);

  /** 빠른 lookup */
  const cellMap = useMemo(() => {
    const m = new Map<string, HeatmapCell>();
    for (const c of rows) m.set(`${c.product}|${c.customer}`, c);
    return m;
  }, [rows]);

  // 모달 상태
  const [openCell, setOpenCell] = useState<{ product: string; customer: string } | null>(null);

  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <header className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-base font-semibold">9. 제품·고객 YoY 매트릭스</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <BasisToggle value={basis} onChange={setBasis} />
          <YearDropdown label="연도" options={yearLabels} value={effBase} onChange={setBaseYear} />
        </div>
      </header>
      {rows.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          선택한 조건에 해당하는 데이터가 없습니다.
        </div>
      ) : (
        <>
          <div className="text-[11px] text-muted-foreground mb-2">
            매출 상위 {TOP_N}쌍 표시 · 셀 클릭 시 월별 추이 차트 · 색조: 빨강(YoY 감소) ~ 초록(YoY
            증가)
            {ytdMonths >= 1 && ytdMonths <= 11 && (
              <span className="ml-1">
                · 진행 중: {effBase} 1~{ytdMonths}월 누적 vs {effCompare} 1~{ytdMonths}월 누적
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="text-xs border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-card p-2 text-left border-b border-border min-w-[140px]">
                    제품 \ 고객
                  </th>
                  {customers.map((c) => (
                    <th
                      key={c}
                      className="p-2 text-center border-b border-border font-medium min-w-[80px] text-muted-foreground whitespace-nowrap"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p}>
                    <td
                      className="sticky left-0 z-[5] bg-card p-2 border-b border-border/50 font-medium whitespace-nowrap"
                      title={p}
                    >
                      {p}
                    </td>
                    {customers.map((c) => {
                      const cell = cellMap.get(`${p}|${c}`);
                      return (
                        <HeatCell
                          key={c}
                          cell={cell}
                          maxAbsYoy={maxAbsYoy}
                          onClick={() => cell && setOpenCell({ product: p, customer: c })}
                        />
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <Dialog open={!!openCell} onOpenChange={(v) => !v && setOpenCell(null)}>
        <DialogContent className="!max-w-3xl">
          {openCell && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {openCell.product} · {openCell.customer} 월별 매출 추이
                </DialogTitle>
              </DialogHeader>
              <MonthlyTrendChart
                data={basisMonthly}
                basis={basis}
                product={openCell.product}
                customer={openCell.customer}
                baseYear={effBase}
                compareYear={effCompare}
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** 단일 셀 — YoY 색조 + 클릭 핸들러 */
function HeatCell({
  cell,
  maxAbsYoy,
  onClick,
}: {
  cell: HeatmapCell | undefined;
  maxAbsYoy: number;
  onClick: () => void;
}) {
  if (!cell) {
    return <td className="p-2 text-center border-b border-border/50 text-muted-foreground">—</td>;
  }
  const yoy = cell.yoy;
  let bg = 'transparent';
  if (yoy != null) {
    const intensity = Math.min(1, Math.abs(yoy) / maxAbsYoy) * 0.7 + 0.1;
    bg = yoy >= 0 ? `rgba(34, 197, 94, ${intensity})` : `rgba(239, 68, 68, ${intensity})`;
  }
  const textColor =
    yoy != null && Math.abs(yoy) / maxAbsYoy > 0.6 ? 'text-white' : 'text-foreground';
  const tooltip = `${cell.product} · ${cell.customer}\n기준: ${fmtMillion(cell.baseRevenue)} 백만원\n비교: ${fmtMillion(cell.compareRevenue)} 백만원\nYoY: ${fmtYoy(yoy)}`;
  return (
    <td
      role="cell"
      className={`p-2 text-center border-b border-border/50 tabular-nums cursor-pointer hover:opacity-80 ${textColor}`}
      style={{ backgroundColor: bg }}
      title={tooltip}
      onClick={onClick}
    >
      <div className="font-medium">{fmtYoy(yoy)}</div>
      <div className="text-[10px] opacity-80">{fmtMillion(cell.baseRevenue)}</div>
    </td>
  );
}

/** 모달 내부 — 월별 매출 추이 (기준/비교 연도 2개 라인) */
function MonthlyTrendChart({
  data,
  basis,
  product,
  customer,
  baseYear,
  compareYear,
}: {
  data: PnlEntry[];
  basis: Basis;
  product: string;
  customer: string;
  baseYear: string;
  compareYear: string;
}) {
  const h = useChartHeight(260, 320, 380);
  const chartData = useMemo(() => {
    const baseY = parseInt(baseYear, 10);
    const compY = parseInt(compareYear, 10);
    const months: Array<{
      month: string;
      base: number;
      compare: number;
    }> = [];
    for (let m = 1; m <= 12; m += 1) {
      let baseRev = 0;
      let compRev = 0;
      for (const e of data) {
        if (e.basis !== basis) continue;
        if (e.period_month !== m) continue;
        if (e.product !== product) continue;
        if (e.customer !== customer) continue;
        if (e.period_year === baseY) baseRev += e.revenue ?? 0;
        else if (e.period_year === compY) compRev += e.revenue ?? 0;
      }
      months.push({ month: `${m}월`, base: baseRev, compare: compRev });
    }
    return months;
  }, [data, basis, product, customer, baseYear, compareYear]);

  return (
    <div className="mt-2">
      <div className="text-[11px] text-muted-foreground mb-2">
        매출 (백만원) · {baseYear} (실선) vs {compareYear} (점선)
      </div>
      <ResponsiveContainer width="100%" height={h}>
        <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={(v: number) => fmtMillion(v)} tick={{ fontSize: 11 }} width={70} />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              fontSize: '12px',
            }}
            formatter={(v) => `${fmtMillion(Number(v))} 백만원`}
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
          <Line
            type="monotone"
            dataKey="base"
            name={baseYear}
            stroke="#2563eb"
            strokeWidth={2}
            dot={{ r: 2 }}
          />
          <Line
            type="monotone"
            dataKey="compare"
            name={compareYear}
            stroke="#2563eb"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 연도 단일 선택 (재사용 위해 내부 정의 — YoyMonthlyCompare와 동일 패턴) */
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
