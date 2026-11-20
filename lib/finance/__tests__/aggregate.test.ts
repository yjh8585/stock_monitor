import { describe, it, expect } from 'vitest';
import {
  buildCashBridge,
  buildCashWaterfall,
  buildInterestRateSeries,
  buildLeverageSeries,
  CASH_FLOW_ACCOUNTS,
  listSubsidiaries,
} from '../aggregate';
import type { FinanceRow, PnlDerivedSeries } from '../types';

function row(partial: Partial<FinanceRow>): FinanceRow {
  return {
    subsidiary: '전체',
    consolidation: '연결',
    period_year: 2024,
    period_kind: 'annual',
    period_month: 12,
    account: '자산',
    value_mwon: 0,
    note: null,
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

/** 자금수지용 — 2025 연말(annual) + 2026 월별(m1, m2). 단위 백만원. */
function bridgeDataset(): FinanceRow[] {
  const y2025: Record<string, number> = {
    채권: 20000,
    재고: 15000,
    채무: 10000,
    현금성자산: 8000,
    차입: 25000,
    '감가상각비(유형+무형)': 3000,
    이자비용: 1000,
    증자: 0,
  };
  const m2026: Record<string, number> = {
    채권: 23000, // +30억 → 유출 −30
    재고: 14000, // −10억 → 유입 +10
    채무: 12000, // +20억 → 유입 +20
    현금성자산: 9000, // +10억
    차입: 26000, // +10억
    '감가상각비(유형+무형)': 400,
    이자비용: 200, // → −2
    증자: 500, // +5
    '법인세 납부': -300, // −3
    'CAPEX 유지보수': -1000, // −10
    'CAPEX 증설': -2000, // −20
    '일회성 영업현금': -700, // −7 (더미)
  };
  const out: FinanceRow[] = [];
  for (const [account, v] of Object.entries(y2025)) {
    out.push(
      row({ period_year: 2025, period_kind: 'annual', period_month: 12, account, value_mwon: v })
    );
  }
  for (const m of [1, 2]) {
    for (const [account, v] of Object.entries(m2026)) {
      out.push(
        row({
          period_year: 2026,
          period_kind: 'monthly',
          period_month: m,
          account,
          value_mwon: v,
          note:
            account === '일회성 영업현금'
              ? '[더미] 고객사 합의금'
              : account === '채권'
                ? '관계사 미회수'
                : null,
        })
      );
    }
  }
  return out;
}

const BRIDGE_PNL: PnlDerivedSeries = {
  opIncome: [{ year: 2026, eok: 50 }],
  depreciation: [{ year: 2026, eok: 6 }],
  currentYear: 2026,
  currentYearLatestMonth: 2,
};

describe('buildCashBridge', () => {
  const b = buildCashBridge(bridgeDataset(), BRIDGE_PNL, '전체');
  const v = (k: string) => b.rows.find((r) => r.key === k)!.cells.map((c) => c.value);
  const cell = (k: string) => b.rows.find((r) => r.key === k)!.cells[0];

  it('첫 시점(2025)은 기초 잔액 역할만 — 열은 2026 누계 하나', () => {
    expect(b.periods).toEqual(['2026.02']);
    expect(b.isYtd).toEqual([true]);
  });
  it('① EBITDA = 영업이익(손익) + 감가상각비(진행연도=손익 상각비)', () => {
    expect(v('op')).toEqual([50]);
    expect(v('dep')).toEqual([6]);
    expect(v('ebitda')).toEqual([56]);
  });
  it('운전자본은 행이 따로 — 채권·재고 증가는 −, 채무 증가는 +', () => {
    expect(v('ar')).toEqual([-30]);
    expect(v('inv')).toEqual([10]);
    expect(v('ap')).toEqual([20]);
  });
  it('이자비용은 DB 양수 → 유출 −, 법인세는 입력 부호 그대로', () => {
    expect(v('interest')).toEqual([-2]);
    expect(v('tax')).toEqual([-3]);
  });
  it('② = ① ± 운전자본 − 이자 + 법인세 · ③ = ② + CAPEX', () => {
    expect(v('ocf')).toEqual([51]); // 56−30+10+20−2−3
    expect(v('fcf')).toEqual([21]); // 51−10−20
  });
  it('⑤ 순현금증감 = 현금 잔액 차이(실제값) · 기초/기말 현금', () => {
    expect(v('netCash')).toEqual([10]);
    expect(v('beginCash')).toEqual([80]);
    expect(v('endCash')).toEqual([90]);
  });
  it('미설명 차이 = ⑤ − 나머지 전부 → 표가 위아래로 맞는다', () => {
    // 설명된 합 = 21 −7 +5 +10(순차입) = 29 → 미설명 = 10 − 29 = −19
    expect(v('unexplained')).toEqual([-19]);
    // ④ = ③ + 일회성 + 증자 + 미설명 = 21 −7 +5 −19 = 0, ④ + 순차입 10 = ⑤ 10
    expect(v('preFin')).toEqual([0]);
    expect(v('netDebt')).toEqual([10]);
  });
  it('비고는 칸에 실리고, [더미] 비고는 dummy 표시 + 그 값을 포함한 소계도 dummy', () => {
    expect(cell('ar')).toMatchObject({ note: '관계사 미회수', dummy: false });
    expect(cell('oneoff')).toMatchObject({ value: -7, note: '[더미] 고객사 합의금', dummy: true });
    expect(cell('preFin').dummy).toBe(true);
    expect(cell('fcf').dummy).toBe(false);
  });
  it('입력 안 한 흐름 계정은 null(0 으로 꾸미지 않는다)', () => {
    expect(v('assetSale')).toEqual([null]);
  });
  it('직전 연도가 비면 잔액 차이를 만들지 않는다', () => {
    const gap = bridgeDataset().map((r) =>
      r.period_year === 2025 ? { ...r, period_year: 2024 } : r
    );
    const g = buildCashBridge(gap, BRIDGE_PNL, '전체');
    expect(g.rows.find((r) => r.key === 'ar')!.cells[0].value).toBeNull();
  });
  it('데이터 없으면 빈 표', () => {
    expect(buildCashBridge([], BRIDGE_PNL, '전체')).toEqual({ periods: [], isYtd: [], rows: [] });
  });

  it('진행연도 표시월은 손익 최신월로 캡 — 손익 1월이면 2026.01', () => {
    const c = buildCashBridge(
      bridgeDataset(),
      { ...BRIDGE_PNL, currentYearLatestMonth: 1 },
      '전체'
    );
    expect(c.periods).toEqual(['2026.01']);
    expect(c.rows.find((r) => r.key === 'op')!.cells[0].value).toBe(50);
  });
  it('재무가 손익보다 늦으면(재무 2월 · 손익 3월) 영업이익·EBITDA 를 비우고 상각비는 재무 값', () => {
    const c = buildCashBridge(
      bridgeDataset(),
      { ...BRIDGE_PNL, currentYearLatestMonth: 3 },
      '전체'
    );
    const at = (k: string) => c.rows.find((r) => r.key === k)!.cells[0];
    expect(c.periods).toEqual(['2026.02']);
    expect(at('op').value).toBeNull();
    expect(at('op').note).toContain('3월');
    expect(at('ebitda').value).toBeNull();
    expect(at('dep').value).toBe(4); // 재무 누계 400 백만원
  });
  it('영업이익이 비어도 미설명 차이가 흡수해 ⑤·폭포 차트가 맞는다', () => {
    const c = buildCashBridge(bridgeDataset(), { ...BRIDGE_PNL, opIncome: [] }, '전체');
    const val = (k: string) => c.rows.find((r) => r.key === k)!.cells[0].value as number;
    expect(val('ebitda')).toBeNull();
    // ②·③ 소계도 비운다 — 나머지 항목만의 합(51−56 = −5 등)을 정상 값처럼 내지 않는다
    expect(val('ocf')).toBeNull();
    expect(val('fcf')).toBeNull();
    expect(val('preFin') + val('netDebt')).toBeCloseTo(val('netCash'));
    const w = buildCashWaterfall(c);
    const reached = w.slice(1, -1).reduce((acc, s) => acc + s.value, w[0].value);
    expect(reached).toBeCloseTo(90);
  });
  it('과거 연도 열은 연간 — 상각비는 재무 연간 값(손익 상각비 아님)', () => {
    const rows = [
      ...bridgeDataset(),
      row({
        period_year: 2024,
        period_kind: 'annual',
        period_month: 12,
        account: '현금성자산',
        value_mwon: 5000,
      }),
    ];
    const pnl = {
      ...BRIDGE_PNL,
      opIncome: [{ year: 2025, eok: 20 }, ...BRIDGE_PNL.opIncome],
      depreciation: [{ year: 2025, eok: 99 }, ...BRIDGE_PNL.depreciation],
    };
    const c = buildCashBridge(rows, pnl, '전체');
    const at = (k: string) => c.rows.find((r) => r.key === k)!.cells[0];
    expect(c.periods).toEqual(['2025.12', '2026.02']);
    expect(c.isYtd).toEqual([false, true]);
    expect(at('op').value).toBe(20);
    expect(at('dep').value).toBe(30);
    expect(at('netCash').value).toBe(30); // 50 → 80
  });
  it('지난해 월별 행이 DB 에 남아 있어도 전기는 그 해 12월 연말', () => {
    const leftover = Object.entries({ 채권: 1, 재고: 1, 채무: 1, 현금성자산: 1, 차입: 1 }).map(
      ([account, v]) =>
        row({ period_year: 2025, period_kind: 'monthly', period_month: 11, account, value_mwon: v })
    );
    const c = buildCashBridge([...bridgeDataset(), ...leftover], BRIDGE_PNL, '전체');
    expect(c.rows.find((r) => r.key === 'beginCash')!.cells[0].value).toBe(80);
    expect(c.rows.find((r) => r.key === 'ar')!.cells[0].value).toBe(-30);
  });
  describe('진행연도에 12월(연간) 행이 생겼을 때', () => {
    const dec = (accounts: string[]) =>
      accounts.map((account) =>
        row({ period_year: 2026, period_kind: 'annual', period_month: 12, account, value_mwon: 1 })
      );
    const ALL = ['채권', '재고', '채무', '현금성자산', '차입'];
    const pnl12 = { ...BRIDGE_PNL, currentYearLatestMonth: 12 };

    it('계정이 온전하고 손익도 12월이면 연말 열', () => {
      expect(buildCashBridge([...bridgeDataset(), ...dec(ALL)], pnl12, '전체').periods).toEqual([
        '2026.12',
      ]);
    });
    it('12월 계정이 일부만 들어왔으면 온전한 월별 최신월로 내려간다', () => {
      const c = buildCashBridge([...bridgeDataset(), ...dec(['현금성자산'])], pnl12, '전체');
      expect(c.periods).toEqual(['2026.02']);
    });
    it('원래 입력하지 않는 계정이라 월별도 온전하지 않으면 연말을 그대로 쓴다', () => {
      const noInterest = (rs: FinanceRow[]) => rs.filter((r) => r.account !== '이자비용');
      const rows = noInterest([
        ...dataset(),
        ...['자산', '부채', '자본', '차입'].map((account) =>
          row({
            period_year: 2026,
            period_kind: 'annual',
            period_month: 12,
            account,
            value_mwon: 1,
          })
        ),
      ]);
      expect(buildInterestRateSeries(rows, '전체').map((p) => p.periodLabel)).toEqual([
        '2024.12',
        '2026.12',
      ]);
    });
    it('손익이 아직 12월 전이면 12월 재무와 섞지 않고 손익월로 내려간다', () => {
      const c = buildCashBridge([...bridgeDataset(), ...dec(ALL)], BRIDGE_PNL, '전체');
      expect(c.periods).toEqual(['2026.02']);
    });
  });
  it('연결 행만 쓴다 — 같은 자회사의 별도 행은 더하지 않는다', () => {
    const extra = row({
      consolidation: '별도',
      period_year: 2026,
      period_kind: 'monthly',
      period_month: 2,
      account: '현금성자산',
      value_mwon: 2500,
    });
    const c = buildCashBridge([...bridgeDataset(), extra], BRIDGE_PNL, '전체');
    expect(c.rows.find((r) => r.key === 'endCash')!.cells[0].value).toBe(90);
  });
  it('손익 상각비로 바꾼 칸은 재무 행의 [더미] 표시를 물려받지 않는다 · 기초 현금 더미는 표시', () => {
    const rows = bridgeDataset().map((r) =>
      r.account === '감가상각비(유형+무형)' && r.period_year === 2026
        ? { ...r, note: '[더미] 예시' }
        : r.account === '현금성자산' && r.period_year === 2025
          ? { ...r, note: '[더미] 기초' }
          : r
    );
    const c = buildCashBridge(rows, BRIDGE_PNL, '전체');
    const at = (k: string) => c.rows.find((r) => r.key === k)!.cells[0];
    expect(at('dep')).toMatchObject({ value: 6, note: null, dummy: false });
    expect(at('beginCash').dummy).toBe(true);
    expect(at('netCash').dummy).toBe(true); // 전기말 잔액이 더미면 그 차이도 더미
  });
  it('리스료 지급(원금 + 이자)은 ② 에서 빠진다 — 미설명 차이엔 남지 않는다', () => {
    const rows = [
      ...bridgeDataset(),
      row({
        period_year: 2026,
        period_kind: 'monthly',
        period_month: 2,
        account: '리스료 지급',
        value_mwon: -400,
      }),
    ];
    const c = buildCashBridge(rows, BRIDGE_PNL, '전체');
    const val = (k: string) => c.rows.find((r) => r.key === k)!.cells[0].value;
    expect(val('lease')).toBe(-4);
    expect(val('ocf')).toBe(47); // 51 − 4
    expect(val('fcf')).toBe(17);
    expect(val('unexplained')).toBe(-15); // −19 + 4
    const lr = c.rows.findIndex((r) => r.key === 'lease');
    expect(c.rows[lr - 1].key).toBe('interest');
    const w = buildCashWaterfall(c).find((s) => s.key === 'interestTax')!;
    expect(w.value).toBeCloseTo(-9); // 이자 −2 · 리스 −4 · 법인세 −3
  });
  it('흐름 계정 정본 목록을 모두 읽는다 — 값을 넣으면 그만큼 미설명 차이가 줄어든다', () => {
    const withFlow = (account: string, mwon: number) => [
      ...bridgeDataset().filter((r) => !(r.period_year === 2026 && r.account === account)),
      row({
        period_year: 2026,
        period_kind: 'monthly',
        period_month: 2,
        account,
        value_mwon: mwon,
      }),
    ];
    const unexplained = (rows: FinanceRow[]) =>
      buildCashBridge(rows, BRIDGE_PNL, '전체').rows.find((r) => r.key === 'unexplained')!.cells[0]
        .value as number;
    for (const acc of CASH_FLOW_ACCOUNTS) {
      const diff = unexplained(withFlow(acc, -500)) - unexplained(withFlow(acc, 0));
      expect(diff, acc).toBeCloseTo(5);
    }
  });
});

describe('buildCashWaterfall', () => {
  const steps = buildCashWaterfall(buildCashBridge(bridgeDataset(), BRIDGE_PNL, '전체'));
  it('기초 현금에서 출발해 기말 현금에서 끝난다', () => {
    expect(steps[0]).toMatchObject({ key: 'begin', value: 80, range: [0, 80] });
    expect(steps.at(-1)).toMatchObject({ key: 'end', value: 90, range: [0, 90] });
  });
  it('증감 막대를 다 쌓으면 기말 현금에 닿는다', () => {
    const mids = steps.slice(1, -1);
    const reached = mids.reduce((acc, s) => acc + s.value, steps[0].value);
    expect(reached).toBeCloseTo(90);
  });
  it('모든 증감 막대가 앞 막대 끝에서 이어진다(범위 = [min, max] of 누적 전·후)', () => {
    let running = steps[0].value;
    for (const s of steps.slice(1, -1)) {
      const next = running + s.value;
      expect(s.range, s.key).toEqual([Math.min(running, next), Math.max(running, next)]);
      running = next;
    }
  });
  it('감소 막대 범위는 [다음, 이전] — 매출채권 −30', () => {
    // 80 + EBITDA 56 = 136 → 매출채권 −30 → 106
    expect(steps.find((s) => s.key === 'ar')).toMatchObject({ value: -30, range: [106, 136] });
  });
  it('더미가 섞인 묶음은 dummy', () => {
    expect(steps.find((s) => s.key === 'oneoff')!.dummy).toBe(true);
    expect(steps.find((s) => s.key === 'capex')!.dummy).toBe(false);
  });
});
