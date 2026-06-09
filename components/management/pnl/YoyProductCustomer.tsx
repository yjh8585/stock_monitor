'use client';

import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TOOLTIP_CONTENT_STYLE } from '@/components/charts/chartTheme';
import BasisToggle from './BasisToggle';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { aggregateBy, prepareYoYView } from '@/lib/pnl/aggregate';
import type { AggregatedRow, Basis, PnlEntry } from '@/lib/pnl/types';
import type { EntriesByBasis } from './PnlDashboard';
import { useChartHeight } from '@/lib/useChartHeight';

interface Props {
  /** 연간 derive 후 (집계용) */
  annualEntries: PnlEntry[];
  /** basis별 연간 분리 — 토글 반응성 개선 */
  annualByBasis: EntriesByBasis;
  /** basis별 월별 원본 분리 — 모달 라인 차트 성능 개선 */
  monthlyByBasis: EntriesByBasis;
}

const TOP_N = 20;

/**
 * 제품 표시 순서 — 사용자 지정.
 * 목록에 없는 제품은 뒤에 가나다순으로 붙는다.
 */
const PRODUCT_ORDER: readonly string[] = [
  'HALFSHAFT',
  'CALIPER BRK.',
  'POWER BRK.',
  'DRUM BRK.',
  'DRUM',
  'COLUMN',
  'INTERM',
  'GEAR',
  'Alternator',
  'EGR VALVE',
  'ADAS',
];

function productRank(name: string): number {
  const i = PRODUCT_ORDER.indexOf(name);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

function sortProducts(names: readonly string[]): string[] {
  return [...names].sort((a, b) => {
    const ra = productRank(a);
    const rb = productRank(b);
    if (ra !== rb) return ra - rb;
    // 둘 다 목록 외 → 가나다순
    return a.localeCompare(b, 'ko');
  });
}

/**
 * 고객 표시 순서 — 사용자 지정.
 * 같은 모회사 그룹사 우선(Stellantis NA→EU, VW NA→EU→Porsche), 이어 주요 거래처.
 * 목록에 없는 고객은 뒤에 가나다순으로 붙는다.
 */
const CUSTOMER_ORDER: readonly string[] = [
  'Stellantis NA',
  'Stellantis EU',
  'VW NA',
  'VW EU',
  'Porsche',
  'RIVIAN',
  'Vinfast',
  '군수사업',
  'KG모빌리티',
  'GMK',
  'GM 직수출',
  'UZ Auto',
  'POLARIS',
  'HKMC',
  '직수출',
];

function customerRank(name: string): number {
  const i = CUSTOMER_ORDER.indexOf(name);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

function sortCustomers(names: readonly string[]): string[] {
  return [...names].sort((a, b) => {
    const ra = customerRank(a);
    const rb = customerRank(b);
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b, 'ko');
  });
}

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
  // YoY 비교 준비 (1~5단계 통합) — MarginScatter와 동일 패턴.
  const [baseYear, setBaseYear] = useState<string>('');
  const view = useMemo(
    () => prepareYoYView(basisAnnual, basisMonthly, basis, baseYear),
    [basisAnnual, basisMonthly, basis, baseYear]
  );
  const { yearLabels, effBase, effCompare, ytdMonths, baseEntries, compareEntries } = view;

  // 매출 상위 N개 (제품, 고객) 쌍 추출 + YoY 계산
  const { rows, products, customers, maxAbsYoy } = useMemo(() => {
    if (!effBase) return { rows: [], products: [], customers: [], maxAbsYoy: 0 };
    const baseAgg = aggregateBy(baseEntries, ['product', 'customer']);
    const compareAgg = aggregateBy(compareEntries, ['product', 'customer']);
    // key 정규화: 빈 dim → '(미분류)' (표시값과 매핑 일치)
    const normKey = (p: string, c: string) => `${p || '(미분류)'} | ${c || '(미분류)'}`;
    const baseMap = new Map<string, AggregatedRow>();
    for (const r of baseAgg) baseMap.set(normKey(r.dims.product, r.dims.customer), r);
    const compareMap = new Map<string, AggregatedRow>();
    for (const r of compareAgg) compareMap.set(normKey(r.dims.product, r.dims.customer), r);

    // 1) TOP 20 매출 쌍으로 표시 축(product/customer) 결정
    const topPairs = baseAgg
      .filter((r) => r.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, TOP_N);
    const productSet = new Set<string>();
    const customerSet = new Set<string>();
    for (const r of topPairs) {
      productSet.add(r.dims.product || '(미분류)');
      customerSet.add(r.dims.customer || '(미분류)');
    }
    // 주요 제품(PRODUCT_ORDER)은 해당 연도에 매출이 있으면 TOP20과 무관하게 항상 행 표시.
    // COLUMN은 보이는데 INTERM은 TOP20 밖이라 누락되던 불일치 방지.
    for (const r of baseAgg) {
      if (r.revenue > 0 && PRODUCT_ORDER.includes(r.dims.product)) {
        productSet.add(r.dims.product);
      }
    }
    const products = sortProducts(Array.from(productSet));
    const customers = sortCustomers(Array.from(customerSet));

    // 2) 결정된 축의 모든 교차 셀을 다시 채워 YoY 표시 — TOP 20 밖이라도 같은 축의 매출이면 보임
    const cells: HeatmapCell[] = [];
    for (const product of products) {
      for (const customer of customers) {
        const baseRow = baseMap.get(normKey(product, customer));
        const compRow = compareMap.get(normKey(product, customer));
        const baseRev = baseRow?.revenue ?? 0;
        const compRev = compRow?.revenue ?? 0;
        if (baseRev === 0 && compRev === 0) continue;
        const yoy = compRev !== 0 ? ((baseRev - compRev) / Math.abs(compRev)) * 100 : null;
        cells.push({ product, customer, baseRevenue: baseRev, compareRevenue: compRev, yoy });
      }
    }

    let maxAbsYoy = 0;
    for (const c of cells) {
      if (c.yoy != null && Math.abs(c.yoy) > maxAbsYoy) maxAbsYoy = Math.abs(c.yoy);
    }
    if (maxAbsYoy === 0) maxAbsYoy = 1;
    return { rows: cells, products, customers, maxAbsYoy };
  }, [baseEntries, compareEntries, effBase]);

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
        <h2 className="text-lg font-semibold">
          14. 제품·고객 YoY 매트릭스{' '}
          <span className="text-sm font-normal text-muted-foreground">
            · 셀=YoY% · 툴팁=매출 백만원
          </span>
        </h2>
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
          <div className="text-sm text-muted-foreground mb-2">
            매출 상위 {TOP_N}쌍 표시 · 셀 클릭 시 월별 추이 차트 · 색조: 빨강(YoY 감소) ~ 초록(YoY
            증가)
            {ytdMonths >= 1 && ytdMonths <= 11 && (
              <span className="ml-1">
                · 진행 중: {effBase} 1~{ytdMonths}월 누적 vs {effCompare} 1~{ytdMonths}월 누적
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="text-base border-separate border-spacing-0">
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
      <div className="text-sm opacity-80">{fmtMillion(cell.baseRevenue)}</div>
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
      <div className="text-sm text-muted-foreground mb-2">
        매출 (백만원) · {baseYear} (실선) vs {compareYear} (점선)
      </div>
      <ResponsiveContainer width="100%" height={h}>
        <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="month" tick={{ fontSize: 14 }} />
          <YAxis tickFormatter={(v: number) => fmtMillion(v)} tick={{ fontSize: 14 }} width={70} />
          <Tooltip
            contentStyle={TOOLTIP_CONTENT_STYLE}
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
