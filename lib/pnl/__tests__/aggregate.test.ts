import { describe, expect, it } from 'vitest';
import { grossProfitOf, preparePnlData, prepareYoYView, ratioOfRevenue } from '@/lib/pnl/aggregate';
import type { AggregatedRow, PnlEntry } from '@/lib/pnl/types';

describe('vitest sanity — aggregate.ts', () => {
  it('ratioOfRevenue: 매출이 0이면 null', () => {
    expect(ratioOfRevenue(100, 0)).toBeNull();
  });

  it('ratioOfRevenue: 매출 대비 % 계산', () => {
    expect(ratioOfRevenue(25, 100)).toBe(25);
  });

  it('grossProfitOf: 매출 - 재료 - 노무 - 경비', () => {
    const row: AggregatedRow = {
      key: 'test',
      dims: { sil: '', division: '', factory: '', product: '', customer: '' },
      revenue: 1000,
      material_cost: 300,
      labor_cost: 200,
      expense: 100,
      sga: 50,
      rnd: 20,
      op_income: 330,
    };
    expect(grossProfitOf(row)).toBe(400);
  });
});

// ─── prepareYoYView fixtures ────────────────────────────────────────
// 헬퍼: 연결 연간 행 1개 (period_month=0, year_label 명시).
function annualRow(
  year: number,
  yearLabel: string,
  revenue: number,
  opIncome: number,
  extra: Partial<PnlEntry> = {}
): PnlEntry {
  return {
    basis: 'consolidated',
    year_label: yearLabel,
    period_year: year,
    period_month: 0,
    is_plan: false,
    is_estimate: false,
    sil: 'SIL1',
    division: '구동',
    factory: 'F1',
    product: 'P1',
    customer: 'C1',
    revenue,
    material_cost: null,
    labor_cost: null,
    expense: null,
    sga: null,
    rnd: null,
    op_income: opIncome,
    ...extra,
  };
}

// 헬퍼: 월별 행 1개. basis 기본 consolidated.
function monthlyRow(
  year: number,
  month: number,
  revenue: number,
  opIncome: number,
  extra: Partial<PnlEntry> = {}
): PnlEntry {
  return {
    basis: 'consolidated',
    year_label: String(year),
    period_year: year,
    period_month: month,
    is_plan: false,
    is_estimate: false,
    sil: 'SIL1',
    division: '구동',
    factory: 'F1',
    product: 'P1',
    customer: 'C1',
    revenue,
    material_cost: null,
    labor_cost: null,
    expense: null,
    sga: null,
    rnd: null,
    op_income: opIncome,
    ...extra,
  };
}

describe('prepareYoYView — YoY 비교 1~5단계 통합 함수', () => {
  it('연결 정상 케이스: 기준 2024 → 비교 2023(직전 연도) 매칭, 라벨 그대로', () => {
    const annual = [
      annualRow(2023, '2023', 100, 10),
      annualRow(2024, '2024', 200, 20),
      annualRow(2025, '2025', 300, 30),
    ];
    const view = prepareYoYView(annual, [], 'consolidated', '2024');
    // '2023(_)' prefix 제외 정책 — 2024, 2025만 남아야 함
    expect(view.yearLabels).toEqual(['2024', '2025']);
    expect(view.effBase).toBe('2024');
    // 직전 연도가 2023 → annual에는 있지만 yearLabels에선 제외. effCompare는 fallback으로 effBase
    expect(view.effCompare).toBe('2023');
    expect(view.ytdMonths).toBe(0);
    expect(view.baseEntries).toHaveLength(1);
    expect(view.baseEntries[0].period_year).toBe(2024);
    expect(view.compareEntries).toHaveLength(1);
    expect(view.compareEntries[0].period_year).toBe(2023);
  });

  it('YTD 케이스: 기준 2026 + monthly 1~3월만 적재 → 비교 2025도 1~3월로 잘려서 비교', () => {
    // PnlDashboard가 호출 전에 2026 YTD를 derive해서 annual에 포함시킨다는 전제.
    // 즉 yearLabels에 '2026'이 나타나려면 annual에 period_month=0 row가 있어야 함.
    const annual = [
      annualRow(2024, '2024', 200, 20),
      annualRow(2025, '2025', 300, 30),
      // 2026 YTD derive 결과 (deriveAnnualFromMonthly가 만든 형태)
      annualRow(2026, '2026', 90, 9),
    ];
    const monthly = [
      // 2025: 1~12월 전부
      ...Array.from({ length: 12 }, (_, i) => monthlyRow(2025, i + 1, 25, 2.5)),
      // 2026: 1~3월만 (진행 중 — ytdMonthsOfYear가 3을 반환해야 함)
      monthlyRow(2026, 1, 30, 3),
      monthlyRow(2026, 2, 30, 3),
      monthlyRow(2026, 3, 30, 3),
    ];
    const view = prepareYoYView(annual, monthly, 'consolidated', '2026');
    expect(view.effBase).toBe('2026');
    expect(view.effCompare).toBe('2025');
    expect(view.ytdMonths).toBe(3);
    // 기준 2026 1~3월 + 비교 2025 1~3월 (annual의 2025 합계가 아니라 monthly 1~3월 잘림)
    expect(view.baseEntries.every((e) => e.period_month >= 1 && e.period_month <= 3)).toBe(true);
    expect(view.baseEntries.every((e) => e.period_year === 2026)).toBe(true);
    expect(view.compareEntries.every((e) => e.period_month >= 1 && e.period_month <= 3)).toBe(true);
    expect(view.compareEntries.every((e) => e.period_year === 2025)).toBe(true);
  });

  it('별도(standalone) derive: 월별만 있는 입력 — annual 인자가 derive 결과여도 동작', () => {
    // standalone은 호출 측에서 deriveStandaloneAnnual로 만든 결과를 annual로 넘긴다.
    // 그 결과 행은 basis='standalone', period_month=0, year_label=String(year).
    const annual: PnlEntry[] = [
      annualRow(2024, '2024', 100, 10, { basis: 'standalone' }),
      annualRow(2025, '2025', 150, 15, { basis: 'standalone' }),
    ];
    const view = prepareYoYView(annual, [], 'standalone', '2025');
    expect(view.yearLabels).toEqual(['2024', '2025']);
    expect(view.effBase).toBe('2025');
    expect(view.effCompare).toBe('2024');
    expect(view.baseEntries).toHaveLength(1);
    expect(view.baseEntries[0].period_year).toBe(2025);
  });

  it("'2023 제외' 필터: 2023 prefix 라벨은 yearLabels에 포함되지 않음", () => {
    const annual = [
      annualRow(2023, '2023', 100, 10),
      annualRow(2024, '2024', 200, 20),
      annualRow(2025, '2025', 300, 30),
    ];
    const view = prepareYoYView(annual, [], 'consolidated', '2025');
    expect(view.yearLabels).not.toContain('2023');
    // 하지만 effCompare는 직전 연도 4자리 prefix 매칭으로 annual의 2023 행을 비교 대상으로 잡음
    expect(view.effCompare).toBe('2024');
  });

  it('baseYearLabel=""(빈 문자열): effBase가 yearLabels 최신값으로 fallback', () => {
    const annual = [annualRow(2024, '2024', 200, 20), annualRow(2025, '2025', 300, 30)];
    const view = prepareYoYView(annual, [], 'consolidated', '');
    expect(view.effBase).toBe('2025');
    expect(view.effCompare).toBe('2024');
  });

  it("suffix 라벨('2025(E)' / '2026'): 4자리 prefix로 직전 연도 매칭", () => {
    // 실제 DB에는 '2025(E)' (추정), '2026(P)' (계획) 같은 suffix 라벨이 존재.
    const annual = [
      annualRow(2024, '2024', 200, 20),
      annualRow(2025, '2025(E)', 300, 30),
      annualRow(2026, '2026', 400, 40),
    ];
    const view = prepareYoYView(annual, [], 'consolidated', '2026');
    expect(view.effBase).toBe('2026');
    // 직전 연도 2025의 라벨은 '2025(E)' — 4자리 prefix 매칭으로 그것을 찾아야 함
    expect(view.effCompare).toBe('2025(E)');
    expect(view.baseEntries[0].year_label).toBe('2026');
    expect(view.compareEntries[0].year_label).toBe('2025(E)');
  });
});

describe('preparePnlData — PnlDashboard 진입 시 raw → derived 변환', () => {
  it('연결 연간 + 2026 YTD derive + 별도 연간 derive가 하나로 합쳐진다', () => {
    const data: PnlEntry[] = [
      // 연결 연간: 2024, 2025
      annualRow(2024, '2024', 200, 20),
      annualRow(2025, '2025', 300, 30),
      // 연결 2026 monthly 1~3월 (annual 행 없음 → derive 대상)
      monthlyRow(2026, 1, 30, 3),
      monthlyRow(2026, 2, 30, 3),
      monthlyRow(2026, 3, 30, 3),
      // 별도 월별 (DB에 별도 연간 행 없음 → derive 대상)
      monthlyRow(2025, 1, 10, 1, { basis: 'standalone' }),
      monthlyRow(2025, 2, 10, 1, { basis: 'standalone' }),
    ];
    const prepared = preparePnlData(data);

    // annualEntries에 3종류 모두 포함 — 연결 2024/2025 + 연결 2026 YTD derive + 별도 2025 derive
    const consol = prepared.annualEntries.filter((e) => e.basis === 'consolidated');
    expect(consol.map((e) => e.year_label).sort()).toEqual(['2024', '2025', '2026']);
    // 2026 YTD derive 결과 매출 = 30 * 3 = 90
    const ytd2026 = consol.find((e) => e.year_label === '2026');
    expect(ytd2026?.revenue).toBe(90);

    const stand = prepared.annualEntries.filter((e) => e.basis === 'standalone');
    expect(stand).toHaveLength(1);
    expect(stand[0].period_year).toBe(2025);
    // 별도 derive 결과 매출 = 10 + 10 = 20
    expect(stand[0].revenue).toBe(20);
  });

  it("'2026(P)' 계획값 행은 annualEntries에서 제외된다", () => {
    const data: PnlEntry[] = [
      annualRow(2024, '2024', 200, 20),
      annualRow(2025, '2025', 300, 30),
      annualRow(2026, '2026(P)', 500, 50, { is_plan: true }), // 계획값 — 제외 대상
    ];
    const prepared = preparePnlData(data);
    const labels = prepared.annualEntries
      .filter((e) => e.basis === 'consolidated')
      .map((e) => e.year_label);
    expect(labels).not.toContain('2026(P)');
    expect(labels).toEqual(['2024', '2025']);
  });

  it('annualByBasis / monthlyByBasis가 basis별로 정확히 분리된다', () => {
    const data: PnlEntry[] = [
      annualRow(2024, '2024', 200, 20),
      annualRow(2025, '2025', 300, 30),
      monthlyRow(2024, 1, 20, 2),
      monthlyRow(2024, 1, 8, 1, { basis: 'standalone' }),
      monthlyRow(2025, 6, 30, 3, { basis: 'standalone' }),
    ];
    const prepared = preparePnlData(data);

    // monthlyByBasis: 원본 data를 basis별로 분리 — derive 없음
    expect(prepared.monthlyByBasis.consolidated.every((e) => e.basis === 'consolidated')).toBe(
      true
    );
    expect(prepared.monthlyByBasis.standalone.every((e) => e.basis === 'standalone')).toBe(true);
    expect(prepared.monthlyByBasis.consolidated).toHaveLength(3); // annual 2개 + monthly 1개
    expect(prepared.monthlyByBasis.standalone).toHaveLength(2); // monthly 2개

    // annualByBasis: annualEntries를 basis별로 분리
    expect(prepared.annualByBasis.consolidated.every((e) => e.basis === 'consolidated')).toBe(true);
    expect(prepared.annualByBasis.standalone.every((e) => e.basis === 'standalone')).toBe(true);
    // 별도 2024 + 2025 각 1행씩 derive
    expect(prepared.annualByBasis.standalone).toHaveLength(2);
    const standYears = prepared.annualByBasis.standalone.map((e) => e.period_year).sort();
    expect(standYears).toEqual([2024, 2025]);
  });
});
