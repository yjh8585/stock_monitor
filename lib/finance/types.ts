/** 재무(/management/finance) 도메인 타입. 단위: UI는 억원(= value_mwon / 100). */

export type FinancePeriodKind = 'annual' | 'monthly';

/** finance_entries 테이블 row (백만원). */
export interface FinanceRow {
  subsidiary: string;
  consolidation: string;
  period_year: number;
  period_kind: FinancePeriodKind;
  period_month: number;
  account: string;
  value_mwon: number | null;
  /** 엑셀 '재무' 시트 8열 비고(내역). `[더미]`로 시작하면 입력 예시용 가짜 값. */
  note: string | null;
}

/** 차트 1 (재무 레버리지) 시점별 포인트. 단위 = 억원. */
export interface LeveragePoint {
  /** 표시 라벨 ('2023','2024','2025','2026.05') */
  periodLabel: string;
  year: number;
  /** 당해연도 최신월(YTD) 여부 — 과거 연말이면 false */
  isYtd: boolean;
  /** 자산 (억원) */
  assets: number | null;
  /** 부채 (억원) */
  liabilities: number | null;
  /** 부채비율(%) = 부채 / 자본(자기자본) × 100 */
  debtRatio: number | null;
}

/**
 * 진행연도 표시 시점 캡 — 재무 페이지 모든 차트 공통.
 *
 * 재무는 최신월(예 5월)까지 있으나 손익(영업이익·상각비)은 4월까지라, 페이지 전체를
 * "데이터가 온전히 있는 최근월"(= 손익 최신월)로 통일해 차트 간 시점 불일치를 막는다.
 * selectPeriods가 진행연도 표시월을 min(재무 최신월, month)로 캡한다.
 */
export interface YtdCap {
  year: number;
  month: number;
}

/** 차트 2 (차입금·평균이자율) 시점별 포인트. 단위 = 억원 / %. */
export interface InterestRatePoint {
  /** 표시 라벨 ('2023.12' … '2026.05') */
  periodLabel: string;
  year: number;
  /** 당해연도 최신월(YTD) 여부 — 과거 연말이면 false */
  isYtd: boolean;
  /** 차입금 (억원) */
  debt: number | null;
  /** 이자비용 (억원, 실제 누계 — 과거=연간, 진행연도 YTD=경과월 누계). 데이터 없으면 null */
  interest: number | null;
  /** 평균이자율(%) = 연율화 이자비용(×12/경과월) / 차입금 × 100. 둘 중 하나라도 없거나 차입금 0이면 null */
  interestRate: number | null;
}

/** 자금수지 표 한 칸 — 값 + 비고 + 더미 여부. */
export interface CashBridgeCell {
  /** 억원(현금 기준 부호: 유입 +, 유출 −). 데이터 없으면 null. */
  value: number | null;
  /** 엑셀 비고(내역). 소계·합계 칸은 null. */
  note: string | null;
  /** 이 값이 더미(입력 예시)이거나 더미를 포함한 합계인가. */
  dummy: boolean;
}

/** 자금수지 표의 한 행. */
export interface CashBridgeRow {
  key: string;
  label: string;
  /** 'item' 일반 항목 · 'subtotal' ①~④ 소계 · 'total' ⑤⑥ · 'balance' 기초 현금(잔액) */
  kind: 'item' | 'subtotal' | 'total' | 'balance';
  /** 이 행이 어디서 오는가 — 엑셀 '재무' 시트 계정명과 계산식 (입력 담당자용 안내, 호버 표시). */
  source: string;
  /** 기간별 칸 (CashBridge.periods 와 같은 순서). */
  cells: CashBridgeCell[];
}

/** 3. 자금수지 표 전체. */
export interface CashBridge {
  /** 기간 라벨 (['2024.12','2025.12','2026.09']) — 흐름은 과거=연간, 진행연도=YTD 누계. */
  periods: string[];
  /** 진행연도(YTD) 기간 여부 (periods 와 같은 순서). */
  isYtd: boolean[];
  rows: CashBridgeRow[];
}

/** 3. 자금수지 폭포 차트 한 막대. */
export interface CashWaterfallStep {
  key: string;
  label: string;
  /** 'total' 기초·기말 현금 막대 · 'step' 증감 막대 · 'residual' 미설명 차이 */
  kind: 'total' | 'step' | 'residual';
  /** total=잔액, step/residual=증감(억원, 부호 있음). */
  value: number;
  /** 막대 아래·위 끝 [lo, hi] (억원) — recharts 범위 막대용. */
  range: [number, number];
  dummy: boolean;
}

/** 연도별 값(억원). 과거=연간, 진행연도=YTD 누적. */
export interface YearEok {
  year: number;
  /** 억원. 해당 연도 데이터 없으면 null. */
  eok: number | null;
}

/**
 * 자금조달 표용 손익(PnL) 파생값 — 재무(finance_entries)에 없는 영업이익·상각비를 손익에서 추출.
 *
 * - 영업이익: pnl_entries 연결 전사 op_income ÷ 100.
 * - 상각비: pnl_fixed_variable 상각비 합계(경비 감가상각비+개발비상각 + 연구개발비 감가상각비, 고정+변동) ÷ 100.
 *   재무의 '감가상각비(유형+무형)'는 불완전 → 캐시플로우 브리지엔 PnL 종합 상각비를 사용.
 * - 과거 연도: 연간 합계. 진행 연도(currentYear): monthly 1~currentYearLatestMonth 누적(YTD).
 * 단위는 모두 억원(백만원 ÷ 100). FX 불필요(연결은 KRW 합산).
 */
export interface PnlDerivedSeries {
  /** 연도별 영업이익(억원). */
  opIncome: YearEok[];
  /** 연도별 상각비 합계(억원). */
  depreciation: YearEok[];
  /** 진행(YTD) 연도 — 예 2026 */
  currentYear: number;
  /** 진행 연도 영업이익 최신월(예 4). 0이면 진행연도 데이터 없음 → 시점 캡 안 함. */
  currentYearLatestMonth: number;
}

/* ── 대여금(이인텔리전스) — loan_entries. 단위 = 억원(loan_eok, 환산 없음). ── */

export type LoanKind = '계획' | '실적';

/** loan_entries 테이블 row. */
export interface LoanRow {
  period_year: number;
  period_month: number;
  kind: LoanKind;
  loan_eok: number | null;
}

/** 대여금 KPI 카드 데이터(억원·%). */
export interface LoanKpis {
  /** 최신 실적 월 라벨 (예: '2026.07') */
  latestLabel: string;
  /** 당월 대여금 = 최신 실적월 값 */
  currentMonthEok: number | null;
  /** 누적 대여금 = 전체(2025~) 실적 합 */
  cumulativeEok: number | null;
  /** 2026 YTD 실적 누적 (지급율 분자) */
  ytdActualEok: number | null;
  /** 2026 동기간 계획 누적 (지급율 분모) */
  ytdPlanEok: number | null;
  /** 지급율 = ytdActual / ytdPlan × 100 (%) */
  paymentRatePct: number | null;
}
