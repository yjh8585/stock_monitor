import { describe, expect, it } from 'vitest';
import {
  addMonths,
  analyzeDrivers,
  attachEventContext,
  buildGapPoints,
  buildInventoryOutlook,
  buildInventoryOutlooks,
  buildMonthlyFlow,
  buildNaProductionMonths,
  buildNaRetailMonths,
  buildNaRetailQuarters,
  buildProjectedGapQuarter,
  describeCox,
  describeMonthlyFlow,
  detectLag,
  detectLagQuarterly,
  diagnose,
  estimateCountryMonth,
  lastCompleteMonth,
  lastCompleteQuarter,
  MIN_CONDITIONAL_SAMPLES,
  monthFromIndex,
  monthIndex,
  monthLabel,
  monthsOfQuarter,
  pearson,
  quarterFromIndex,
  quarterIndex,
  quarterLabel,
  quarterOfYearMonth,
  revenueByQuarter,
  toYoyByIndex,
  toYoySeries,
  wilsonInterval,
} from './aggregate';
import type {
  CoxInventoryRow,
  GapPoint,
  MonthlyFlowPoint,
  PlantEvent,
  ProductionMonthRow,
  RetailMonthRow,
  RevenueMonthRow,
  ShipmentRow,
} from './types';

function retail(
  country: string,
  yearMonth: number,
  sales: number,
  model = 'Compass'
): RetailMonthRow {
  return { country, model, year_month: yearMonth, sales };
}

function produce(
  country: string,
  yearMonth: number,
  production: number,
  model = 'Compass'
): ProductionMonthRow {
  return { country, model, year_month: yearMonth, production };
}

function ship(yearPeriod: string, units: number, isDerived = false): ShipmentRow {
  return {
    region: 'North America',
    year_period: yearPeriod,
    shipments_units: units,
    is_derived: isDerived,
  };
}

/** 3개국 × 지정 월 범위를 균일하게 채운다. */
function fillNa(months: number[], perCountry = 100): RetailMonthRow[] {
  const rows: RetailMonthRow[] = [];
  for (const m of months) {
    rows.push(retail('USA', m, perCountry));
    rows.push(retail('Canada', m, perCountry));
    rows.push(retail('Mexico', m, perCountry));
  }
  return rows;
}

/** 3개국 × 지정 월 범위를 균일하게 채운 생산 행. */
function fillNaProduction(months: number[], perCountry = 100): ProductionMonthRow[] {
  const rows: ProductionMonthRow[] = [];
  for (const m of months) {
    rows.push(produce('USA', m, perCountry));
    rows.push(produce('Canada', m, perCountry));
    rows.push(produce('Mexico', m, perCountry));
  }
  return rows;
}

/** 월별 갭을 지정해 실제 빌더로 MonthlyFlowPoint[]를 만든다 (cumGap도 진짜 값). */
function flowWithGaps(gaps: [number, number][]): MonthlyFlowPoint[] {
  const production = new Map(gaps.map(([m, g]) => [m, 1000 + g]));
  const retailMap = new Map(gaps.map(([m]) => [m, 1000]));
  return buildMonthlyFlow(production, retailMap);
}

describe('기간 헬퍼', () => {
  it('월 → 분기', () => {
    expect(quarterOfYearMonth(202501)).toBe('2025-Q1');
    expect(quarterOfYearMonth(202503)).toBe('2025-Q1');
    expect(quarterOfYearMonth(202504)).toBe('2025-Q2');
    expect(quarterOfYearMonth(202512)).toBe('2025-Q4');
  });

  it('분기 라벨은 2자리 연도', () => {
    expect(quarterLabel('2025-Q1')).toBe('25Q1');
    expect(quarterLabel('2026-Q4')).toBe('26Q4');
  });

  it('월 라벨', () => {
    expect(monthLabel(202603)).toBe('26.03');
    expect(monthLabel(202612)).toBe('26.12');
  });

  it('monthIndex는 연 경계에서도 1씩 증가한다 — 202512 다음이 202601', () => {
    expect(monthIndex(202601) - monthIndex(202512)).toBe(1);
    expect(monthIndex(202502) - monthIndex(202501)).toBe(1);
  });

  it('monthIndex ↔ monthFromIndex 왕복 (한 해 전 월)', () => {
    for (let m = 1; m <= 12; m += 1) {
      const yearMonth = 202500 + m;
      expect(monthFromIndex(monthIndex(yearMonth))).toBe(yearMonth);
    }
  });

  it('addMonths는 연 경계를 넘는다 — 202601에서 −1은 202512', () => {
    expect(addMonths(202601, -1)).toBe(202512);
    expect(addMonths(202512, 1)).toBe(202601);
  });

  it('addMonths는 1년 이상도 넘는다', () => {
    expect(addMonths(202601, -13)).toBe(202412);
    expect(addMonths(202411, 14)).toBe(202601);
    expect(addMonths(202506, 0)).toBe(202506);
  });
});

describe('lastCompleteQuarter — 캐나다 수집 지연 함정', () => {
  it('3개국이 분기말까지 다 차면 그 분기', () => {
    const rows = fillNa([202601, 202602, 202603]);
    expect(lastCompleteQuarter(rows)).toBe('2026-Q1');
  });

  it('캐나다만 한 달 뒤처지면 직전 완전 분기로 후퇴한다', () => {
    // 실제 관측: USA·Mexico는 202606, Canada는 202605까지.
    const rows = [
      ...fillNa([202604, 202605]),
      retail('USA', 202606, 100),
      retail('Mexico', 202606, 100),
      // Canada 202606 없음
    ];
    // 공통 최신 = 202605 (분기 중간) → 2026-Q2는 미완성 → 2026-Q1
    expect(lastCompleteQuarter(rows)).toBe('2026-Q1');
  });

  it('공통 최신이 분기 중간이면 직전 분기', () => {
    const rows = fillNa([202601, 202602, 202603, 202604]);
    expect(lastCompleteQuarter(rows)).toBe('2026-Q1');
  });

  it('한 나라라도 데이터가 아예 없으면 null (북미 합산 불가)', () => {
    const rows = [retail('USA', 202603, 100), retail('Canada', 202603, 100)];
    expect(lastCompleteQuarter(rows)).toBeNull();
  });

  it('빈 입력은 null', () => {
    expect(lastCompleteQuarter([])).toBeNull();
  });
});

describe('lastCompleteMonth — 생산·소매의 지연 국가가 서로 다르다', () => {
  it('3개국 × 두 계열이 모두 같은 달까지 차면 그 달', () => {
    const production = fillNaProduction([202604, 202605]);
    const rows = fillNa([202604, 202605]);
    expect(lastCompleteMonth(production, rows)).toBe(202605);
  });

  it('소매만 캐나다가 뒤처져도 후퇴한다 — 생산이 다 차 있어도 소용없다', () => {
    const production = fillNaProduction([202605, 202606]);
    const rows = [
      ...fillNa([202605]),
      retail('USA', 202606, 100),
      retail('Mexico', 202606, 100),
      // Canada 202606 없음
    ];
    expect(lastCompleteMonth(production, rows)).toBe(202605);
  });

  it('생산만 멕시코가 앞서가도 후퇴한다 — 앞선 나라가 아니라 늦은 나라가 컷오프를 정한다', () => {
    // 실제 관측: 생산은 USA·Canada가 202605인데 Mexico만 202606까지 들어와 있다.
    const production = [
      ...fillNaProduction([202605]),
      produce('Mexico', 202606, 100),
      // USA·Canada 202606 없음
    ];
    const rows = fillNa([202605, 202606]);
    expect(lastCompleteMonth(production, rows)).toBe(202605);
  });

  it('두 계열의 지연 국가가 반대여도 공통 최신월을 잡는다 (2026-07 실측 구성)', () => {
    // 생산: USA·Canada 202605 / Mexico 202606 — 소매: USA·Mexico 202606 / Canada 202605
    const production = [...fillNaProduction([202605]), produce('Mexico', 202606, 100)];
    const rows = [...fillNa([202605]), retail('USA', 202606, 100), retail('Mexico', 202606, 100)];
    expect(lastCompleteMonth(production, rows)).toBe(202605);
  });

  it('생산에 한 나라가 아예 없으면 null', () => {
    const production = [produce('USA', 202605, 100), produce('Canada', 202605, 100)];
    expect(lastCompleteMonth(production, fillNa([202605]))).toBeNull();
  });

  it('어느 나라 소매가 마세라티뿐이면 도착으로 안 쳐준다 — 스코프 밖 행이 컷오프를 밀면 안 된다', () => {
    const production = fillNaProduction([202605]);
    const rows = [
      retail('USA', 202605, 100),
      retail('Mexico', 202605, 100),
      retail('Canada', 202605, 100, 'Grecale'), // 마세라티만 → Canada는 미도착 취급
    ];
    expect(lastCompleteMonth(production, rows)).toBeNull();
  });

  it('빈 입력은 null', () => {
    expect(lastCompleteMonth([], [])).toBeNull();
    expect(lastCompleteMonth(fillNaProduction([202605]), [])).toBeNull();
    expect(lastCompleteMonth([], fillNa([202605]))).toBeNull();
  });
});

describe('buildNaRetailQuarters', () => {
  it('3개국 합산, 마세라티 제외', () => {
    const rows = [
      retail('USA', 202601, 1000),
      retail('Canada', 202601, 100),
      retail('Mexico', 202601, 50),
      retail('USA', 202601, 9999, 'Grecale'), // 마세라티 — 제외되어야
      retail('USA', 202601, 7, 'SF90 Stradale'), // 페라리 오분류 — 제외되어야
    ];
    const out = buildNaRetailQuarters(rows, '2026-Q1');
    expect(out.get('2026-Q1')).toBe(1150);
  });

  it('북미 밖 국가는 무시', () => {
    const rows = [retail('USA', 202601, 100), retail('Brazil', 202601, 9999)];
    expect(buildNaRetailQuarters(rows, '2026-Q1').get('2026-Q1')).toBe(100);
  });

  it('cutoff 이후 분기는 버린다 — 잠정 분기가 새면 갭이 부풀어 재고를 과대평가한다', () => {
    const rows = [...fillNa([202601, 202602, 202603]), ...fillNa([202604])];
    const out = buildNaRetailQuarters(rows, '2026-Q1');
    expect(out.has('2026-Q1')).toBe(true);
    expect(out.has('2026-Q2')).toBe(false);
  });

  it('cutoff가 null이면 빈 결과', () => {
    expect(buildNaRetailQuarters(fillNa([202601]), null).size).toBe(0);
  });
});

describe('buildNaRetailMonths', () => {
  it('3개국 월별 합산, 마세라티 제외', () => {
    const rows = [
      retail('USA', 202601, 1000),
      retail('Canada', 202601, 100),
      retail('Mexico', 202601, 50),
      retail('USA', 202601, 999, 'Ghibli'),
      retail('Brazil', 202601, 999),
    ];
    expect(buildNaRetailMonths(rows).get(202601)).toBe(1150);
  });
});

describe('buildNaProductionMonths', () => {
  it('3개국 공장 합산', () => {
    const rows = [
      produce('USA', 202601, 1000),
      produce('Canada', 202601, 100),
      produce('Mexico', 202601, 50),
    ];
    expect(buildNaProductionMonths(rows).get(202601)).toBe(1150);
  });

  it('북미 밖 공장은 무시 — country는 판매 시장이 아니라 공장 소재국이다', () => {
    const rows = [
      produce('USA', 202601, 100),
      produce('Brazil', 202601, 9999),
      produce('Italy', 202601, 9999),
    ];
    expect(buildNaProductionMonths(rows).get(202601)).toBe(100);
  });

  it('cutoff 이후 월은 버린다 — 부분 수집된 달이 새면 갭이 왜곡된다', () => {
    const rows = [...fillNaProduction([202601, 202602])];
    const out = buildNaProductionMonths(rows, 202601);
    expect(out.has(202601)).toBe(true);
    expect(out.has(202602)).toBe(false);
  });

  it('cutoff가 없으면 전 기간을 담는다', () => {
    const out = buildNaProductionMonths(fillNaProduction([202601, 202602]));
    expect([...out.keys()].sort((a, b) => a - b)).toEqual([202601, 202602]);
  });
});

describe('buildMonthlyFlow', () => {
  it('생산 − 소매 = 갭, 누적은 순차 합산', () => {
    const production = new Map([
      [202601, 300],
      [202602, 400],
    ]);
    const retailMap = new Map([
      [202601, 250],
      [202602, 300],
    ]);
    const out = buildMonthlyFlow(production, retailMap);
    expect(out).toHaveLength(2);
    expect(out[0].gap).toBe(50);
    expect(out[0].cumGap).toBe(50);
    expect(out[1].gap).toBe(100);
    expect(out[1].cumGap).toBe(150);
    expect(out[0].label).toBe('26.01');
  });

  it('소매가 없는 월은 버린다 — 0으로 채우면 생산량이 통째로 가짜 갭이 된다', () => {
    // 실제 상황: 202606은 생산에 멕시코만, 소매에 캐나다만 빠져 그대로 빼면 허구가 나온다.
    const production = new Map([
      [202605, 300],
      [202606, 64806],
    ]);
    const retailMap = new Map([[202605, 250]]);
    const out = buildMonthlyFlow(production, retailMap);
    expect(out.map((p) => p.yearMonth)).toEqual([202605]);
  });

  it('생산이 없는 월도 버린다 (교집합만)', () => {
    const production = new Map([[202605, 300]]);
    const retailMap = new Map([
      [202605, 250],
      [202606, 280],
    ]);
    expect(buildMonthlyFlow(production, retailMap).map((p) => p.yearMonth)).toEqual([202605]);
  });

  it('입력 순서가 뒤죽박죽이어도 월 순으로 누적한다 (연 경계 포함)', () => {
    const production = new Map([
      [202602, 300],
      [202512, 100],
      [202601, 200],
    ]);
    const retailMap = new Map([
      [202601, 100],
      [202602, 100],
      [202512, 100],
    ]);
    const out = buildMonthlyFlow(production, retailMap);
    expect(out.map((p) => p.yearMonth)).toEqual([202512, 202601, 202602]);
    expect(out.map((p) => p.cumGap)).toEqual([0, 100, 300]);
  });
});

describe('buildGapPoints', () => {
  it('출하 − 소매 = 갭, 누적은 순차 합산', () => {
    const shipments = [ship('2025-Q1', 300), ship('2025-Q2', 400, true)];
    const retailMap = new Map([
      ['2025-Q1', 250],
      ['2025-Q2', 300],
    ]);
    const out = buildGapPoints(shipments, retailMap);
    expect(out).toHaveLength(2);
    expect(out[0].gap).toBe(50);
    expect(out[0].cumGap).toBe(50);
    expect(out[1].gap).toBe(100);
    expect(out[1].cumGap).toBe(150);
    expect(out[1].isDerived).toBe(true);
  });

  it('소매가 없는 분기는 버린다 — 0으로 채우면 가짜 갭이 생긴다', () => {
    const shipments = [ship('2025-Q1', 300), ship('2026-Q2', 445)];
    const retailMap = new Map([['2025-Q1', 250]]);
    const out = buildGapPoints(shipments, retailMap);
    expect(out.map((p) => p.yearPeriod)).toEqual(['2025-Q1']);
  });

  it('출하가 없는 분기도 버린다 (교집합만)', () => {
    const retailMap = new Map([
      ['2025-Q1', 250],
      ['2025-Q2', 300],
    ]);
    const out = buildGapPoints([ship('2025-Q1', 300)], retailMap);
    expect(out).toHaveLength(1);
  });

  it('입력 순서가 뒤죽박죽이어도 분기 순으로 누적한다', () => {
    const shipments = [ship('2025-Q2', 400), ship('2025-Q1', 300)];
    const retailMap = new Map([
      ['2025-Q1', 250],
      ['2025-Q2', 300],
    ]);
    const out = buildGapPoints(shipments, retailMap);
    expect(out.map((p) => p.yearPeriod)).toEqual(['2025-Q1', '2025-Q2']);
    expect(out[1].cumGap).toBe(150);
  });
});

describe('monthsOfQuarter', () => {
  it('분기 → 3개월 (연 경계 안)', () => {
    expect(monthsOfQuarter('2026-Q1')).toEqual([202601, 202602, 202603]);
    expect(monthsOfQuarter('2026-Q2')).toEqual([202604, 202605, 202606]);
    expect(monthsOfQuarter('2026-Q4')).toEqual([202610, 202611, 202612]);
  });
});

describe('estimateCountryMonth — 최근 YoY를 전년 동월에 적용', () => {
  it('전년 동월 × (기준월/기준월 전년)', () => {
    // 202506=110, 202505=100, 202605=120 → 202606 추정 = 110 × (120/100) = 132
    const byMonth = new Map([
      [202505, 100],
      [202506, 110],
      [202605, 120],
    ]);
    expect(estimateCountryMonth(byMonth, 202606, 202605)).toBe(132);
  });

  it('YoY가 1이면 전년 동월 그대로', () => {
    const byMonth = new Map([
      [202505, 100],
      [202506, 90],
      [202605, 100],
    ]);
    expect(estimateCountryMonth(byMonth, 202606, 202605)).toBe(90);
  });

  it('전년 동월치가 없으면 null — 근거 없는 수를 만들지 않는다', () => {
    const byMonth = new Map([
      [202505, 100],
      [202605, 120],
    ]); // 202506(전년 동월) 없음
    expect(estimateCountryMonth(byMonth, 202606, 202605)).toBeNull();
  });

  it('기준월 전년치가 0이면 null (0 나누기 방지)', () => {
    const byMonth = new Map([
      [202505, 0],
      [202506, 110],
      [202605, 120],
    ]);
    expect(estimateCountryMonth(byMonth, 202606, 202605)).toBeNull();
  });
});

describe('buildProjectedGapQuarter — 소매 일부 추정으로 최신 분기 채우기', () => {
  /** 캐나다만 6월이 빠진 26Q2 소매 + 추정에 필요한 전년치. */
  function retailRowsCanadaJuneMissing(): RetailMonthRow[] {
    const rows: RetailMonthRow[] = [];
    // 전년(2025) 4~6월 — 추정 근거
    for (const m of [202504, 202505, 202506]) {
      rows.push(retail('USA', m, 1000));
      rows.push(retail('Mexico', m, 50));
      rows.push(retail('Canada', m, 100));
    }
    // 당해(2026) Q2: USA·Mexico는 6월까지, Canada는 5월까지(6월 결측)
    for (const m of [202604, 202605, 202606]) {
      rows.push(retail('USA', m, 1000));
      rows.push(retail('Mexico', m, 50));
    }
    rows.push(retail('Canada', 202604, 100));
    rows.push(retail('Canada', 202605, 100));
    // Canada 202606 없음 → 추정 대상
    return rows;
  }

  it('출하가 있고 소매가 한 국가만 덜 오면 그 국가·월을 추정해 26Q2를 만든다', () => {
    const rows = retailRowsCanadaJuneMissing();
    const shipments = [ship('2026-Q2', 4000)];
    const result = buildProjectedGapQuarter([], shipments, rows, '2026-Q1');
    expect(result).not.toBeNull();
    const { point, note } = result!;
    expect(point.yearPeriod).toBe('2026-Q2');
    expect(point.isEstimated).toBe(true);
    // Canada YoY = 100/100 = 1 → Canada 202606 추정 = 전년 202506(100) × 1 = 100
    // 소매 = USA(3000) + Mexico(150) + Canada(100+100 실측 + 100 추정) = 3450
    expect(point.retail).toBe(3450);
    expect(point.shipments).toBe(4000);
    expect(point.gap).toBe(550);
    expect(note).toContain('Canada');
    expect(note).toContain('26.06');
  });

  it('cumGap은 실측 마지막 분기 누적에서 이어진다', () => {
    const rows = retailRowsCanadaJuneMissing();
    const shipments = [ship('2026-Q2', 4000)];
    const priorGap: GapPoint[] = [
      {
        yearPeriod: '2026-Q1',
        label: '26Q1',
        shipments: 0,
        retail: 0,
        gap: 0,
        cumGap: 1000,
        isDerived: false,
      },
    ];
    const { point } = buildProjectedGapQuarter(priorGap, shipments, rows, '2026-Q1')!;
    expect(point.cumGap).toBe(1000 + 550);
  });

  it('그 분기 출하가 없으면 null — 갭이 성립하지 않는다', () => {
    const rows = retailRowsCanadaJuneMissing();
    expect(buildProjectedGapQuarter([], [], rows, '2026-Q1')).toBeNull();
  });

  it('진행 분기가 이미 완전(완전 분기 == 진행 분기)이면 null', () => {
    // 3개국 모두 6월까지 → 진행 분기 26Q2, completeQuarter도 26Q2 → 투영 안 함
    const rows: RetailMonthRow[] = [];
    for (const m of [202604, 202605, 202606]) {
      rows.push(retail('USA', m, 1000));
      rows.push(retail('Mexico', m, 50));
      rows.push(retail('Canada', m, 100));
    }
    const shipments = [ship('2026-Q2', 4000)];
    expect(buildProjectedGapQuarter([], shipments, rows, '2026-Q2')).toBeNull();
  });

  it('추정 근거(전년치)가 없으면 null — 허구 대신 투영 포기', () => {
    // 전년 데이터 없이 당해만 → Canada 6월 추정 불가
    const rows: RetailMonthRow[] = [];
    for (const m of [202604, 202605, 202606]) {
      rows.push(retail('USA', m, 1000));
      rows.push(retail('Mexico', m, 50));
    }
    rows.push(retail('Canada', 202604, 100));
    rows.push(retail('Canada', 202605, 100));
    const shipments = [ship('2026-Q2', 4000)];
    expect(buildProjectedGapQuarter([], shipments, rows, '2026-Q1')).toBeNull();
  });

  it('추정할 결측이 없으면 null — 정상 경로가 처리한다', () => {
    // completeQuarter는 26Q1인데 3개국 모두 26Q2 완비 → 결측 없음 → null
    const rows: RetailMonthRow[] = [];
    for (const m of [202504, 202505, 202506, 202604, 202605, 202606]) {
      rows.push(retail('USA', m, 1000));
      rows.push(retail('Mexico', m, 50));
      rows.push(retail('Canada', m, 100));
    }
    const shipments = [ship('2026-Q2', 4000)];
    expect(buildProjectedGapQuarter([], shipments, rows, '2026-Q1')).toBeNull();
  });

  it('마세라티는 추정·합산에서 제외한다', () => {
    const rows = retailRowsCanadaJuneMissing();
    // 마세라티 소매를 잔뜩 끼워도 결과가 바뀌면 안 된다
    rows.push(retail('USA', 202606, 99999, 'Grecale'));
    rows.push(retail('Canada', 202606, 99999, 'Ghibli'));
    const shipments = [ship('2026-Q2', 4000)];
    const { point } = buildProjectedGapQuarter([], shipments, rows, '2026-Q1')!;
    expect(point.retail).toBe(3450); // 마세라티 무시
  });
});

describe('toYoySeries / toYoyByIndex / pearson', () => {
  it('전년 동월 대비 증감률', () => {
    const series = new Map([
      [202501, 100],
      [202601, 120],
    ]);
    expect(toYoySeries(series).get(202601)).toBeCloseTo(20);
  });

  it('전년 값이 없으면 제외', () => {
    expect(toYoySeries(new Map([[202601, 120]])).size).toBe(0);
  });

  it('전년 값이 0이면 제외 (0 나누기 방지)', () => {
    const series = new Map([
      [202501, 0],
      [202601, 120],
    ]);
    expect(toYoySeries(series).size).toBe(0);
  });

  it('연말→연초 경계를 넘어 계산한다', () => {
    const series = new Map([
      [202512, 100],
      [202612, 150],
    ]);
    expect(toYoySeries(series).get(202612)).toBeCloseTo(50);
  });

  it('toYoyByIndex — 월별 축은 12기간 전과 비교한다', () => {
    const series = new Map([
      [0, 100],
      [11, 999], // 11기간 전 — 비교 대상이 아니다
      [12, 130],
    ]);
    const out = toYoyByIndex(series, 12);
    expect(out.get(12)).toBeCloseTo(30);
    expect(out.has(11)).toBe(false);
  });

  it('toYoyByIndex — 분기 축은 4기간 전과 비교한다 (같은 함수, 다른 주기)', () => {
    const series = new Map([
      [0, 100],
      [4, 80],
    ]);
    expect(toYoyByIndex(series, 4).get(4)).toBeCloseTo(-20);
  });

  it('toYoyByIndex — 직전 값이 0이면 제외 (0 나누기 방지)', () => {
    const series = new Map([
      [0, 0],
      [4, 80],
    ]);
    expect(toYoyByIndex(series, 4).size).toBe(0);
  });

  it('완전 상관 = 1', () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
  });

  it('완전 역상관 = -1', () => {
    expect(pearson([1, 2, 3], [6, 4, 2])).toBeCloseTo(-1);
  });

  it('분산 0이면 null', () => {
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
  });

  it('표본 부족이면 null', () => {
    expect(pearson([1], [2])).toBeNull();
  });
});

describe('wilsonInterval — 작은 표본에서도 무너지지 않아야 한다', () => {
  const width = (s: number, n: number) => {
    const { low, high } = wilsonInterval(s, n);
    return high - low;
  };

  it('같은 비율이라도 표본이 작을수록 구간이 넓다', () => {
    expect(width(5, 10)).toBeGreaterThan(width(50, 100));
    expect(width(50, 100)).toBeGreaterThan(width(500, 1000));
  });

  it('0/n에서도 구간이 [0,1] 안이고 폭이 0이 아니다 — 정규근사라면 폭 0인 거짓 확신이 나온다', () => {
    const { low, high } = wilsonInterval(0, 10);
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThanOrEqual(1);
    expect(high - low).toBeGreaterThan(0);
    expect(high).toBeLessThan(1); // 0/10을 보고도 "절대 아니다"라고 말하지 않는다
  });

  it('n/n에서도 구간이 [0,1] 안이고 폭이 0이 아니다', () => {
    const { low, high } = wilsonInterval(10, 10);
    expect(low).toBeGreaterThan(0); // 10/10을 보고도 "무조건이다"라고 말하지 않는다
    expect(high).toBeLessThanOrEqual(1);
    expect(high - low).toBeGreaterThan(0);
  });

  it('표본이 크면 점추정으로 수렴한다', () => {
    const { low, high } = wilsonInterval(600, 1000);
    expect(low).toBeCloseTo(0.6, 1);
    expect(high).toBeCloseTo(0.6, 1);
    expect(low).toBeLessThan(0.6);
    expect(high).toBeGreaterThan(0.6);
  });

  it('표본이 0이면 완전 무지 — [0,1]', () => {
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 });
  });
});

describe('detectLag', () => {
  /** 24개월치 시리즈 생성 (YoY가 나오려면 12개월 이상 필요). */
  function series(start: number, count: number, fn: (i: number) => number): Map<number, number> {
    const out = new Map<number, number>();
    for (let i = 0; i < count; i += 1) {
      const year = Math.floor(start / 100) + Math.floor(((start % 100) - 1 + i) / 12);
      const month = (((start % 100) - 1 + i) % 12) + 1;
      out.set(year * 100 + month, fn(i));
    }
    return out;
  }

  it('자사 매출이 2개월 선행하면 lag=+2를 찾아낸다', () => {
    // 소매[t] = 매출[t-2] 관계를 심는다 → 매출[t] ↔ 소매[t+2]
    const wave = (i: number) => 100 + 30 * Math.sin(i / 2);
    const revenue = series(202401, 36, wave);
    const retailData = series(202401, 36, (i) => wave(i - 2));
    const result = detectLag(revenue, retailData, 6);
    expect(result).not.toBeNull();
    expect(result!.lagMonths).toBe(2);
    expect(Math.abs(result!.r)).toBeGreaterThan(0.9);
  });

  it('동행이면 lag=0', () => {
    const wave = (i: number) => 100 + 30 * Math.sin(i / 2);
    const revenue = series(202401, 36, wave);
    const retailData = series(202401, 36, wave);
    const result = detectLag(revenue, retailData, 6);
    expect(result!.lagMonths).toBe(0);
  });

  it('후보 전체를 반환한다 — 화면에서 근거를 보여줘야 하므로', () => {
    const wave = (i: number) => 100 + 30 * Math.sin(i / 2);
    const result = detectLag(series(202401, 36, wave), series(202401, 36, wave), 3);
    expect(result!.candidates.length).toBeGreaterThan(1);
    expect(result!.candidates.every((c) => c.n >= 12)).toBe(true);
  });

  it('표본이 부족하면 null', () => {
    const revenue = new Map([
      [202501, 100],
      [202601, 110],
    ]);
    expect(detectLag(revenue, revenue, 6)).toBeNull();
  });
});

describe('detectLagQuarterly — 분기 축이라 시차가 3의 배수로만 나온다', () => {
  function quarterSeries(count: number, fn: (i: number) => number): Map<string, number> {
    const start = quarterIndex('2020-Q1');
    const out = new Map<string, number>();
    for (let i = 0; i < count; i += 1) out.set(quarterFromIndex(start + i), fn(i));
    return out;
  }

  const wave = (i: number) => 100 + 30 * Math.sin(i / 2);

  it('자사 매출이 1분기 선행하면 lagMonths=+3 — 분기 축은 개월을 쪼개 못 본다', () => {
    // 출하[t] = 매출[t-1분기] 관계를 심는다 → 매출[t] ↔ 출하[t+1분기]
    const revenue = quarterSeries(20, wave);
    const shipmentsQ = quarterSeries(20, (i) => wave(i - 1));
    const result = detectLagQuarterly(revenue, shipmentsQ, 2, 6);
    expect(result).not.toBeNull();
    expect(result!.lagMonths).toBe(3);
    expect(Math.abs(result!.r)).toBeGreaterThan(0.9);
  });

  it('동행이면 lagMonths=0', () => {
    const revenue = quarterSeries(20, wave);
    expect(detectLagQuarterly(revenue, quarterSeries(20, wave), 2, 6)!.lagMonths).toBe(0);
  });

  it('후보 시차는 전부 3의 배수 — 분기 데이터에서 1·2개월 시차를 주장할 근거가 없다', () => {
    const revenue = quarterSeries(20, wave);
    const result = detectLagQuarterly(revenue, quarterSeries(20, wave), 2, 6);
    expect(result!.candidates.length).toBeGreaterThan(1);
    expect(result!.candidates.every((c) => c.lagMonths % 3 === 0)).toBe(true);
    expect(result!.candidates.map((c) => c.lagMonths).sort((a, b) => a - b)).toEqual([
      -6, -3, 0, 3, 6,
    ]);
  });

  it('겹치는 분기가 최소 표본에 못 미치면 null', () => {
    const revenue = quarterSeries(20, wave);
    expect(detectLagQuarterly(revenue, quarterSeries(20, wave), 2, 99)).toBeNull();
  });

  it('빈 입력은 null', () => {
    expect(detectLagQuarterly(new Map(), new Map(), 2, 6)).toBeNull();
  });
});

describe('revenueByQuarter', () => {
  it('월별 매출을 분기로 합산', () => {
    const out = revenueByQuarter([
      { year_month: 202601, revenueEok: 10 },
      { year_month: 202602, revenueEok: 20 },
      { year_month: 202604, revenueEok: 5 },
    ]);
    expect(out.get('2026-Q1')).toBe(30);
    expect(out.get('2026-Q2')).toBe(5);
  });
});

describe('analyzeDrivers — 3축 시차 상관', () => {
  const wave = (i: number) => 100 + 30 * Math.sin(i / 2);

  /** 결정적 의사난수 — 재실행마다 같아야 테스트가 흔들리지 않는다. */
  function pseudoRandom(i: number): number {
    const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  function monthSeries(
    start: number,
    count: number,
    fn: (i: number) => number
  ): Map<number, number> {
    const out = new Map<number, number>();
    for (let i = 0; i < count; i += 1) out.set(addMonths(start, i), fn(i));
    return out;
  }

  const revenueRows: RevenueMonthRow[] = [...monthSeries(202401, 36, wave)].map(
    ([year_month, revenueEok]) => ({ year_month, revenueEok })
  );
  // 생산은 매출과 완전 동행, 소매는 무관한 잡음 → leader는 생산이어야 한다.
  const productionByMonth = monthSeries(202401, 36, wave);
  const retailByMonth = monthSeries(202401, 36, (i) => 100 + 40 * pseudoRandom(i));
  const shipments = [
    ship('2024-Q1', 300),
    ship('2024-Q2', 320),
    ship('2024-Q3', 310),
    ship('2024-Q4', 330),
    ship('2025-Q1', 340),
    ship('2025-Q2', 350),
    ship('2025-Q3', 345),
    ship('2025-Q4', 360),
  ];

  it('생산·소매·출하 3축 프로파일을 모두 반환한다', () => {
    const out = analyzeDrivers(revenueRows, productionByMonth, retailByMonth, shipments);
    expect(out.profiles.map((p) => p.axis)).toEqual(['production', 'retail', 'shipments']);
    expect(out.profiles.every((p) => p.axisLabel.length > 0)).toBe(true);
  });

  it('출하 축은 분기 주기로 표시된다 — 시차 해상도가 다르다는 사실을 화면이 알아야 한다', () => {
    const out = analyzeDrivers(revenueRows, productionByMonth, retailByMonth, shipments);
    const byAxis = new Map(out.profiles.map((p) => [p.axis, p.granularity]));
    expect(byAxis.get('production')).toBe('month');
    expect(byAxis.get('retail')).toBe('month');
    expect(byAxis.get('shipments')).toBe('quarter');
  });

  it('leader는 |r|이 가장 큰 축 — 동행하는 생산을 잡음 소매보다 앞세운다', () => {
    const out = analyzeDrivers(revenueRows, productionByMonth, retailByMonth, shipments);
    expect(out.leader).not.toBeNull();
    expect(out.leader!.axis).toBe('production');
    const others = out.profiles.filter((p) => p.lag !== null && p.axis !== out.leader!.axis);
    for (const p of others) {
      expect(Math.abs(out.leader!.lag!.r)).toBeGreaterThanOrEqual(Math.abs(p.lag!.r));
    }
  });

  it('계산된 축은 이유를 비워 두고, 표본 부족 축은 이유를 채운다 — 조용히 빠지면 안 된다', () => {
    const out = analyzeDrivers(revenueRows, productionByMonth, retailByMonth, []);
    const shipProfile = out.profiles.find((p) => p.axis === 'shipments')!;
    expect(shipProfile.lag).toBeNull();
    expect(shipProfile.unavailableReason).toContain('분기');

    const prodProfile = out.profiles.find((p) => p.axis === 'production')!;
    expect(prodProfile.lag).not.toBeNull();
    expect(prodProfile.unavailableReason).toBeNull();
  });

  it('아무 축도 표본을 못 채우면 leader는 null이고 모든 축에 이유가 남는다', () => {
    const out = analyzeDrivers([], new Map(), new Map(), []);
    expect(out.leader).toBeNull();
    expect(out.profiles).toHaveLength(3);
    expect(out.profiles.every((p) => p.lag === null && p.unavailableReason !== null)).toBe(true);
  });

  it('caveats는 절대 비지 않는다 — 다중비교·자기상관을 안 밝히면 r을 오독한다', () => {
    const out = analyzeDrivers(revenueRows, productionByMonth, retailByMonth, shipments);
    expect(out.caveats.length).toBeGreaterThan(0);
    expect(out.caveats.every((c) => c.length > 10)).toBe(true);
  });
});

describe('buildInventoryOutlook — 재고 국면 → 매출 방향 조건부 빈도', () => {
  type OutlookParams = Parameters<typeof buildInventoryOutlook>[0];

  /**
   * 24기간 인위적 매출. 4기간 전 대비로 보면 인덱스 4~13은 감소, 14~23은 증가한다.
   * (windowPeriods=2 · horizonPeriods=2 조합에서 축적 구간 결과가 전부 '감소'가 되도록 짰다.)
   */
  const revenueByIndex = new Map(
    [
      100, 100, 100, 100, 90, 90, 90, 90, 80, 80, 80, 80, 70, 70, 90, 90, 100, 100, 100, 100, 110,
      110, 110, 110,
    ].map((v, i) => [i, v])
  );

  /** 앞 flipIndex개는 축적(+100), 나머지는 소진(−100). */
  function gapFlippingAt(flipIndex: number, length = 24): Map<number, number> {
    const out = new Map<number, number>();
    for (let i = 0; i < length; i += 1) out.set(i, i < flipIndex ? 100 : -100);
    return out;
  }

  function outlook(overrides: Partial<OutlookParams> = {}) {
    return buildInventoryOutlook({
      key: 'quarterly',
      label: '테스트 축',
      gapByIndex: gapFlippingAt(12),
      revenueByIndex,
      periodsPerYear: 4,
      windowPeriods: 2,
      horizonPeriods: 2,
      conditionLabel: '직전 2기간 누적 갭 > 0',
      outcomeLabel: '2기간 뒤 매출 감소',
      ...overrides,
    });
  }

  it('축적 국면 뒤 매출이 항상 감소하면 building.rate = 1', () => {
    const out = outlook();
    expect(out.building.declines).toBe(10);
    expect(out.building.total).toBe(10);
    expect(out.building.rate).toBe(1);
  });

  it('소진 국면 뒤 매출이 항상 증가하면 draining.rate = 0', () => {
    const out = outlook();
    expect(out.draining.declines).toBe(0);
    expect(out.draining.total).toBe(10);
    expect(out.draining.rate).toBe(0);
  });

  it('base는 조건과 무관한 전체 비율 — 두 국면의 분자·분모를 그대로 합친 값이다', () => {
    const out = outlook();
    expect(out.base.total).toBe(out.building.total + out.draining.total);
    expect(out.base.declines).toBe(out.building.declines + out.draining.declines);
    expect(out.base.rate).toBeCloseTo(0.5);
  });

  it('base가 있어야 조건부 비율을 읽을 수 있다 — 100% vs 기저 50%는 진짜 신호다', () => {
    const out = outlook();
    expect(out.building.rate).toBeGreaterThan(out.base.rate);
    expect(out.draining.rate).toBeLessThan(out.base.rate);
  });

  it('비율에는 Wilson 구간이 함께 붙는다 — 비율만 내놓으면 사실처럼 읽힌다', () => {
    const out = outlook();
    expect(out.building.ciLow).toBeGreaterThan(0);
    expect(out.building.ciLow).toBeLessThan(1);
    expect(out.building.ciHigh).toBeLessThanOrEqual(1);
  });

  it('현재 국면은 마지막 시점의 창 누적 부호 — 소진으로 끝나면 draining', () => {
    const out = outlook();
    expect(out.currentState).toBe('draining');
  });

  it('현재 국면이 이어진 기간을 거슬러 센다', () => {
    // 인덱스 12부터 갭이 음수 → 창 누적(t-1,t)이 소진으로 굳는 건 t=12부터. t=23까지 12기간.
    expect(outlook().currentStreak).toBe(12);
  });

  it('갭이 계속 양수면 currentState는 building', () => {
    const out = outlook({ gapByIndex: gapFlippingAt(24) });
    expect(out.currentState).toBe('building');
    expect(out.currentStreak).toBeGreaterThan(0);
  });

  it(`표본이 ${MIN_CONDITIONAL_SAMPLES}개 미만인 국면이 하나라도 있으면 hasEnoughSamples=false`, () => {
    // flipIndex−2 = 축적 표본 수. 10 → 8개(경계 통과), 9 → 7개(경계 미달).
    expect(outlook({ gapByIndex: gapFlippingAt(10) }).building.total).toBe(MIN_CONDITIONAL_SAMPLES);
    expect(outlook({ gapByIndex: gapFlippingAt(10) }).hasEnoughSamples).toBe(true);

    expect(outlook({ gapByIndex: gapFlippingAt(9) }).building.total).toBe(
      MIN_CONDITIONAL_SAMPLES - 1
    );
    expect(outlook({ gapByIndex: gapFlippingAt(9) }).hasEnoughSamples).toBe(false);
  });

  it('한 국면만 관측되면 hasEnoughSamples=false — 비교 대상이 없으면 비율은 정보가 아니다', () => {
    const out = outlook({ gapByIndex: gapFlippingAt(24) });
    expect(out.draining.total).toBe(0);
    expect(out.hasEnoughSamples).toBe(false);
  });

  it('창에 구멍이 있는 시점은 버린다 — 부분합으로 메우면 국면 부호가 뒤집힐 수 있다', () => {
    const holed = gapFlippingAt(12);
    holed.delete(5);
    // t=5는 갭 자체가 없고, t=6은 창(4,5)이 불완전 → 둘 다 표본에서 빠져 10 → 8.
    expect(outlook({ gapByIndex: holed }).building.total).toBe(8);
  });

  it('결과 시점 매출 YoY가 없는 시점은 버린다 — 갭만 있고 결과가 없으면 셀 수 없다', () => {
    const out = outlook({ revenueByIndex: new Map() });
    expect(out.base.total).toBe(0);
    expect(out.base.rate).toBe(0);
    expect(out.hasEnoughSamples).toBe(false);
  });

  it('입력 라벨·키를 그대로 실어 나른다 — 화면이 조건 정의를 함께 보여줘야 한다', () => {
    const out = outlook({ key: 'monthly', label: '월별 축' });
    expect(out.key).toBe('monthly');
    expect(out.label).toBe('월별 축');
    expect(out.conditionLabel).toBe('직전 2기간 누적 갭 > 0');
    expect(out.outcomeLabel).toBe('2기간 뒤 매출 감소');
  });
});

describe('buildInventoryOutlooks', () => {
  const revenue: RevenueMonthRow[] = [];
  for (let i = 0; i < 36; i += 1) {
    revenue.push({ year_month: addMonths(202401, i), revenueEok: 100 + i });
  }

  it('월별·분기별 2개 축을 만든다', () => {
    const out = buildInventoryOutlooks([], [], revenue);
    expect(out.map((o) => o.key)).toEqual(['monthly', 'quarterly']);
    expect(out.every((o) => o.label.length > 0)).toBe(true);
  });

  it('두 축이 각자의 소스를 본다 — 월별은 생산−소매, 분기별은 출하−소매', () => {
    // 월별 갭은 계속 양수(축적), 분기 갭은 계속 음수(소진) → 두 축의 현재 국면이 갈려야 한다.
    const monthlyFlow = flowWithGaps(
      Array.from({ length: 12 }, (_, i): [number, number] => [addMonths(202501, i), 100])
    );
    const gap: GapPoint[] = buildGapPoints(
      [ship('2025-Q1', 200), ship('2025-Q2', 200), ship('2025-Q3', 200), ship('2025-Q4', 200)],
      new Map([
        ['2025-Q1', 300],
        ['2025-Q2', 300],
        ['2025-Q3', 300],
        ['2025-Q4', 300],
      ])
    );
    const out = buildInventoryOutlooks(monthlyFlow, gap, revenue);
    expect(out[0].currentState).toBe('building');
    expect(out[1].currentState).toBe('draining');
  });

  it('조건·결과 문장에 창과 지평을 밝힌다 — 6개월/2분기가 어디서 왔는지 보여야 한다', () => {
    const out = buildInventoryOutlooks([], [], revenue);
    expect(out[0].conditionLabel).toContain('6개월');
    expect(out[0].outcomeLabel).toContain('6개월');
    expect(out[1].conditionLabel).toContain('2분기');
    expect(out[1].outcomeLabel).toContain('2분기');
  });
});

describe('describeCox — 이상치 제외의 의미', () => {
  const rows = (extra: CoxInventoryRow[] = []): CoxInventoryRow[] => [
    { brand: 'NATION', year_month: 202605, days_supply: 76 },
    { brand: 'Jeep', year_month: 202605, days_supply: 145 },
    ...extra,
  ];

  it('업계 평균과 브랜드 재고일수를 함께 서술', () => {
    const out = describeCox(rows());
    expect(out).toContain('Jeep 145일');
    expect(out).toContain('업계 평균 76일');
  });

  it('days_supply가 null이면 "N일 초과(Cox 미공개)"로 — 값 없음이 아니라 심각 신호다', () => {
    const out = describeCox(rows([{ brand: 'Chrysler', year_month: 202605, days_supply: null }]));
    expect(out).toContain('Chrysler 152일 초과(Cox 미공개)');
  });

  it('NATION이 없으면 배율을 못 구하므로 null', () => {
    expect(describeCox([{ brand: 'Jeep', year_month: 202605, days_supply: 145 }])).toBeNull();
  });

  it('빈 입력은 null', () => {
    expect(describeCox([])).toBeNull();
  });

  it('최신 월만 본다', () => {
    const out = describeCox([
      { brand: 'NATION', year_month: 202604, days_supply: 78 },
      { brand: 'Jeep', year_month: 202604, days_supply: 128 },
      ...rows(),
    ]);
    expect(out).toContain('Jeep 145일');
    expect(out).not.toContain('128일');
  });
});

describe('describeMonthlyFlow — 분기 출하 갭보다 최신인 교차검증 축', () => {
  it('최근 6개월 누적이 양수면 축적', () => {
    const flow = flowWithGaps(
      Array.from({ length: 6 }, (_, i): [number, number] => [addMonths(202601, i), 100])
    );
    expect(describeMonthlyFlow(flow)).toContain('축적');
  });

  it('최근 6개월 누적이 음수면 소진', () => {
    const flow = flowWithGaps(
      Array.from({ length: 6 }, (_, i): [number, number] => [addMonths(202601, i), -100])
    );
    expect(describeMonthlyFlow(flow)).toContain('소진');
  });

  it('최근 6개월만 본다 — 옛날에 크게 쌓였어도 지금 빠지고 있으면 소진이다', () => {
    const flow = flowWithGaps([
      ...Array.from({ length: 6 }, (_, i): [number, number] => [addMonths(202501, i), 99999]),
      ...Array.from({ length: 6 }, (_, i): [number, number] => [addMonths(202507, i), -100]),
    ]);
    const out = describeMonthlyFlow(flow);
    expect(out).toContain('소진');
    expect(out).toContain('25.07'); // 창의 시작이 옛 구간이 아니라 최근 6개월이다
    expect(out).toContain('25.12');
  });

  it('빈 입력은 null', () => {
    expect(describeMonthlyFlow([])).toBeNull();
  });
});

describe('diagnose', () => {
  /** 5개 분기 = 전년 동기 비교가 가능한 최소 길이. */
  function gapSeries(spec: { ship: number; retail: number }[]): GapPoint[] {
    const shipments = spec.map((s, i) =>
      ship(`202${5 + Math.floor(i / 4)}-Q${(i % 4) + 1}`, s.ship)
    );
    const retailMap = new Map(shipments.map((s, i) => [s.year_period, spec[i].retail]));
    return buildGapPoints(shipments, retailMap);
  }

  it('출하가 소매를 앞지르고 재고가 쌓이면 빨강', () => {
    const gap = gapSeries([
      { ship: 300, retail: 300 },
      { ship: 300, retail: 300 },
      { ship: 300, retail: 300 },
      { ship: 300, retail: 300 },
      { ship: 400, retail: 310 }, // 출하 +33% vs 소매 +3%, 갭 +90
    ]);
    const d = diagnose(gap, [], []);
    expect(d.level).toBe('red');
    expect(d.headline).toContain('감산 위험');
  });

  it('소매가 출하를 앞지르고 재고가 줄면 초록', () => {
    const gap = gapSeries([
      { ship: 400, retail: 300 },
      { ship: 300, retail: 400 },
      { ship: 300, retail: 400 },
      { ship: 300, retail: 400 },
      { ship: 300, retail: 450 },
    ]);
    const d = diagnose(gap, [], []);
    expect(d.level).toBe('green');
  });

  it('방향이 엇갈리면 노랑 — 출하가 소매를 앞지르지만 재고는 여전히 소진 중', () => {
    const gap = gapSeries([
      { ship: 300, retail: 400 }, // 전년 동기(비교 기준)
      { ship: 300, retail: 400 },
      { ship: 300, retail: 400 },
      { ship: 300, retail: 400 },
      // 출하 +33.3% vs 소매 +12.5% → 출하가 앞섬. 하지만 최근 4분기 갭 합 -350 → 재고는 소진 중.
      { ship: 400, retail: 450 },
    ]);
    expect(diagnose(gap, [], []).level).toBe('yellow');
  });

  it('데이터가 없으면 노랑 + 사유 명시', () => {
    const d = diagnose([], [], []);
    expect(d.level).toBe('yellow');
    expect(d.reasons[0]).toContain('없습니다');
  });

  it('근거에 실제 수치를 담는다 — 사람이 검증할 수 있어야 한다', () => {
    const gap = gapSeries([
      { ship: 300, retail: 300 },
      { ship: 300, retail: 300 },
      { ship: 300, retail: 300 },
      { ship: 300, retail: 300 },
      { ship: 400, retail: 310 },
    ]);
    const d = diagnose(gap, [], []);
    expect(d.reasons.join(' ')).toMatch(/400/);
    expect(d.reasons.join(' ')).toMatch(/310/);
  });

  it('Cox 실측이 있으면 근거에 포함', () => {
    const gap = gapSeries([{ ship: 300, retail: 250 }]);
    const cox: CoxInventoryRow[] = [
      { brand: 'NATION', year_month: 202605, days_supply: 76 },
      { brand: 'Jeep', year_month: 202605, days_supply: 145 },
    ];
    expect(diagnose(gap, [], cox).reasons.join(' ')).toContain('Cox');
  });

  it('월별 생산 갭이 있으면 근거에 포함 — 분기 출하 갭보다 최신인 독립 교차검증이다', () => {
    const gap = gapSeries([{ ship: 300, retail: 250 }]);
    const flow = flowWithGaps(
      Array.from({ length: 6 }, (_, i): [number, number] => [addMonths(202601, i), 100])
    );
    expect(diagnose(gap, flow, []).reasons.join(' ')).toContain('월별 교차검증');
  });
});

describe('attachEventContext — 이벤트가 원인인가 결과인가', () => {
  function plantEvent(startYearMonth: number, plant = 'Toledo'): PlantEvent {
    return {
      plant,
      country: 'USA',
      startYearMonth,
      endYearMonth: startYearMonth,
      eventType: 'downtime',
      models: ['Gladiator'],
      summary: '테스트 이벤트',
      statedReason: '설비 전환',
      inventoryRelation: 'response_to_glut',
      sourceUrl: 'https://example.com/a',
      sourceName: 'Example',
      sourceDate: null,
    };
  }

  /** 202501~202507 갭. 시작월(202507)만 극단값 — 창에 새면 부호가 뒤집힌다. */
  const flowThroughJuly = flowWithGaps([
    [202501, 100],
    [202502, 100],
    [202503, 100],
    [202504, 100],
    [202505, 100],
    [202506, 100],
    [202507, -99999],
  ]);

  it('시작월 직전 6개월만 합한다 — 시작월 자체가 새면 이벤트가 만든 감산으로 자길 설명하는 순환 논리다', () => {
    const [ctx] = attachEventContext([plantEvent(202507)], flowThroughJuly);
    expect(ctx.precedingCumGap).toBe(600); // 202501~202506 × +100. 202507의 −99999는 빠진다.
    expect(ctx.precedingState).toBe('building');
  });

  it('직전 6개월 창은 연 경계를 넘는다', () => {
    const flow = flowWithGaps(
      Array.from({ length: 6 }, (_, i): [number, number] => [addMonths(202507, i), -50])
    );
    // 202601 직전 6개월 = 202507~202512
    const [ctx] = attachEventContext([plantEvent(202601)], flow);
    expect(ctx.precedingCumGap).toBe(-300);
    expect(ctx.precedingState).toBe('draining');
  });

  it('직전 6개월 중 하나라도 없으면 null + unknown — 부분합은 부호를 뒤집을 수 있다', () => {
    const flow = flowWithGaps([
      // 202501 없음
      [202502, 100],
      [202503, 100],
      [202504, 100],
      [202505, 100],
      [202506, 100],
    ]);
    const [ctx] = attachEventContext([plantEvent(202507)], flow);
    expect(ctx.precedingCumGap).toBeNull();
    expect(ctx.precedingState).toBe('unknown');
  });

  it('데이터 범위를 완전히 벗어난 이벤트도 unknown', () => {
    const [ctx] = attachEventContext([plantEvent(202001)], flowThroughJuly);
    expect(ctx.precedingCumGap).toBeNull();
    expect(ctx.precedingState).toBe('unknown');
  });

  it('최신순으로 정렬한다', () => {
    const out = attachEventContext(
      [
        plantEvent(202503, 'Windsor'),
        plantEvent(202507, 'Toledo'),
        plantEvent(202501, 'Belvidere'),
      ],
      flowThroughJuly
    );
    expect(out.map((c) => c.event.startYearMonth)).toEqual([202507, 202503, 202501]);
  });

  it('입력 배열을 제자리에서 뒤집지 않는다', () => {
    const events = [plantEvent(202503), plantEvent(202507)];
    attachEventContext(events, flowThroughJuly);
    expect(events.map((e) => e.startYearMonth)).toEqual([202503, 202507]);
  });

  it('발표된 사유는 그대로 두고 당시 갭 부호를 나란히 놓는다 — 판단은 보는 사람이 한다', () => {
    const [ctx] = attachEventContext([plantEvent(202507)], flowThroughJuly);
    expect(ctx.event.statedReason).toBe('설비 전환'); // 회사 주장은 손대지 않는다
    expect(ctx.precedingState).toBe('building'); // 실제 직전 재고는 축적이었다
  });

  it('빈 이벤트 목록은 빈 결과', () => {
    expect(attachEventContext([], flowThroughJuly)).toEqual([]);
  });
});
