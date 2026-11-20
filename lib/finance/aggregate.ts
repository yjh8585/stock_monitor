/**
 * 재무(/management/finance) 순수 집계 빌더.
 *
 * - 단위 환산: DB는 백만원(value_mwon), UI는 억원 → `value_mwon / 100`.
 * - 시점 규칙: 한 연도에 월별(monthly) 행이 있으면 최신월(YTD), 없으면 연말(annual).
 *   대차대조표라 과거(연말)와 당해연도(최신월)를 한 축에 섞어 추이를 본다.
 * - 부채비율 = 부채 / 자본(자기자본) × 100 (한국 표준, 자산=부채+자본과 정합).
 */
import type {
  CashBridge,
  CashBridgeCell,
  CashBridgeRow,
  CashWaterfallStep,
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
 * 연도별 대표 시점 선택 (오름차순). 연간(연말) 행이 있으면 연말, 없으면 월별 최신월(YTD).
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
    const annual = yearRows.filter((r) => r.period_kind === 'annual');
    // 연간(=12월 연말) 행이 있으면 그것이 그 해의 마지막 시점이다. 적재는 upsert 만 해 지난 연도의
    // 월별 1~11월 행이 DB 에 남으므로, 월별을 먼저 보면 해가 바뀐 뒤 「직전 연말」 대신 11월을 고른다.
    if (monthly.length > 0 && annual.length === 0) {
      let maxM = latestMonthlyMonth(monthly, requiredAccounts);
      if (cap && y === cap.year && cap.month >= 1) maxM = Math.min(maxM, cap.month);
      out.push({ year: y, kind: 'monthly', month: maxM, label: `${y}.${pad2(maxM)}`, isYtd: true });
      continue;
    }
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
    return { periodLabel: p.label, year: p.year, isYtd: p.isYtd, debt, interest, interestRate };
  });
}

/* ── 3. 자금수지(Cash Bridge) ─────────────────────────────────────────────── */

/**
 * 자금수지 흐름 계정 — 엑셀 '재무' 시트에 「전체·연결」로 입력한다(정본 목록).
 * 값은 **현금 기준 부호**(유입 +, 유출 −)이고, 기존 이자비용·증자처럼 **그 달까지 누계(YTD)**.
 * 순서 = 예시 엑셀 행 순서(화면 행 순서는 buildCashBridge 의 layout). 계산은 아래 상수
 * `CF` 로 이 목록의 이름만 읽는다 — 이름을 바꾸면 시험(「흐름 계정 10종을 모두 읽는다」)이 잡는다.
 */
export const CASH_FLOW_ACCOUNTS = [
  '법인세 납부',
  '일회성 영업현금',
  'CAPEX 유지보수',
  'CAPEX 증설',
  '설비 매각',
  '관계사 출자·대여',
  '배당 수취',
  '배당 지급',
  '기타 자금조달',
  '기타 현금흐름',
] as const;

type CashFlowAccount = (typeof CASH_FLOW_ACCOUNTS)[number];
/** 목록 밖 이름을 쓰면 타입 오류가 나게 하는 얇은 거름 — 계산은 이것으로만 흐름 계정을 읽는다. */
const CF = (name: CashFlowAccount): CashFlowAccount => name;

/** 비고가 이 접두로 시작하면 입력 예시용 가짜 값 — 화면이 주황 기울임으로 구분한다. */
export const DUMMY_NOTE_PREFIX = '[더미]';

/** 잔액 차이로 흐름을 만드는 계정 — 진행연도 표시월은 이 계정들이 모두 채워진 최신월. */
const CASH_BRIDGE_BALANCE_ACCOUNTS = ['채권', '재고', '채무', '현금성자산', '차입'] as const;

type Cell = CashBridgeCell;

const EMPTY: Cell = { value: null, note: null, dummy: false };

function isDummyNote(note: string | null | undefined): boolean {
  return !!note && note.trim().startsWith(DUMMY_NOTE_PREFIX);
}

/** 특정 시점·계정의 비고(여러 행이면 줄바꿈으로 잇는다). */
function noteAt(rows: readonly FinanceRow[], sel: PeriodSel, account: string): string | null {
  const notes = rows
    .filter(
      (r) =>
        r.period_year === sel.year &&
        r.period_kind === sel.kind &&
        r.period_month === sel.month &&
        r.account === account &&
        r.note
    )
    .map((r) => (r.note as string).trim());
  return notes.length > 0 ? notes.join('\n') : null;
}

/** 흐름 계정 칸 — 그 시점 누계값(부호 sign 적용) + 비고. */
function flowCell(
  rows: readonly FinanceRow[],
  sel: PeriodSel,
  account: string,
  sign: 1 | -1
): Cell {
  const v = valueEok(rows, sel, account);
  const note = noteAt(rows, sel, account);
  return { value: v === null ? null : sign * v, note, dummy: isDummyNote(note) };
}

/**
 * 잔액 차이 칸 — sign × (당기말 잔액 − 전기말 잔액). 비고는 당기 시점 것.
 * 전기 = 직전 연도 연말이어야 한다(연도가 비면 null — 기간이 어긋난 차이를 만들지 않는다).
 */
function balanceDeltaCell(
  rows: readonly FinanceRow[],
  cur: PeriodSel,
  prev: PeriodSel | undefined,
  account: string,
  sign: 1 | -1
): Cell {
  const note = noteAt(rows, cur, account);
  if (!isPrevYearEnd(cur, prev)) return { value: null, note, dummy: isDummyNote(note) };
  const a = valueEok(rows, cur, account);
  const b = valueEok(rows, prev, account);
  // 전기말 잔액이 더미여도 그 차이는 더미다.
  const dummy = isDummyNote(note) || isDummyNote(noteAt(rows, prev, account));
  return { value: a === null || b === null ? null : sign * (a - b), note, dummy };
}

/** 전기가 「직전 연도 12월 말」인가 — 아니면 기간이 어긋난 차이가 되므로 계산하지 않는다. */
function isPrevYearEnd(cur: PeriodSel, prev: PeriodSel | undefined): prev is PeriodSel {
  return !!prev && prev.year === cur.year - 1 && prev.month === 12;
}

/** 부호 있는 합. 전부 null 이면 null, 하나라도 있으면 null=0. 더미가 하나라도 섞이면 dummy. */
function sumCells(cells: readonly Cell[], signs?: readonly (1 | -1)[]): Cell {
  let value: number | null = null;
  let dummy = false;
  cells.forEach((c, i) => {
    if (c.value !== null) value = (value ?? 0) + (signs?.[i] ?? 1) * c.value;
    if (c.dummy && c.value !== null) dummy = true;
  });
  return { value, note: null, dummy };
}

/**
 * 3. 자금수지 표 (전체·연결 고정).
 *
 *   영업이익 + 감가상각비                                  = ① EBITDA
 *   ① ± 매출채권·재고·매입채무 증감 − 이자비용 + 법인세 납부  = ② 경상 영업현금흐름
 *   ② + CAPEX 유지보수 + CAPEX 증설                         = ③ 경상 잉여현금흐름(FCF)
 *   ③ + 일회성 영업현금 + 설비 매각 + 관계사 출자·대여 + 배당 수취 + 증자 + 배당 지급
 *     + 기타 현금흐름 + 미설명 차이                          = ④ 차입 전 현금증감
 *   ④ + 순차입 + 기타 자금조달                              = ⑤ 순현금증감(= 현금 잔액 차이, 실제값)
 *   기초 현금 + ⑤                                          = ⑥ 기말 현금
 *
 * - 「미설명 차이」 = ⑤(실제) − 나머지 전부. 입력이 빠졌거나 분류가 없는 현금흐름이 여기 모인다.
 * - 흐름 = 과거 연간 / 진행연도 YTD 누계. 잔액 항목은 직전 연말 대비 차이 → 첫 연도(기초 잔액 없음)는 열에서 뺀다.
 * - 영업이익은 손익(pnlDerived.opIncome). 감가상각비는 과거=재무 연간, 진행연도=손익 상각비(재무 월 누계 fallback).
 * - 진행연도 표시월은 잔액 계정이 온전한 최신월을 손익 최신월로 캡(손익·재무 혼용 방지).
 */
export function buildCashBridge(
  rows: readonly FinanceRow[],
  pnlDerived?: PnlDerivedSeries,
  subsidiary = '전체'
): CashBridge {
  // 연결 행만 — 같은 자회사에 별도 행이 들어오면 valueEok 가 합산해 두 번 센다.
  const sub = rows.filter((r) => r.subsidiary === subsidiary && r.consolidation === '연결');
  const all = selectPeriods(sub, {
    requiredAccounts: CASH_BRIDGE_BALANCE_ACCOUNTS,
    cap: ytdCapFromPnl(pnlDerived),
  });
  // 첫 시점은 기초 잔액 역할만 한다(그 자신의 증감을 계산할 전기말이 없다).
  const shown = all.slice(1).map((p, i) => ({ cur: p, prev: all[i] }));
  if (shown.length === 0) return { periods: [], isYtd: [], rows: [] };

  /**
   * 손익 값(억원). 진행연도는 손익 최신월과 이 열의 재무 월이 같을 때만 — 재무 입력이 손익보다
   * 늦으면(예: 재무 8월 · 손익 9월) 9월 누계 영업이익을 8월 열에 섞게 되므로 비운다.
   */
  const pnlMonthMismatch = (cur: PeriodSel): boolean =>
    !!pnlDerived &&
    cur.year === pnlDerived.currentYear &&
    pnlDerived.currentYearLatestMonth !== cur.month;
  const pnlOf = (series: YearEok[] | undefined, cur: PeriodSel): number | null => {
    if (!series || subsidiary !== '전체' || pnlMonthMismatch(cur)) return null;
    return series.find((v) => v.year === cur.year)?.eok ?? null;
  };

  type Key =
    | 'op'
    | 'dep'
    | 'ebitda'
    | 'ar'
    | 'inv'
    | 'ap'
    | 'interest'
    | 'tax'
    | 'ocf'
    | 'capexM'
    | 'capexG'
    | 'fcf'
    | 'oneoff'
    | 'assetSale'
    | 'affiliate'
    | 'divIn'
    | 'equity'
    | 'divOut'
    | 'otherCf'
    | 'unexplained'
    | 'preFin'
    | 'netDebt'
    | 'otherFin'
    | 'netCash'
    | 'beginCash'
    | 'endCash';
  const cols: Record<Key, Cell>[] = shown.map(({ cur, prev }) => {
    const op: Cell = {
      value: pnlOf(pnlDerived?.opIncome, cur),
      note: pnlMonthMismatch(cur)
        ? `손익 최신월(${pnlDerived?.currentYearLatestMonth}월)과 재무 기준월(${cur.month}월)이 달라 비웠습니다.`
        : null,
      dummy: false,
    };
    const finDep = flowCell(sub, cur, '감가상각비(유형+무형)', 1);
    const pnlDep = cur.isYtd ? pnlOf(pnlDerived?.depreciation, cur) : null;
    // 손익 상각비로 바꿀 땐 재무 행의 비고·더미 표시를 버린다(값과 출처가 다르다).
    const dep: Cell = pnlDep !== null ? { value: pnlDep, note: null, dummy: false } : finDep;
    // 영업이익이 없으면 EBITDA 도 비운다 — 상각비만으로 숫자를 내면 정상처럼 보인다.
    const ebitda = op.value === null ? EMPTY : sumCells([op, dep]);

    const ar = balanceDeltaCell(sub, cur, prev, '채권', -1);
    const inv = balanceDeltaCell(sub, cur, prev, '재고', -1);
    const ap = balanceDeltaCell(sub, cur, prev, '채무', 1);
    const interest = flowCell(sub, cur, '이자비용', -1); // DB 양수(비용) → 유출 −
    const tax = flowCell(sub, cur, CF('법인세 납부'), 1);
    const ocf = sumCells([ebitda, ar, inv, ap, interest, tax]);

    const capexM = flowCell(sub, cur, CF('CAPEX 유지보수'), 1);
    const capexG = flowCell(sub, cur, CF('CAPEX 증설'), 1);
    const fcf = sumCells([ocf, capexM, capexG]);

    const oneoff = flowCell(sub, cur, CF('일회성 영업현금'), 1);
    const assetSale = flowCell(sub, cur, CF('설비 매각'), 1);
    const affiliate = flowCell(sub, cur, CF('관계사 출자·대여'), 1);
    const divIn = flowCell(sub, cur, CF('배당 수취'), 1);
    const equity = flowCell(sub, cur, '증자', 1);
    const divOut = flowCell(sub, cur, CF('배당 지급'), 1);
    const otherCf = flowCell(sub, cur, CF('기타 현금흐름'), 1);

    const netDebt = balanceDeltaCell(sub, cur, prev, '차입', 1);
    const otherFin = flowCell(sub, cur, CF('기타 자금조달'), 1);
    const netCash = balanceDeltaCell(sub, cur, prev, '현금성자산', 1);

    const explained = [
      fcf,
      oneoff,
      assetSale,
      affiliate,
      divIn,
      equity,
      divOut,
      otherCf,
      netDebt,
      otherFin,
    ];
    const explainedSum = sumCells(explained);
    // 미설명 차이 = 실제 현금 변화 − 설명된 합. 실제 현금 변화만 있으면 계산한다 — 설명 항목이
    // 비어 있으면 그만큼 여기 모인다(그래야 ④+순차입+기타조달 = ⑤ 와 폭포 차트가 기말에 닿는다).
    const unexplained: Cell =
      netCash.value === null
        ? EMPTY
        : {
            value: netCash.value - (explainedSum.value ?? 0),
            note: null,
            dummy: explainedSum.dummy || netCash.dummy,
          };
    const preFin = sumCells([
      fcf,
      oneoff,
      assetSale,
      affiliate,
      divIn,
      equity,
      divOut,
      otherCf,
      unexplained,
    ]);

    const beginNote = noteAt(sub, prev, '현금성자산');
    const beginCash: Cell = {
      value: isPrevYearEnd(cur, prev) ? valueEok(sub, prev, '현금성자산') : null,
      note: beginNote,
      dummy: isDummyNote(beginNote),
    };
    const endCash = flowCell(sub, cur, '현금성자산', 1); // 잔액 그대로

    return {
      op,
      dep,
      ebitda,
      ar,
      inv,
      ap,
      interest,
      tax,
      ocf,
      capexM,
      capexG,
      fcf,
      oneoff,
      assetSale,
      affiliate,
      divIn,
      equity,
      divOut,
      otherCf,
      unexplained,
      preFin,
      netDebt,
      otherFin,
      netCash: { ...netCash, note: null },
      beginCash,
      endCash,
    };
  });

  const layout: { key: Key; label: string; kind: CashBridgeRow['kind']; source: string }[] = [
    { key: 'op', label: '영업이익', kind: 'item', source: '손익 데이터(자동) — 엑셀 입력 없음' },
    {
      key: 'dep',
      label: '(+) 감가상각비',
      kind: 'item',
      source: "'재무' 시트 「감가상각비(유형+무형)」 · 진행연도는 손익 상각비",
    },
    { key: 'ebitda', label: '① EBITDA', kind: 'subtotal', source: '영업이익 + 감가상각비' },
    {
      key: 'ar',
      label: '(±) 매출채권 증감',
      kind: 'item',
      source: "'재무' 시트 「채권」 잔액 차이 · 증가하면 현금 유출(−)",
    },
    {
      key: 'inv',
      label: '(±) 재고 증감',
      kind: 'item',
      source: "'재무' 시트 「재고」 잔액 차이 · 증가하면 현금 유출(−)",
    },
    {
      key: 'ap',
      label: '(±) 매입채무 증감',
      kind: 'item',
      source: "'재무' 시트 「채무」 잔액 차이 · 증가하면 현금 유입(+)",
    },
    {
      key: 'interest',
      label: '(−) 이자비용',
      kind: 'item',
      source: "'재무' 시트 「이자비용」(누계, 양수로 입력)",
    },
    {
      key: 'tax',
      label: '(−) 법인세 납부',
      kind: 'item',
      source: "'재무' 시트 「법인세 납부」(누계, 납부 −)",
    },
    {
      key: 'ocf',
      label: '② 경상 영업현금흐름',
      kind: 'subtotal',
      source: '① ± 운전자본 증감 − 이자비용 + 법인세 납부(음수로 입력된 유출)',
    },
    {
      key: 'capexM',
      label: '(−) CAPEX 유지보수',
      kind: 'item',
      source: "'재무' 시트 「CAPEX 유지보수」(누계, 지출 −)",
    },
    {
      key: 'capexG',
      label: '(−) CAPEX 증설',
      kind: 'item',
      source: "'재무' 시트 「CAPEX 증설」(누계, 지출 −)",
    },
    { key: 'fcf', label: '③ 경상 잉여현금흐름(FCF)', kind: 'subtotal', source: '② − CAPEX' },
    {
      key: 'oneoff',
      label: '(±) 일회성 영업현금',
      kind: 'item',
      source: "'재무' 시트 「일회성 영업현금」(누계) · 건별 내역은 비고에",
    },
    {
      key: 'assetSale',
      label: '(+) 설비 매각',
      kind: 'item',
      source: "'재무' 시트 「설비 매각」(누계, 매각대금 +)",
    },
    {
      key: 'affiliate',
      label: '(±) 관계사 출자·대여',
      kind: 'item',
      source: "'재무' 시트 「관계사 출자·대여」(누계, 출자·대여 −, 회수 +)",
    },
    {
      key: 'divIn',
      label: '(+) 배당 수취',
      kind: 'item',
      source: "'재무' 시트 「배당 수취」(누계)",
    },
    { key: 'equity', label: '(+) 증자', kind: 'item', source: "'재무' 시트 「증자」(누계)" },
    {
      key: 'divOut',
      label: '(−) 배당 지급',
      kind: 'item',
      source: "'재무' 시트 「배당 지급」(누계, 지급 −)",
    },
    {
      key: 'otherCf',
      label: '(±) 기타 현금흐름',
      kind: 'item',
      source: "'재무' 시트 「기타 현금흐름」(누계)",
    },
    {
      key: 'unexplained',
      label: '(±) 미설명 차이',
      kind: 'item',
      source: '자동 = 실제 현금 변화 − 나머지 전부. 크면 입력이 빠진 항목이 있다',
    },
    {
      key: 'preFin',
      label: '④ 차입 전 현금증감',
      kind: 'subtotal',
      source: '③ + 일회성·투자·자본·기타 + 미설명 차이',
    },
    {
      key: 'netDebt',
      label: '(±) 순차입',
      kind: 'item',
      source: "'재무' 시트 「차입」 잔액 차이 · 신규·상환 내역은 비고에",
    },
    {
      key: 'otherFin',
      label: '(±) 기타 자금조달',
      kind: 'item',
      source: "'재무' 시트 「기타 자금조달」(누계)",
    },
    {
      key: 'netCash',
      label: '⑤ 순현금증감',
      kind: 'total',
      source: "'재무' 시트 「현금성자산」 잔액 차이(실제값)",
    },
    {
      key: 'beginCash',
      label: '기초 현금',
      kind: 'balance',
      source: "'재무' 시트 「현금성자산」 전기말 잔액",
    },
    {
      key: 'endCash',
      label: '⑥ 기말 현금',
      kind: 'total',
      source: "'재무' 시트 「현금성자산」 당기말 잔액",
    },
  ];

  return {
    periods: shown.map(({ cur }) => cur.label),
    isYtd: shown.map(({ cur }) => cur.isYtd),
    rows: layout.map(({ key, label, kind, source }) => ({
      key,
      label,
      kind,
      source,
      cells: cols.map((c) => c[key]),
    })),
  };
}

/**
 * 3. 자금수지 폭포 차트 — 마지막 기간(최신)의 기초 현금 → 기말 현금.
 *
 * 막대 수를 줄이려 투자·자본·기타(설비 매각·관계사·배당·증자·기타 현금흐름)와
 * 순차입·기타 자금조달은 각각 한 막대로 묶는다. 값이 없는(null) 막대는 0 으로 둔다.
 */
export function buildCashWaterfall(bridge: CashBridge): CashWaterfallStep[] {
  const last = bridge.periods.length - 1;
  if (last < 0) return [];
  const cell = (k: string): CashBridgeCell =>
    bridge.rows.find((r) => r.key === k)?.cells[last] ?? { value: null, note: null, dummy: false };
  const group = (keys: string[]): { value: number; dummy: boolean } => {
    let value = 0;
    let dummy = false;
    for (const k of keys) {
      const c = cell(k);
      if (c.value !== null) {
        value += c.value;
        if (c.dummy) dummy = true;
      }
    }
    return { value, dummy };
  };

  const begin = cell('beginCash');
  const end = cell('endCash');
  if (begin.value === null || end.value === null) return [];

  const steps: { key: string; label: string; kind: 'step' | 'residual'; keys: string[] }[] = [
    { key: 'ebitda', label: 'EBITDA', kind: 'step', keys: ['ebitda'] },
    { key: 'ar', label: '매출채권', kind: 'step', keys: ['ar'] },
    { key: 'inv', label: '재고', kind: 'step', keys: ['inv'] },
    { key: 'ap', label: '매입채무', kind: 'step', keys: ['ap'] },
    { key: 'interestTax', label: '이자·법인세', kind: 'step', keys: ['interest', 'tax'] },
    { key: 'capex', label: 'CAPEX', kind: 'step', keys: ['capexM', 'capexG'] },
    { key: 'oneoff', label: '일회성', kind: 'step', keys: ['oneoff'] },
    {
      key: 'invCap',
      label: '투자·자본·기타',
      kind: 'step',
      keys: ['assetSale', 'affiliate', 'divIn', 'equity', 'divOut', 'otherCf'],
    },
    { key: 'unexplained', label: '미설명 차이', kind: 'residual', keys: ['unexplained'] },
    { key: 'financing', label: '순차입·기타조달', kind: 'step', keys: ['netDebt', 'otherFin'] },
  ];

  const out: CashWaterfallStep[] = [
    {
      key: 'begin',
      label: '기초 현금',
      kind: 'total',
      value: begin.value,
      range: [0, begin.value],
      dummy: begin.dummy,
    },
  ];
  let running = begin.value;
  for (const s of steps) {
    const { value, dummy } = group(s.keys);
    const next = running + value;
    out.push({
      key: s.key,
      label: s.label,
      kind: s.kind,
      value,
      range: [Math.min(running, next), Math.max(running, next)],
      dummy,
    });
    running = next;
  }
  out.push({
    key: 'end',
    label: '기말 현금',
    kind: 'total',
    value: end.value,
    range: [0, end.value],
    dummy: end.dummy,
  });
  return out;
}
