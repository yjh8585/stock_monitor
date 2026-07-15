import { describe, expect, it } from 'vitest';
import {
  buildForecast,
  buildGapPoints,
  buildNaRetailMonths,
  buildNaRetailQuarters,
  buildRevenueVsRetail,
  buildUnitRevenue,
  describeCox,
  detectLag,
  diagnose,
  lastCompleteQuarter,
  monthLabel,
  pearson,
  quarterLabel,
  quarterOfYearMonth,
  revenueByQuarter,
  toYoySeries,
} from './aggregate';
import type { CoxInventoryRow, GapPoint, RetailMonthRow, ShipmentRow } from './types';

function retail(
  country: string,
  yearMonth: number,
  sales: number,
  model = 'Compass'
): RetailMonthRow {
  return { country, model, year_month: yearMonth, sales };
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

describe('toYoySeries / pearson', () => {
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

describe('buildUnitRevenue', () => {
  it('대당 원 = 매출(억원) × 1e8 / 출하(대)', () => {
    const revQ = new Map([['2025-Q1', 100]]); // 100억원
    const out = buildUnitRevenue(revQ, [ship('2025-Q1', 1000)], 0);
    expect(out.points[0].wonPerUnit).toBeCloseTo(10_000_000); // 100억원 / 1,000대 = 1천만원/대
  });

  it('시차를 분기로 반올림해 매출 분기를 당겨온다', () => {
    const revQ = new Map([['2024-Q4', 100]]);
    // lag=3개월(=1분기) → 출하 2025-Q1에 대응하는 매출은 2024-Q4
    const out = buildUnitRevenue(revQ, [ship('2025-Q1', 1000)], 3);
    expect(out.points).toHaveLength(1);
    expect(out.points[0].yearPeriod).toBe('2025-Q1');
    expect(out.points[0].wonPerUnit).toBeCloseTo(10_000_000);
  });

  it('대응 매출이 없는 출하 분기는 건너뛴다', () => {
    const out = buildUnitRevenue(new Map(), [ship('2025-Q1', 1000)], 0);
    expect(out.points).toHaveLength(0);
  });

  it('출하 0인 분기는 건너뛴다 (0 나누기 방지)', () => {
    const revQ = new Map([['2025-Q1', 100]]);
    expect(buildUnitRevenue(revQ, [ship('2025-Q1', 0)], 0).points).toHaveLength(0);
  });

  it('변동계수 — 값이 일정하면 0', () => {
    const revQ = new Map([
      ['2025-Q1', 100],
      ['2025-Q2', 200],
    ]);
    const out = buildUnitRevenue(revQ, [ship('2025-Q1', 1000), ship('2025-Q2', 2000)], 0);
    expect(out.cv).toBeCloseTo(0);
  });

  it('변동계수 — 값이 흔들리면 > 0', () => {
    const revQ = new Map([
      ['2025-Q1', 100],
      ['2025-Q2', 400],
    ]);
    const out = buildUnitRevenue(revQ, [ship('2025-Q1', 1000), ship('2025-Q2', 1000)], 0);
    expect(out.cv).toBeGreaterThan(0);
  });
});

describe('revenueByQuarter / buildRevenueVsRetail', () => {
  it('월별 매출을 분기로 합산', () => {
    const out = revenueByQuarter([
      { year_month: 202601, revenueEok: 10 },
      { year_month: 202602, revenueEok: 20 },
      { year_month: 202604, revenueEok: 5 },
    ]);
    expect(out.get('2026-Q1')).toBe(30);
    expect(out.get('2026-Q2')).toBe(5);
  });

  it('시차만큼 민 소매를 붙인다', () => {
    const retailMonths = new Map([[202603, 500]]);
    const out = buildRevenueVsRetail([{ year_month: 202601, revenueEok: 10 }], retailMonths, 2);
    expect(out[0].retailShifted).toBe(500);
  });

  it('대응 월이 없으면 null (0으로 채우지 않는다)', () => {
    const out = buildRevenueVsRetail([{ year_month: 202601, revenueEok: 10 }], new Map(), 2);
    expect(out[0].retailShifted).toBeNull();
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
    const d = diagnose(gap, []);
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
    const d = diagnose(gap, []);
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
    expect(diagnose(gap, []).level).toBe('yellow');
  });

  it('데이터가 없으면 노랑 + 사유 명시', () => {
    const d = diagnose([], []);
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
    const d = diagnose(gap, []);
    expect(d.reasons.join(' ')).toMatch(/400/);
    expect(d.reasons.join(' ')).toMatch(/310/);
  });

  it('Cox 실측이 있으면 근거에 포함', () => {
    const gap = gapSeries([{ ship: 300, retail: 250 }]);
    const cox: CoxInventoryRow[] = [
      { brand: 'NATION', year_month: 202605, days_supply: 76 },
      { brand: 'Jeep', year_month: 202605, days_supply: 145 },
    ];
    expect(diagnose(gap, cox).reasons.join(' ')).toContain('Cox');
  });
});

describe('buildForecast', () => {
  const gap = buildGapPoints(
    [ship('2025-Q1', 400), ship('2025-Q2', 400), ship('2025-Q3', 400), ship('2025-Q4', 400)],
    new Map([
      ['2025-Q1', 300],
      ['2025-Q2', 300],
      ['2025-Q3', 300],
      ['2025-Q4', 300],
    ])
  );
  const revQ = new Map([
    ['2025-Q1', 100],
    ['2025-Q2', 100],
    ['2025-Q3', 100],
    ['2025-Q4', 100],
  ]);
  const unit = buildUnitRevenue(revQ, [ship('2025-Q1', 400)], 0);

  it('시나리오 3종을 만든다', () => {
    const out = buildForecast(gap, unit, revQ);
    expect(out.scenarios.map((s) => s.key)).toEqual([
      'inventoryHold',
      'inventoryNormalize',
      'trendContinue',
    ]);
  });

  it('각 시나리오는 가정을 문장으로 밝힌다 — 블랙박스 금지', () => {
    const out = buildForecast(gap, unit, revQ);
    for (const s of out.scenarios) {
      expect(s.assumption.length).toBeGreaterThan(10);
      expect(s.points).toHaveLength(4);
    }
  });

  it('재고 유지 시나리오는 출하를 최근 평균 소매에 맞춘다', () => {
    const out = buildForecast(gap, unit, revQ);
    expect(out.scenarios[0].points[0].shipments).toBe(300);
  });

  it('현 추세 지속 시나리오는 최근 평균 출하를 유지한다', () => {
    const out = buildForecast(gap, unit, revQ);
    expect(out.scenarios[2].points[0].shipments).toBe(400);
  });

  it('재고 정상화는 과잉분(+400)을 2분기에 나눠 덜어낸다', () => {
    const out = buildForecast(gap, unit, revQ);
    // 최근 4분기 갭 합 = 400 → 2분기에 200씩 → 300 - 200 = 100
    expect(out.scenarios[1].points[0].shipments).toBe(100);
    expect(out.scenarios[1].points[1].shipments).toBe(100);
    // 3번째 분기부터는 조정 종료 → 소매 수준 복귀
    expect(out.scenarios[1].points[2].shipments).toBe(300);
  });

  it('전망 분기는 마지막 실적 다음 분기부터', () => {
    const out = buildForecast(gap, unit, revQ);
    expect(out.scenarios[0].points[0].yearPeriod).toBe('2026-Q1');
    expect(out.scenarios[0].points[3].yearPeriod).toBe('2026-Q4');
  });

  it('출하 전망이 음수가 되면 0으로 막는다', () => {
    const bigGap = buildGapPoints(
      [ship('2025-Q1', 900), ship('2025-Q2', 900), ship('2025-Q3', 900), ship('2025-Q4', 900)],
      new Map([
        ['2025-Q1', 100],
        ['2025-Q2', 100],
        ['2025-Q3', 100],
        ['2025-Q4', 100],
      ])
    );
    const out = buildForecast(bigGap, unit, revQ);
    expect(out.scenarios[1].points[0].shipments).toBe(0);
  });

  it('원단위 변동계수가 크면 신뢰도 경고', () => {
    const shaky = buildUnitRevenue(
      new Map([
        ['2025-Q1', 100],
        ['2025-Q2', 500],
      ]),
      [ship('2025-Q1', 400), ship('2025-Q2', 400)],
      0
    );
    expect(buildForecast(gap, shaky, revQ).lowConfidence).toBe(true);
  });

  it('데이터가 없으면 시나리오 없이 저신뢰', () => {
    const out = buildForecast([], unit, revQ);
    expect(out.scenarios).toHaveLength(0);
    expect(out.lowConfidence).toBe(true);
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
