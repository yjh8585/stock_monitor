import { describe, it, expect } from 'vitest';
import {
  buildCapitalTable,
  buildLeverageSeries,
  computeDelta,
  listSubsidiaries,
} from '../aggregate';
import type { CapitalRow, FinanceRow } from '../types';

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
    당기순이익: 5000,
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
    당기순이익: 7000,
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
});

describe('buildCapitalTable', () => {
  const table = buildCapitalTable(dataset(), '전체');
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
  it('자금조달 합계 = 당기순이익 + 신규증자 + 차입금', () => {
    // 당기순이익(50/70) + 신규증자(20) + 차입금(250/260)
    expect(byKey('financing_total').values).toEqual([320, 350]);
  });
  it('자금조달 합계 증감 = 당기순이익 + 신규증자 + 차입금증감 (흐름 합산)', () => {
    // 첫 기간 null, 둘째: 당기순이익 70 + 신규증자 20 + (260−250) = 100
    expect(byKey('financing_total').deltaValues).toEqual([null, 100]);
  });
  it('당기순이익은 흐름 항목(flow)', () => {
    expect(byKey('netIncome')).toMatchObject({ flow: true, values: [50, 70] });
  });
  it('현금(③)은 잔액 한 줄 — 증감은 자동 계산(별도 현금증감 행 없음)', () => {
    expect(byKey('cash').values).toEqual([80, 90]);
    expect(table.rows.find((r) => r.key === 'cashDelta')).toBeUndefined();
  });
  it('채무는 차감 플래그 + 자체 값은 양수', () => {
    expect(byKey('payable')).toMatchObject({ subtract: true, values: [100, 120] });
  });
  it('신규증자는 흐름 항목(flow) — 증감칸에 당기 신규액 표시', () => {
    expect(byKey('paidIn').flow).toBe(true);
    // 다른 상세행은 flow 없음(일반 증감 표시 유지)
    expect(byKey('cash').flow).toBeUndefined();
  });
  it('섹션 헤더는 값 없음', () => {
    expect(byKey('invested').values).toEqual([null, null]);
  });
  it('데이터 없으면 빈 표', () => {
    expect(buildCapitalTable([], '전체')).toEqual({ periods: [], rows: [] });
  });
});

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
