import { describe, expect, it } from 'vitest';
import {
  addMonths,
  attachEventContext,
  buildCoxInventoryEvents,
  buildGapPoints,
  buildInventoryKpi,
  buildMonthlyFlow,
  buildNaProductionMonths,
  buildNaRetailMonths,
  buildNaRetailQuarters,
  buildProjectedGapQuarter,
  buildRetailKpi,
  buildRevenueKpi,
  buildShipmentsKpi,
  estimateCountryMonth,
  lastCompleteMonth,
  lastCompleteQuarter,
  monthFromIndex,
  monthIndex,
  monthLabel,
  monthsOfQuarter,
  quarterLabel,
  quarterOfYearMonth,
} from './aggregate';
import type {
  CoxInventoryRow,
  GapPoint,
  MonthlyFlowPoint,
  PlantEvent,
  ProductionMonthRow,
  RetailMonthRow,
  ShipmentRow,
} from './types';

function cox(
  brand: string,
  yearMonth: number,
  daysSupply: number | null,
  isOutlierExcluded = false
): CoxInventoryRow {
  return {
    brand,
    year_month: yearMonth,
    days_supply: daysSupply,
    is_outlier_excluded: isOutlierExcluded,
    source_url: 'https://www.coxautoinc.com/insights/example/',
  };
}

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

  it('minMonth 이전 월은 누적 전에 잘라 낸다 — cumGap이 시작월부터 새로 계산된다', () => {
    const production = new Map([
      [202011, 500], // 2020 — 잘려야 함
      [202012, 500], // 2020 — 잘려야 함
      [202101, 300],
      [202102, 400],
    ]);
    const retailMap = new Map([
      [202011, 100],
      [202012, 100],
      [202101, 250],
      [202102, 300],
    ]);
    const out = buildMonthlyFlow(production, retailMap, 202101);
    expect(out.map((p) => p.yearMonth)).toEqual([202101, 202102]);
    // 2020년 갭(각 +400)이 cumGap에 스며들지 않고 2021.01부터 새로 누적된다.
    expect(out[0].cumGap).toBe(50);
    expect(out[1].cumGap).toBe(150);
  });
});

describe('buildCoxInventoryEvents — Cox 재고일수 → 재고 이벤트 자동 생성', () => {
  it('월별로 스텔란티스 브랜드 + NATION을 요약한 inventory 이벤트를 만든다', () => {
    const rows = [
      cox('Jeep', 202605, 145),
      cox('Ram', 202605, 144),
      cox('Dodge', 202605, 148),
      cox('Chrysler', 202605, 129),
      cox('NATION', 202605, 76),
      cox('Toyota', 202605, 30), // 스텔란티스 밖 브랜드는 무시
    ];
    const out = buildCoxInventoryEvents(rows);
    expect(out).toHaveLength(1);
    expect(out[0].eventType).toBe('inventory');
    expect(out[0].startYearMonth).toBe(202605);
    expect(out[0].sourceName).toBe('Cox Automotive');
    expect(out[0].summary).toContain('Jeep 145일');
    expect(out[0].summary).toContain('업계 평균 76일');
    // 스텔란티스 4개 브랜드만 models에
    expect(out[0].models).toEqual(['Jeep', 'Ram', 'Dodge', 'Chrysler']);
  });

  it('excludeMonths에 든 달은 건너뛴다 (수동 항목 우선)', () => {
    const rows = [
      cox('Jeep', 202512, 130),
      cox('Ram', 202512, 115),
      cox('Jeep', 202601, 165),
      cox('Ram', 202601, 155),
    ];
    const out = buildCoxInventoryEvents(rows, new Set([202512]));
    expect(out.map((e) => e.startYearMonth)).toEqual([202601]);
  });

  it('outlier 제외 브랜드(days_supply null)는 수치 대신 제외 사실만 남긴다', () => {
    const rows = [
      cox('Jeep', 202603, 127),
      cox('Chrysler', 202603, null, true),
      cox('NATION', 202603, 79),
    ];
    const out = buildCoxInventoryEvents(rows);
    expect(out[0].summary).toContain('Jeep 127일');
    expect(out[0].summary).not.toContain('Chrysler 12'); // 수치 없음
    expect(out[0].summary).toContain('Cox 차트에서 제외');
    expect(out[0].models).toEqual(['Jeep', 'Chrysler']); // 존재는 하므로 models엔 포함
  });

  it('스텔란티스 브랜드가 하나도 없는 달은 이벤트를 만들지 않는다', () => {
    const out = buildCoxInventoryEvents([cox('NATION', 202605, 76), cox('Toyota', 202605, 30)]);
    expect(out).toHaveLength(0);
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

describe('buildRetailKpi — 소매 YTD YoY', () => {
  it('당해 1~최신월 누적을 전년 같은 기간과 비교', () => {
    // 2025 1~3월 = 300, 2026 1~3월(최신 202603) = 360 → +20%
    const m = new Map<number, number>([
      [202501, 100],
      [202502, 100],
      [202503, 100],
      [202601, 120],
      [202602, 120],
      [202603, 120],
    ]);
    const k = buildRetailKpi(m);
    expect(k.available).toBe(true);
    expect(k.currentValue).toBe(360);
    expect(k.priorValue).toBe(300);
    expect(k.absChange).toBe(60);
    expect(k.yoyPct).toBeCloseTo(20);
    expect(k.unit).toBe('units');
    expect(k.periodLabel).toContain('2026');
  });

  it('최신월이 6월이면 상반기 라벨', () => {
    const m = new Map<number, number>();
    for (let mo = 1; mo <= 6; mo += 1) {
      m.set(202500 + mo, 10);
      m.set(202600 + mo, 10);
    }
    expect(buildRetailKpi(m).periodLabel).toContain('상반기');
  });

  it('전년 같은 기간 데이터가 없으면 yoyPct는 null(당해 값은 유지)', () => {
    const k = buildRetailKpi(
      new Map<number, number>([
        [202601, 120],
        [202602, 120],
      ])
    );
    expect(k.yoyPct).toBeNull();
    expect(k.currentValue).toBe(240);
  });

  it('빈 맵은 available false', () => {
    expect(buildRetailKpi(new Map()).available).toBe(false);
  });
});

describe('buildShipmentsKpi — 출하 분기 YTD YoY', () => {
  it('당해 Q1~최신분기 누적을 전년 같은 분기와 비교', () => {
    // 2025 Q1+Q2 = 647, 2026 Q1+Q2 = 824 → +27.4%
    const k = buildShipmentsKpi([
      ship('2025-Q1', 325000),
      ship('2025-Q2', 322000, true),
      ship('2026-Q1', 379000),
      ship('2026-Q2', 445000),
    ]);
    expect(k.currentValue).toBe(824000);
    expect(k.priorValue).toBe(647000);
    expect(k.absChange).toBe(177000);
    expect(k.yoyPct).toBeCloseTo(27.4, 0);
    expect(k.periodLabel).toContain('상반기');
  });

  it('빈 배열은 available false', () => {
    expect(buildShipmentsKpi([]).available).toBe(false);
  });
});

describe('buildRevenueKpi — 매출 YTD YoY (억원)', () => {
  it('당해 1~최신월 누적을 전년과 비교, 단위 eok', () => {
    const k = buildRevenueKpi([
      { year_month: 202501, revenueEok: 10 },
      { year_month: 202502, revenueEok: 10 },
      { year_month: 202601, revenueEok: 15 },
      { year_month: 202602, revenueEok: 15 },
    ]);
    expect(k.unit).toBe('eok');
    expect(k.currentValue).toBe(30);
    expect(k.priorValue).toBe(20);
    expect(k.yoyPct).toBeCloseTo(50);
  });

  it('빈 배열은 available false', () => {
    expect(buildRevenueKpi([]).available).toBe(false);
  });
});

describe('buildInventoryKpi — 재고 신호등', () => {
  function gp(gap: number): GapPoint {
    return {
      yearPeriod: '2026-Q1',
      label: '26Q1',
      shipments: 0,
      retail: 0,
      gap,
      cumGap: gap,
      isDerived: false,
    };
  }

  it('최신 갭이 양수(재고 증가)면 빨강 + 연속 분기 수', () => {
    const k = buildInventoryKpi([gp(-50), gp(10), gp(20), gp(30)]);
    expect(k.status).toBe('red');
    expect(k.direction).toBe('building');
    expect(k.consecutiveQuarters).toBe(3);
    expect(k.headline).toContain('3분기 연속 재고 증가');
  });

  it('최신 갭이 음수(재고 감소)면 초록', () => {
    const k = buildInventoryKpi([gp(50), gp(-10), gp(-20)]);
    expect(k.status).toBe('green');
    expect(k.direction).toBe('draining');
    expect(k.consecutiveQuarters).toBe(2);
    expect(k.headline).toContain('감소');
  });

  it('최신 갭이 0이면 노랑(혼조)', () => {
    expect(buildInventoryKpi([gp(10), gp(0)]).status).toBe('yellow');
  });

  it('빈 계열은 노랑 + 데이터 부족', () => {
    const k = buildInventoryKpi([]);
    expect(k.status).toBe('yellow');
    expect(k.headline).toContain('데이터 부족');
  });
});
