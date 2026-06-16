import { describe, it, expect } from 'vitest';
import {
  buildCapitalTable,
  buildInterestRateSeries,
  buildLeverageSeries,
  computeDelta,
  listSubsidiaries,
} from '../aggregate';
import type { CapitalRow, FinanceRow, PnlDerivedSeries } from '../types';

function row(partial: Partial<FinanceRow>): FinanceRow {
  return {
    subsidiary: '전체',
    consolidation: '연결',
    period_year: 2024,
    period_kind: 'annual',
    period_month: 12,
    account: '자산',
    value_mwon: 0,
    ...partial,
  };
}

/** 2024 연말(annual) + 2026 월별(m1, m2) 전체 데이터셋. 단위 백만원. */
function dataset(): FinanceRow[] {
  const annual2024: Record<string, number> = {
    자산: 100000,
    부채: 60000,
    자본: 40000,
    채권: 20000,
    재고: 15000,
    채무: 10000,
    유형자산: 30000,
    무형자산: 5000,
    현금성자산: 8000,
    증자: 2000,
    차입: 25000,
    '감가상각비(유형+무형)': 3000,
    이자비용: 1000,
  };
  const monthly2026: Record<string, number> = {
    자산: 120000,
    부채: 72000,
    자본: 48000,
    채권: 25000,
    재고: 18000,
    채무: 12000,
    유형자산: 32000,
    무형자산: 6000,
    현금성자산: 9000,
    증자: 2000,
    차입: 26000,
    '감가상각비(유형+무형)': 4000,
    이자비용: 1200,
  };
  const rows: FinanceRow[] = [];
  for (const [account, v] of Object.entries(annual2024)) {
    rows.push(
      row({ period_year: 2024, period_kind: 'annual', period_month: 12, account, value_mwon: v })
    );
  }
  // 1월 행(최신월 아님) — 최신월(m2) 선택 검증용
  rows.push(
    row({
      period_year: 2026,
      period_kind: 'monthly',
      period_month: 1,
      account: '자산',
      value_mwon: 1,
    })
  );
  for (const [account, v] of Object.entries(monthly2026)) {
    rows.push(
      row({ period_year: 2026, period_kind: 'monthly', period_month: 2, account, value_mwon: v })
    );
  }
  return rows;
}

describe('listSubsidiaries', () => {
  it("'전체' 우선 + 나머지 한글 정렬", () => {
    const rows = [
      row({ subsidiary: '미국' }),
      row({ subsidiary: '전체' }),
      row({ subsidiary: '상숙' }),
    ];
    expect(listSubsidiaries(rows)).toEqual(['전체', '미국', '상숙']); // ㅁ < ㅅ
  });
  it("'전체' 없으면 강제 추가하지 않음", () => {
    expect(listSubsidiaries([row({ subsidiary: '미국' })])).toEqual(['미국']);
  });
});

describe('buildLeverageSeries', () => {
  it('억원 환산 + 부채비율(부채/자본) + 시점 선택(연말/최신월)', () => {
    const pts = buildLeverageSeries(dataset(), '전체');
    expect(pts.map((p) => p.periodLabel)).toEqual(['2024.12', '2026.02']);
    expect(pts[0]).toMatchObject({ year: 2024, isYtd: false, assets: 1000, liabilities: 600 });
    expect(pts[0].debtRatio).toBeCloseTo(150, 6); // 600/400*100
    expect(pts[1]).toMatchObject({ year: 2026, isYtd: true, assets: 1200, liabilities: 720 });
    expect(pts[1].debtRatio).toBeCloseTo(150, 6); // 720/480*100
  });
  it('자본 0/null → 부채비율 null', () => {
    const rows = [
      row({ account: '부채', value_mwon: 100 }),
      row({ account: '자본', value_mwon: 0 }),
    ];
    expect(buildLeverageSeries(rows, '전체')[0].debtRatio).toBeNull();
  });
  it('다른 자회사는 제외', () => {
    const rows = [...dataset(), row({ subsidiary: '미국', account: '자산', value_mwon: 999 })];
    const pts = buildLeverageSeries(rows, '미국');
    expect(pts).toHaveLength(1);
    expect(pts[0].assets).toBe(9.99);
  });
  it('온전한 최신월 선택 — 자본이 빠진 5월은 건너뛰고 4월(혼용 방지)', () => {
    const mk = (m: number, account: string, v: number) =>
      row({ period_year: 2026, period_kind: 'monthly', period_month: m, account, value_mwon: v });
    const rows = [
      mk(4, '자산', 100),
      mk(4, '부채', 60),
      mk(4, '자본', 40),
      // 5월: 자산·부채만(자본 누락) → 불완전 → 4월 선택
      mk(5, '자산', 200),
      mk(5, '부채', 120),
    ];
    const pts = buildLeverageSeries(rows, '전체');
    expect(pts).toHaveLength(1);
    expect(pts[0].periodLabel).toBe('2026.04');
    expect(pts[0].assets).toBe(1); // 100/100 = 4월 값(5월 아님)
  });
});

describe('buildInterestRateSeries', () => {
  it('차입금(억원) + 평균이자율(연율화 이자비용/차입금) + 시점(연말/최신월)', () => {
    const pts = buildInterestRateSeries(dataset(), '전체');
    expect(pts.map((p) => p.periodLabel)).toEqual(['2024.12', '2026.02']);
    // 2024 연간: 경과월 12 → 연율화 계수 1. 이자비용 10 / 차입금 250 × 100 = 4%
    expect(pts[0]).toMatchObject({ year: 2024, isYtd: false, debt: 250, interest: 10 });
    expect(pts[0].interestRate).toBeCloseTo(4, 6);
    // 2026 YTD(2월): interest는 실제 누계(연율화 전) 12. 평균이자율만 연율화 ×(12/2)=72 / 차입금 260
    expect(pts[1]).toMatchObject({ year: 2026, isYtd: true, debt: 260, interest: 12 });
    expect(pts[1].interestRate).toBeCloseTo(((12 * (12 / 2)) / 260) * 100, 6);
  });
  it('차입금 0 → 평균이자율 null', () => {
    const rows = [
      row({ account: '이자비용', value_mwon: 100 }),
      row({ account: '차입', value_mwon: 0 }),
    ];
    expect(buildInterestRateSeries(rows, '전체')[0].interestRate).toBeNull();
  });
  it('이자비용 없으면 평균이자율 null (차입금은 표시)', () => {
    const pts = buildInterestRateSeries([row({ account: '차입', value_mwon: 25000 })], '전체');
    expect(pts[0].debt).toBe(250);
    expect(pts[0].interestRate).toBeNull();
  });
});

/**
 * 손익 파생(억원) fixture — 영업이익(2024 연간 50, 2026 YTD 70), 상각비(손익 2026 YTD 45),
 * 최신월 2. 상각비 2024(35)는 미사용 검증용(자금조달 표는 과거 연도에 재무 연간 30을 써야 함).
 */
const PNL_DERIVED: PnlDerivedSeries = {
  opIncome: [
    { year: 2024, eok: 50 },
    { year: 2026, eok: 70 },
  ],
  depreciation: [
    { year: 2024, eok: 35 },
    { year: 2026, eok: 45 },
  ],
  currentYear: 2026,
  currentYearLatestMonth: 2,
};

describe('buildCapitalTable', () => {
  const table = buildCapitalTable(dataset(), PNL_DERIVED, '전체');
  const byKey = (k: string): CapitalRow => table.rows.find((r) => r.key === k)!;

  it('기간 라벨', () => {
    expect(table.periods).toEqual(['2024.12', '2026.02']);
  });
  it('순운전자본 = 채권 + 재고 − 채무 (억원)', () => {
    expect(byKey('nwc').values).toEqual([250, 310]); // 200+150-100, 250+180-120
  });
  it('CAPEX = 유형자산 + 무형자산', () => {
    expect(byKey('capex').values).toEqual([350, 380]);
  });
  it('투하자본 합계 = 순운전자본 + CAPEX', () => {
    expect(byKey('invested_total').values).toEqual([600, 690]);
  });
  it('영업이익은 pnl opIncome(억원) 그대로, 흐름 항목(flow)', () => {
    expect(byKey('opIncome')).toMatchObject({ flow: true, values: [50, 70] });
  });
  it('감가상각비 하이브리드 — 과거(연말)=재무 연간 30, 진행연도(YTD)=손익 45', () => {
    // 2024.12: 재무 annual 3000/100=30 (손익 35 아님). 2026.02 YTD: 손익 45.
    expect(byKey('depreciation')).toMatchObject({ flow: true, values: [30, 45] });
  });
  it('자금조달 합계 = 영업이익 + 감가상각비 + 신규증자 + 차입금', () => {
    // 2024: 50+30+20+250=350, 2026: 70+45+20+260=395
    expect(byKey('financing_total').values).toEqual([350, 395]);
  });
  it('자금조달 합계 증감 = 흐름(영업이익+감가상각비+신규증자) + 차입금증감', () => {
    // 첫 기간 null, 둘째: 영업이익 70 + 감가상각비 45 + 신규증자 20 + (260−250)=10 = 145
    expect(byKey('financing_total').deltaValues).toEqual([null, 145]);
  });
  it('③ 이자비용은 흐름 항목(flow), 음수 표시(억원)', () => {
    // DB 양수(1000/1200) → 부호 반전해 음수
    expect(byKey('interest')).toMatchObject({ flow: true, values: [-10, -12] });
  });
  it('④ 현금은 잔액 한 줄 — 증감 자동 계산(flow 아님)', () => {
    expect(byKey('cash').values).toEqual([80, 90]);
    expect(byKey('cash').flow).toBeUndefined();
  });
  it('채무는 차감 플래그 + 자체 값은 양수', () => {
    expect(byKey('payable')).toMatchObject({ subtract: true, values: [100, 120] });
  });
  it('신규증자는 흐름 항목(flow)', () => {
    expect(byKey('paidIn').flow).toBe(true);
  });
  it('섹션 헤더는 값 없음', () => {
    expect(byKey('invested').values).toEqual([null, null]);
  });
  it('당기순이익 행은 제거됨', () => {
    expect(table.rows.find((r) => r.key === 'netIncome')).toBeUndefined();
  });
  it('pnlDerived 없으면 영업이익 null + 감가상각비는 재무 fallback + 시점 캡 없음', () => {
    const t = buildCapitalTable(dataset(), undefined, '전체');
    expect(byKeyOf(t, 'opIncome').values).toEqual([null, null]);
    // 손익 없으면 YTD도 재무 월간 fallback: 2024 재무 30, 2026 재무 monthly 4000/100=40
    expect(byKeyOf(t, 'depreciation').values).toEqual([30, 40]);
    expect(t.periods).toEqual(['2024.12', '2026.02']);
  });
  it('진행연도 시점 캡 — currentYearLatestMonth=1이면 2026.01', () => {
    const capped = buildCapitalTable(
      dataset(),
      { ...PNL_DERIVED, currentYearLatestMonth: 1 },
      '전체'
    );
    expect(capped.periods).toEqual(['2024.12', '2026.01']);
  });
  it('데이터 없으면 빈 표', () => {
    expect(buildCapitalTable([], PNL_DERIVED, '전체')).toEqual({ periods: [], rows: [] });
  });
});

function byKeyOf(t: ReturnType<typeof buildCapitalTable>, k: string): CapitalRow {
  return t.rows.find((r) => r.key === k)!;
}

describe('computeDelta', () => {
  it('증감 + 증감률', () => {
    expect(computeDelta(250, 310)).toEqual({ abs: 60, pct: 24 });
  });
  it('감소', () => {
    expect(computeDelta(200, 150)).toEqual({ abs: -50, pct: -25 });
  });
  it('이전 0 → 증감률 null', () => {
    expect(computeDelta(0, 100)).toEqual({ abs: 100, pct: null });
  });
  it('한쪽 null → 둘 다 null', () => {
    expect(computeDelta(null, 100)).toEqual({ abs: null, pct: null });
    expect(computeDelta(100, null)).toEqual({ abs: null, pct: null });
  });
});
