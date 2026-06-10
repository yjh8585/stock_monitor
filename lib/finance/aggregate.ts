/**
 * 재무(/management/finance) 순수 집계 빌더.
 *
 * - 단위 환산: DB는 백만원(value_mwon), UI는 억원 → `value_mwon / 100`.
 * - 시점 규칙: 한 연도에 월별(monthly) 행이 있으면 최신월(YTD), 없으면 연말(annual).
 *   대차대조표라 과거(연말)와 당해연도(최신월)를 한 축에 섞어 추이를 본다.
 * - 부채비율 = 부채 / 자본(자기자본) × 100 (한국 표준, 자산=부채+자본과 정합).
 */
import type { CapitalRow, CapitalTable, FinanceDelta, FinanceRow, LeveragePoint } from './types';

const MWON_TO_EOK = 100; // 1억원 = 100백만원

/** 시점 선택 결과 — (연도, 기간종류, 대표월). */
interface PeriodSel {
  year: number;
  kind: 'annual' | 'monthly';
  month: number;
  label: string;
  isYtd: boolean;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 연도별 대표 시점 선택 (오름차순). 월별 있으면 최신월(YTD), 없으면 연말. */
function selectPeriods(rows: readonly FinanceRow[]): PeriodSel[] {
  const years = [...new Set(rows.map((r) => r.period_year))].sort((a, b) => a - b);
  const out: PeriodSel[] = [];
  for (const y of years) {
    const yearRows = rows.filter((r) => r.period_year === y);
    const monthly = yearRows.filter((r) => r.period_kind === 'monthly');
    if (monthly.length > 0) {
      const maxM = Math.max(...monthly.map((r) => r.period_month));
      out.push({ year: y, kind: 'monthly', month: maxM, label: `${y}.${pad2(maxM)}`, isYtd: true });
      continue;
    }
    const annual = yearRows.filter((r) => r.period_kind === 'annual');
    if (annual.length === 0) continue;
    out.push({
      year: y,
      kind: 'annual',
      month: annual[0].period_month,
      label: `${y}`,
      isYtd: false,
    });
  }
  return out;
}

/** 특정 시점·계정의 값(억원). 해당 행이 없거나 전부 null이면 null. */
function valueEok(rows: readonly FinanceRow[], sel: PeriodSel, account: string): number | null {
  let sum: number | null = null;
  for (const r of rows) {
    if (
      r.period_year === sel.year &&
      r.period_kind === sel.kind &&
      r.period_month === sel.month &&
      r.account === account &&
      r.value_mwon !== null
    ) {
      sum = (sum ?? 0) + r.value_mwon;
    }
  }
  return sum === null ? null : sum / MWON_TO_EOK;
}

/** 시점 배열에 대해 한 계정의 억원 시계열. */
function seriesFor(
  rows: readonly FinanceRow[],
  periods: PeriodSel[],
  account: string
): (number | null)[] {
  return periods.map((p) => valueEok(rows, p, account));
}

/** 부호 있는 시계열 합산. 모두 null이면 null, 하나라도 있으면 null=0으로 더함. */
function combine(
  parts: { series: (number | null)[]; sign: 1 | -1 }[],
  len: number
): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < len; i++) {
    let sum: number | null = null;
    for (const { series, sign } of parts) {
      const v = series[i];
      if (v !== null) sum = (sum ?? 0) + sign * v;
    }
    out.push(sum);
  }
  return out;
}

/** 필터 버튼용 자회사 목록. '전체' 우선, 나머지는 한글 정렬. */
export function listSubsidiaries(rows: readonly FinanceRow[]): string[] {
  const set = new Set(rows.map((r) => r.subsidiary));
  const rest = [...set].filter((s) => s !== '전체').sort((a, b) => a.localeCompare(b, 'ko'));
  return set.has('전체') ? ['전체', ...rest] : rest;
}

/** 차트 1 — 자회사별 자산·부채·부채비율 시계열(억원). */
export function buildLeverageSeries(
  rows: readonly FinanceRow[],
  subsidiary: string
): LeveragePoint[] {
  const sub = rows.filter((r) => r.subsidiary === subsidiary);
  const periods = selectPeriods(sub);
  return periods.map((p) => {
    const assets = valueEok(sub, p, '자산');
    const liabilities = valueEok(sub, p, '부채');
    const equity = valueEok(sub, p, '자본');
    const debtRatio =
      liabilities !== null && equity !== null && equity !== 0 ? (liabilities / equity) * 100 : null;
    return { periodLabel: p.label, year: p.year, isYtd: p.isYtd, assets, liabilities, debtRatio };
  });
}

/**
 * 차트 2 — 투하자본·자금조달 표 (기본 전체/연결).
 *
 *   투하자본
 *    ├ 순운전자본 = 채권 + 재고 − 채무
 *    │   채권 · 재고 · 채무(차감)
 *    ├ CAPEX = 유형자산 + 무형자산
 *    │   유형자산 · 무형자산
 *    └ 투하자본 합계 = 순운전자본 + CAPEX
 *   자금조달
 *      현금 · 증자 · 차입금
 *      자금조달 합계 = 현금 + 증자 + 차입금
 */
export function buildCapitalTable(rows: readonly FinanceRow[], subsidiary = '전체'): CapitalTable {
  const sub = rows.filter((r) => r.subsidiary === subsidiary);
  const periods = selectPeriods(sub);
  const n = periods.length;
  if (n === 0) return { periods: [], rows: [] };

  const receivable = seriesFor(sub, periods, '채권');
  const inventory = seriesFor(sub, periods, '재고');
  const payable = seriesFor(sub, periods, '채무');
  const tangible = seriesFor(sub, periods, '유형자산');
  const intangible = seriesFor(sub, periods, '무형자산');
  const cash = seriesFor(sub, periods, '현금성자산');
  const paidIn = seriesFor(sub, periods, '증자');
  const debt = seriesFor(sub, periods, '차입');

  const nwc = combine(
    [
      { series: receivable, sign: 1 },
      { series: inventory, sign: 1 },
      { series: payable, sign: -1 },
    ],
    n
  );
  const capex = combine(
    [
      { series: tangible, sign: 1 },
      { series: intangible, sign: 1 },
    ],
    n
  );
  const invested = combine(
    [
      { series: nwc, sign: 1 },
      { series: capex, sign: 1 },
    ],
    n
  );
  const financing = combine(
    [
      { series: cash, sign: 1 },
      { series: paidIn, sign: 1 },
      { series: debt, sign: 1 },
    ],
    n
  );

  const tableRows: CapitalRow[] = [
    { key: 'invested', label: '투하자본', level: 0, kind: 'section', values: Array(n).fill(null) },
    { key: 'nwc', label: '순운전자본', level: 1, kind: 'subtotal', values: nwc },
    { key: 'receivable', label: '채권', level: 2, kind: 'detail', values: receivable },
    { key: 'inventory', label: '재고', level: 2, kind: 'detail', values: inventory },
    { key: 'payable', label: '채무', level: 2, kind: 'detail', subtract: true, values: payable },
    { key: 'capex', label: 'CAPEX', level: 1, kind: 'subtotal', values: capex },
    { key: 'tangible', label: '유형자산', level: 2, kind: 'detail', values: tangible },
    { key: 'intangible', label: '무형자산', level: 2, kind: 'detail', values: intangible },
    { key: 'invested_total', label: '투하자본 합계', level: 0, kind: 'total', values: invested },
    { key: 'financing', label: '자금조달', level: 0, kind: 'section', values: Array(n).fill(null) },
    { key: 'cash', label: '현금', level: 1, kind: 'detail', values: cash },
    { key: 'paidIn', label: '증자', level: 1, kind: 'detail', values: paidIn },
    { key: 'debt', label: '차입금', level: 1, kind: 'detail', values: debt },
    { key: 'financing_total', label: '자금조달 합계', level: 0, kind: 'total', values: financing },
  ];

  return { periods: periods.map((p) => p.label), rows: tableRows };
}

/** 구간 증감 (curr − prev) + 증감률(%). 한쪽이라도 null이면 null. */
export function computeDelta(prev: number | null, curr: number | null): FinanceDelta {
  if (prev === null || curr === null) return { abs: null, pct: null };
  const abs = curr - prev;
  const pct = prev === 0 ? null : (abs / Math.abs(prev)) * 100;
  return { abs, pct };
}
