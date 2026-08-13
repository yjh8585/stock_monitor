/**
 * 항목별 신호등 판정 단위 테스트 — pure 함수, mocking 없음.
 *
 * 경계값을 상수(SIGNAL_THRESHOLDS)에서 끌어와 검사한다. 숫자를 테스트에 다시 적으면
 * 임계값을 바꿨을 때 테스트가 옛 값을 지키며 통과해 버린다.
 */
import { describe, expect, it } from 'vitest';
import {
  consumerAverage,
  consumerGap,
  evaluateMarket,
  SIGNAL_ITEMS,
  SIGNAL_THRESHOLDS,
  targetInventory,
  targetSafety,
  worstSignal,
} from './signals';
import type { CompetitionMarket, ConsumerScore } from './types';

function score(model: string, is_target: boolean, v: number): ConsumerScore {
  return { model, is_target, design: v, price: v, quality: v, efficiency: v, brand: v };
}

function market(over: Partial<CompetitionMarket> = {}): CompetitionMarket {
  return {
    market: 'USA',
    label: '미국',
    comment: '',
    anchorMonth: 202607,
    months: 12,
    sales: 100_000,
    yoyPct: 0,
    sharePct: null,
    prevSharePct: null,
    segmentNote: null,
    competitors: [],
    inventory: [],
    safety: [],
    consumerScores: [],
    series: [],
    ...over,
  };
}

function signalOf(m: CompetitionMarket, key: string) {
  return evaluateMarket(m).find((r) => r.key === key)?.signal;
}

describe('판매 증감 판정', () => {
  const t = SIGNAL_THRESHOLDS.sales;

  it('green 경계값은 GREEN 에 포함된다', () => {
    expect(signalOf(market({ yoyPct: t.green }), 'sales')).toBe('GREEN');
    expect(signalOf(market({ yoyPct: t.green - 0.1 }), 'sales')).toBe('YELLOW');
  });

  it('red 경계값 자체는 YELLOW, 그 아래가 RED', () => {
    expect(signalOf(market({ yoyPct: t.red }), 'sales')).toBe('YELLOW');
    expect(signalOf(market({ yoyPct: t.red - 0.1 }), 'sales')).toBe('RED');
  });

  it('값이 없으면 판정하지 않는다(YELLOW 로 뭉개지 않는다)', () => {
    expect(signalOf(market({ yoyPct: null }), 'sales')).toBeNull();
  });
});

describe('점유율 판정 — 전년 대비 %p 변화', () => {
  it('현재·전년이 모두 있어야 판정한다', () => {
    expect(signalOf(market({ sharePct: 17.1, prevSharePct: 19.6 }), 'share')).toBe('RED');
    expect(signalOf(market({ sharePct: 17.1, prevSharePct: null }), 'share')).toBeNull();
  });

  it('상승은 GREEN, 소폭 하락은 YELLOW', () => {
    expect(signalOf(market({ sharePct: 20, prevSharePct: 19 }), 'share')).toBe('GREEN');
    expect(signalOf(market({ sharePct: 19.4, prevSharePct: 19.6 }), 'share')).toBe('YELLOW');
  });

  it('표시값은 소수 첫째 자리로 반올림한다(부동소수 잔재가 안 보이게)', () => {
    const r = evaluateMarket(market({ sharePct: 17.1, prevSharePct: 19.6 })).find(
      (x) => x.key === 'share'
    );
    expect(r?.value).toBe(-2.5);
    expect(r?.display).toBe('-2.5%p');
  });
});

describe('재고일수·안전성 — 값이 작을수록 좋은 항목', () => {
  const inv = SIGNAL_THRESHOLDS.inventory;

  it('재고일수는 낮을수록 GREEN', () => {
    const m = (d: number) =>
      market({ inventory: [{ brand: 'Jeep', days_supply: d, year_month: 202606 }] });
    expect(signalOf(m(inv.green), 'inventory')).toBe('GREEN');
    expect(signalOf(m(inv.green + 1), 'inventory')).toBe('YELLOW');
    expect(signalOf(m(inv.red), 'inventory')).toBe('RED');
  });

  it('경쟁 브랜드 재고만 있고 대상이 없으면 판정하지 않는다', () => {
    const m = market({
      inventory: [{ model: 'Explorer', brand: 'Ford', days_supply: 93, year_month: 202606 }],
    });
    expect(signalOf(m, 'inventory')).toBeNull();
  });

  it('리콜 건수로 안전성을 판정한다', () => {
    const m = (c: number) =>
      market({ safety: [{ model_year: 2026, recall_count: c, complaint_count: 11 }] });
    expect(signalOf(m(SIGNAL_THRESHOLDS.safety.green), 'safety')).toBe('GREEN');
    expect(signalOf(m(SIGNAL_THRESHOLDS.safety.red), 'safety')).toBe('RED');
  });
});

describe('소비자 평가 — 경쟁 평균 대비 격차', () => {
  it('5축 평균을 낸다', () => {
    expect(consumerAverage(score('t', true, 4))).toBe(4);
    expect(
      consumerAverage({
        model: 'x',
        is_target: true,
        design: 4,
        price: 3,
        quality: 2,
        efficiency: 3,
        brand: 4,
      })
    ).toBe(3.2);
  });

  it('대상이 경쟁 평균보다 높으면 양수 격차', () => {
    const scores = [score('t', true, 4), score('a', false, 3), score('b', false, 3)];
    expect(consumerGap(scores)).toBe(1);
    expect(signalOf(market({ consumerScores: scores }), 'consumer')).toBe('GREEN');
  });

  it('경쟁이 없으면 비교 불가 — null', () => {
    expect(consumerGap([score('t', true, 4)])).toBeNull();
    expect(consumerGap([])).toBeNull();
  });

  it('대상이 없으면 null (경쟁만으로는 격차를 못 낸다)', () => {
    expect(consumerGap([score('a', false, 3)])).toBeNull();
  });
});

describe('대상/경쟁 구분', () => {
  it('model 이 없는 항목이 대상 차종이다', () => {
    const points = [
      { model: 'Explorer', brand: 'Ford', days_supply: 93, year_month: 202606 },
      { brand: 'Jeep', days_supply: 160, year_month: 202606 },
    ];
    expect(targetInventory(points)?.brand).toBe('Jeep');
    expect(
      targetSafety([{ model: 'Explorer', model_year: 2026, recall_count: 0, complaint_count: 24 }])
    ).toBeNull();
  });
});

describe('evaluateMarket 전체', () => {
  it('항목 5개를 SIGNAL_ITEMS 순서대로 돌려준다', () => {
    const out = evaluateMarket(market());
    expect(out.map((r) => r.key)).toEqual(SIGNAL_ITEMS.map((i) => i.key));
  });

  it('데이터가 전혀 없으면 전부 null + "데이터 없음"', () => {
    const out = evaluateMarket(market({ yoyPct: null }));
    expect(out.every((r) => r.signal === null)).toBe(true);
    expect(out.every((r) => r.display === '데이터 없음')).toBe(true);
  });

  it('hint 는 임계값 상수에서 만들어진다', () => {
    const sales = evaluateMarket(market()).find((r) => r.key === 'sales');
    expect(sales?.hint).toContain(`${SIGNAL_THRESHOLDS.sales.green}%`);
  });
});

describe('worstSignal — 다중 시장 요약', () => {
  it('시장 중 가장 나쁜 등급을 쓴다(평균으로 희석하지 않는다)', () => {
    const good = evaluateMarket(market({ yoyPct: 20 }));
    const bad = evaluateMarket(market({ yoyPct: -20 }));
    expect(worstSignal([good, bad], 'sales')).toBe('RED');
    expect(worstSignal([good, good], 'sales')).toBe('GREEN');
  });

  it('판정 가능한 시장이 하나도 없으면 null', () => {
    const none = evaluateMarket(market({ yoyPct: null }));
    expect(worstSignal([none, none], 'sales')).toBeNull();
  });

  it('일부 시장만 데이터가 있으면 그 시장 기준으로 판정한다', () => {
    const none = evaluateMarket(market({ yoyPct: null }));
    const bad = evaluateMarket(market({ yoyPct: -20 }));
    expect(worstSignal([none, bad], 'sales')).toBe('RED');
  });
});
