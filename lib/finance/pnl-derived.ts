/**
 * 자금조달 표용 손익(PnL) 파생값 추출 — 순수 함수.
 *
 * 재무(finance_entries)에 없는 영업이익·상각비를 손익 데이터에서 뽑아 자금조달 표에 공급한다.
 * - 영업이익: pnl_entries 연결 전사 op_income (lib/plan/aggregate.ts buildCorpAchievement와 동일 규칙).
 * - 상각비: pnl_fixed_variable 상각비 합계(2-2 고정비·변동비 구조표의 '상각비합계' 토글과 동일 정의).
 *
 * 서버 전용 헬퍼 — 큰 PreparedPnlData(monthly 포함)·fixedVariable는 여기서 소비하고,
 * 클라이언트엔 가벼운 PnlDerivedSeries만 전달(RSC payload 최소화 + 차트 빌더 aggregate.ts 분리).
 */
import { aggregateBy, entriesForYear, getDisplayYearLabels } from '@/lib/pnl/aggregate';
import type { PreparedPnlData } from '@/lib/pnl/aggregate';
import type { Basis, FixedVariableRow } from '@/lib/pnl/types';
import type { PnlDerivedSeries, YearEok } from './types';

const MWON_TO_EOK = 100; // 백만원 → ÷100 = 억원

const isCost = (r: FixedVariableRow): boolean =>
  r.cost_type === '고정비' || r.cost_type === '변동비';

/**
 * 상각비 합계 대상 계정 (FixedVariableStructure.isAmortAccount와 동일):
 * 경비-감가상각비 + 경비-개발비상각 + 연구개발비-감가상각비.
 */
const isAmort = (r: FixedVariableRow): boolean =>
  (r.category2 === '매출원가' &&
    r.category3 === '경비' &&
    (r.account === '감가상각비' || r.account === '개발비상각')) ||
  (r.category2 === '판매관리비' && r.category3 === '연구개발비' && r.account === '감가상각비');

/** 연결 monthly에서 진행 연도(최대 연도)와 그 연도의 최신월. */
function currentYtd(
  prepared: PreparedPnlData,
  basis: Basis
): {
  currentYear: number;
  currentYearLatestMonth: number;
} {
  const monthly = prepared.monthlyByBasis[basis];
  let currentYear = 0;
  for (const e of monthly) {
    if (e.period_month >= 1 && e.period_month <= 12 && e.period_year > currentYear) {
      currentYear = e.period_year;
    }
  }
  let currentYearLatestMonth = 0;
  for (const e of monthly) {
    if (
      e.period_year === currentYear &&
      e.period_month >= 1 &&
      e.period_month <= 12 &&
      e.period_month > currentYearLatestMonth
    ) {
      currentYearLatestMonth = e.period_month;
    }
  }
  return { currentYear, currentYearLatestMonth };
}

/** 영업이익(억원) — 연결 연간 라벨별(+2026 YTD). */
function opIncomeByYear(prepared: PreparedPnlData, basis: Basis): YearEok[] {
  const annual = prepared.annualByBasis[basis];
  const out: YearEok[] = [];
  for (const lbl of getDisplayYearLabels(annual, basis)) {
    const year = parseInt(lbl.slice(0, 4), 10);
    if (Number.isNaN(year)) continue;
    const agg = aggregateBy(entriesForYear(annual, basis, lbl), []);
    out.push({ year, eok: agg.length > 0 ? agg[0].op_income / MWON_TO_EOK : null });
  }
  return out;
}

/**
 * 상각비 합계(억원) — 연도별. 과거=annual, 진행연도=monthly 1~latestMonth 누적.
 * latestMonth는 영업이익(pnl_entries) 기준과 동일하게 맞춰 표시 시점을 정합시킨다.
 */
function depreciationByYear(
  fixedVariable: readonly FixedVariableRow[],
  currentYear: number,
  currentYearLatestMonth: number
): YearEok[] {
  const years = new Set<number>();
  for (const r of fixedVariable) {
    if (isCost(r) && isAmort(r)) years.add(r.period_year);
  }
  return [...years]
    .sort((a, b) => a - b)
    .map((year) => {
      const current = year === currentYear;
      let sum: number | null = null;
      for (const r of fixedVariable) {
        if (!isCost(r) || !isAmort(r) || r.period_year !== year || r.value_mwon === null) continue;
        if (current) {
          if (r.period_kind !== 'monthly') continue;
          if (r.period_month < 1 || r.period_month > currentYearLatestMonth) continue;
        } else if (r.period_kind !== 'annual') {
          continue;
        }
        sum = (sum ?? 0) + r.value_mwon;
      }
      return { year, eok: sum === null ? null : sum / MWON_TO_EOK };
    });
}

/** 영업이익(pnl_entries) + 상각비(pnl_fixed_variable)를 연결 기준으로 연도별 추출. */
export function buildPnlDerived(
  prepared: PreparedPnlData,
  fixedVariable: readonly FixedVariableRow[]
): PnlDerivedSeries {
  const basis: Basis = 'consolidated';
  const { currentYear, currentYearLatestMonth } = currentYtd(prepared, basis);
  return {
    opIncome: opIncomeByYear(prepared, basis),
    depreciation: depreciationByYear(fixedVariable, currentYear, currentYearLatestMonth),
    currentYear,
    currentYearLatestMonth,
  };
}
