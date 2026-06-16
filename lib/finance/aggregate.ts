/**
 * 재무(/management/finance) 순수 집계 빌더.
 *
 * - 단위 환산: DB는 백만원(value_mwon), UI는 억원 → `value_mwon / 100`.
 * - 시점 규칙: 한 연도에 월별(monthly) 행이 있으면 최신월(YTD), 없으면 연말(annual).
 *   대차대조표라 과거(연말)와 당해연도(최신월)를 한 축에 섞어 추이를 본다.
 * - 부채비율 = 부채 / 자본(자기자본) × 100 (한국 표준, 자산=부채+자본과 정합).
 */
import type {
  CapitalRow,
  CapitalTable,
  FinanceDelta,
  FinanceRow,
  InterestRatePoint,
  LeveragePoint,
  PnlDerivedSeries,
  YearEok,
  YtdCap,
} from './types';

/**
 * pnlDerived에서 진행연도 시점 캡 추출 — 재무 페이지 모든 차트가 공유.
 *
 * 손익(영업이익·상각비) 최신월로 페이지 전체 진행연도 표시월을 통일(데이터 온전한 최근월).
 * 손익 데이터가 없으면 undefined(캡 없음 → 각 차트 재무 자체 최신월).
 */
export function ytdCapFromPnl(pnlDerived?: PnlDerivedSeries): YtdCap | undefined {
  if (!pnlDerived || pnlDerived.currentYearLatestMonth < 1) return undefined;
  return { year: pnlDerived.currentYear, month: pnlDerived.currentYearLatestMonth };
}

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

/**
 * 진행연도(monthly) 표시월 — requiredAccounts가 **모두 non-null**인 최신월.
 *
 * 4월/5월 데이터 혼용 방지: 한 차트가 쓰는 계정이 전부 채워진 최신월만 골라 한 시점에서 읽는다.
 * 예) 자산은 5월, 자본은 4월까지면 4월 선택. requiredAccounts 미지정/완전월 없음 → 최신 월.
 * (증자처럼 값이 0이어도 non-null이면 '있음'으로 본다 — 0은 정상값.)
 */
function latestMonthlyMonth(
  monthly: readonly FinanceRow[],
  requiredAccounts?: readonly string[]
): number {
  const months = [...new Set(monthly.map((r) => r.period_month))].sort((a, b) => b - a);
  if (months.length === 0) return 0;
  if (requiredAccounts && requiredAccounts.length > 0) {
    for (const m of months) {
      const complete = requiredAccounts.every((acc) =>
        monthly.some((r) => r.period_month === m && r.account === acc && r.value_mwon !== null)
      );
      if (complete) return m;
    }
  }
  return months[0]; // 완전한 월 없음/required 미지정 → 최신 월
}

interface PeriodOpts {
  /** 진행연도 표시월을 이 계정들이 모두 non-null인 최신월로 (데이터 온전한 월, 혼용 방지). */
  requiredAccounts?: readonly string[];
  /** 추가 상한 (예: 손익 최신월). 손익에서 가져오는 계정이 있으면 그 월로 더 캡. */
  cap?: YtdCap;
}

/**
 * 연도별 대표 시점 선택 (오름차순). 월별 있으면 최신월(YTD), 없으면 연말.
 *
 * 진행연도 표시월 = (requiredAccounts 모두 non-null인 최신월) → cap.month로 추가 min.
 * 차트별로 자기 계정이 온전한 최신월을 독립 선택(레버리지·차입금이자율=재무 최신월,
 * 자금조달 표=손익 최신월). 두 데이터를 섞는 표만 cap으로 손익 월까지 내린다.
 */
function selectPeriods(rows: readonly FinanceRow[], opts: PeriodOpts = {}): PeriodSel[] {
  const { requiredAccounts, cap } = opts;
  const years = [...new Set(rows.map((r) => r.period_year))].sort((a, b) => a - b);
  const out: PeriodSel[] = [];
  for (const y of years) {
    const yearRows = rows.filter((r) => r.period_year === y);
    const monthly = yearRows.filter((r) => r.period_kind === 'monthly');
    if (monthly.length > 0) {
      let maxM = latestMonthlyMonth(monthly, requiredAccounts);
      if (cap && y === cap.year && cap.month >= 1) maxM = Math.min(maxM, cap.month);
      out.push({ year: y, kind: 'monthly', month: maxM, label: `${y}.${pad2(maxM)}`, isYtd: true });
      continue;
    }
    const annual = yearRows.filter((r) => r.period_kind === 'annual');
    if (annual.length === 0) continue;
    out.push({
      year: y,
      kind: 'annual',
      month: annual[0].period_month,
      // 연말 스냅샷이지만 12월 시점임을 명시 (당해연도 최신월 'YYYY.MM'과 일관).
      label: `${y}.${pad2(annual[0].period_month)}`,
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

/**
 * 차트 1 — 자회사별 자산·부채·부채비율 시계열(억원).
 *
 * 진행연도 표시월은 자산·부채·자본이 모두 온전한 최신월(재무 데이터 기준, 혼용 방지).
 */
export function buildLeverageSeries(
  rows: readonly FinanceRow[],
  subsidiary: string
): LeveragePoint[] {
  const sub = rows.filter((r) => r.subsidiary === subsidiary);
  const periods = selectPeriods(sub, { requiredAccounts: ['자산', '부채', '자본'] });
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
 * 차트 2 — 차입금·평균이자율 콤보 (기본 전체/연결).
 *
 * - 막대: 차입금(억원) · 표식 꺾은선: 평균이자율(연율화 이자비용 / 차입금 × 100, %).
 * - 이자비용은 '전체'에만 적재돼 평균이자율은 사실상 전체만. 차입금·이자비용 모두 finance_entries.
 * - 진행연도 표시월은 차입·이자비용이 모두 온전한 최신월(재무 데이터 기준, 혼용 방지).
 * - **연율화**: 이자비용은 월 누계라 YTD(부분연도)면 1년치가 아니므로 ×(12/경과월)로 연율화해
 *   과거 연간과 동일 기준으로 비교. 연간(연말)은 경과월=12라 환산 계수 1(그대로).
 */
export function buildInterestRateSeries(
  rows: readonly FinanceRow[],
  subsidiary = '전체'
): InterestRatePoint[] {
  const sub = rows.filter((r) => r.subsidiary === subsidiary);
  const periods = selectPeriods(sub, { requiredAccounts: ['차입', '이자비용'] });
  return periods.map((p) => {
    const debt = valueEok(sub, p, '차입');
    const interest = valueEok(sub, p, '이자비용');
    // p.month = 연간 12 / YTD는 경과 월수. 이자비용을 연율화(×12/경과월)한 뒤 차입금 잔액 대비.
    const annualizedInterest = interest !== null ? interest * (12 / p.month) : null;
    const interestRate =
      annualizedInterest !== null && debt !== null && debt !== 0
        ? (annualizedInterest / debt) * 100
        : null;
    return { periodLabel: p.label, year: p.year, isYtd: p.isYtd, debt, interestRate };
  });
}

/**
 * 표 — 투하자본·자금조달 (기본 전체/연결).
 *
 *   ① 투하자본
 *    ├ 순운전자본 = 채권 + 재고 − 채무
 *    │   채권 · 재고 · 채무(차감)
 *    ├ CAPEX = 유형자산 + 무형자산
 *    │   유형자산 · 무형자산
 *    └ 투하자본 합계 = 순운전자본 + CAPEX
 *   ② 자금조달
 *      영업이익 · 감가상각비 · 신규증자 · 차입금
 *      (영업이익·감가상각비·신규증자는 당기 발생액 = 흐름, 증감열에 발생액 표시)
 *      자금조달 합계 = 영업이익 + 감가상각비 + 신규증자 + 차입금
 *   ③ 이자비용 — 당기 발생액(흐름) 단독 섹션
 *   ④ 현금 — 잔액(값 칸) + 기간 증감(증감 칸)을 한 줄에
 *
 * 영업이익은 finance_entries에 없어 손익(pnl_entries)에서 가져옴(pnlDerived.opIncome, 억원).
 * 감가상각비는 과거 연말=재무 연간, 진행연도 YTD=손익 상각비(pnlDerived.depreciation) — 재무 월데이터가
 * 0이라 YTD만 손익 보충(재무·손익 연간 정의 일치 확인됨). '전체'에만 손익 파생값 적용.
 *
 * 진행연도 표시월: 재무 계정이 온전한 최신월을 손익 최신월(cap)로 추가 캡 → 손익(4월)+재무(5월)
 * 혼용 방지. 재무는 5월까지여도 손익이 4월까지면 4월 YTD로 통일 표시.
 */
// 자금조달 표가 진행연도(YTD)에 표시하는 재무 계정(영업이익·감가상각비는 손익에서 옴 → 제외).
const CAPITAL_YTD_FINANCE_ACCOUNTS = [
  '채권',
  '재고',
  '채무',
  '유형자산',
  '무형자산',
  '현금성자산',
  '증자',
  '차입',
  '이자비용',
] as const;

export function buildCapitalTable(
  rows: readonly FinanceRow[],
  pnlDerived?: PnlDerivedSeries,
  subsidiary = '전체'
): CapitalTable {
  const sub = rows.filter((r) => r.subsidiary === subsidiary);
  const periods = selectPeriods(sub, {
    requiredAccounts: CAPITAL_YTD_FINANCE_ACCOUNTS,
    cap: ytdCapFromPnl(pnlDerived),
  });
  const n = periods.length;
  if (n === 0) return { periods: [], rows: [] };

  // 손익 파생 연도별 값(억원) → 시점 연도로 매핑. '전체'에만 적용.
  const fromPnl = (series: YearEok[] | undefined): (number | null)[] =>
    periods.map((p) => {
      if (!series || subsidiary !== '전체') return null;
      const found = series.find((v) => v.year === p.year);
      return found ? found.eok : null;
    });

  const receivable = seriesFor(sub, periods, '채권');
  const inventory = seriesFor(sub, periods, '재고');
  const payable = seriesFor(sub, periods, '채무');
  const tangible = seriesFor(sub, periods, '유형자산');
  const intangible = seriesFor(sub, periods, '무형자산');
  const cash = seriesFor(sub, periods, '현금성자산');
  // 이자비용은 비용(유출)이라 음수로 표시 (DB엔 양수 저장 → 부호 반전).
  const interest = seriesFor(sub, periods, '이자비용').map((v) => (v === null ? null : -v));
  const paidIn = seriesFor(sub, periods, '증자');
  const debt = seriesFor(sub, periods, '차입');
  // 영업이익 — 손익(pnl_entries) 연결 전사(억원). 과거=연간, 진행연도=YTD.
  const opSeries = fromPnl(pnlDerived?.opIncome);
  // 감가상각비 — 과거(연말)=재무 연간, 진행연도(YTD)=손익 상각비(재무 월데이터 0). 재무·손익 연간 정의 일치.
  const financeDep = seriesFor(sub, periods, '감가상각비(유형+무형)');
  const pnlDep = fromPnl(pnlDerived?.depreciation);
  const depreciation = periods.map((p, i) =>
    p.isYtd ? (pnlDep[i] ?? financeDep[i]) : financeDep[i]
  );

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
      { series: opSeries, sign: 1 },
      { series: depreciation, sign: 1 },
      { series: paidIn, sign: 1 },
      { series: debt, sign: 1 },
    ],
    n
  );
  // 자금조달 합계 증감 = 영업이익+감가상각비+신규증자(흐름 = 당기 발생액) + 차입금 증감 → 증감열이 세로로 합산.
  //   = (financing[i] − financing[i−1]) + (전기 흐름값 보정: opSeries+depreciation+paidIn).
  const financingDelta: (number | null)[] = periods.map((_, i) => {
    if (i === 0) return null;
    const cur = financing[i];
    const prev = financing[i - 1];
    if (cur === null || prev === null) return null;
    return cur - prev + (opSeries[i - 1] ?? 0) + (depreciation[i - 1] ?? 0) + (paidIn[i - 1] ?? 0);
  });

  const tableRows: CapitalRow[] = [
    {
      key: 'invested',
      label: '① 투하자본',
      level: 0,
      kind: 'section',
      values: Array(n).fill(null),
    },
    { key: 'nwc', label: '순운전자본', level: 1, kind: 'subtotal', values: nwc },
    { key: 'receivable', label: '채권', level: 2, kind: 'detail', values: receivable },
    { key: 'inventory', label: '재고', level: 2, kind: 'detail', values: inventory },
    { key: 'payable', label: '채무', level: 2, kind: 'detail', subtract: true, values: payable },
    { key: 'capex', label: 'CAPEX', level: 1, kind: 'subtotal', values: capex },
    { key: 'tangible', label: '유형자산', level: 2, kind: 'detail', values: tangible },
    { key: 'intangible', label: '무형자산', level: 2, kind: 'detail', values: intangible },
    {
      key: 'invested_total',
      label: '투하자본 합계(현금 유출)',
      level: 0,
      kind: 'total',
      values: invested,
    },
    {
      key: 'financing',
      label: '② 자금조달',
      level: 0,
      kind: 'section',
      values: Array(n).fill(null),
    },
    { key: 'opIncome', label: '영업이익', level: 1, kind: 'detail', flow: true, values: opSeries },
    {
      key: 'depreciation',
      label: '감가상각비',
      level: 1,
      kind: 'detail',
      flow: true,
      values: depreciation,
    },
    { key: 'paidIn', label: '신규증자', level: 1, kind: 'detail', flow: true, values: paidIn },
    { key: 'debt', label: '차입금', level: 1, kind: 'detail', values: debt },
    {
      key: 'financing_total',
      label: '자금조달 합계(현금 유입)',
      level: 0,
      kind: 'total',
      deltaValues: financingDelta,
      values: financing,
    },
    // ③ 이자비용: 당기 발생액(흐름) 단독 섹션. 값 칸 = 발생액, 증감 칸 = 당기 발생액.
    {
      key: 'interest',
      label: '③ 이자비용(현금 유출)',
      level: 0,
      kind: 'subtotal',
      flow: true,
      values: interest,
    },
    // ④ 현금: 잔액(값 칸) + 기간 증감(증감 칸)을 한 줄에.
    { key: 'cash', label: '④ 현금', level: 0, kind: 'subtotal', values: cash },
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
