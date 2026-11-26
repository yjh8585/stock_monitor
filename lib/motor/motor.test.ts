/**
 * 모터 탭(/humanoid/motor) 매퍼 단위 테스트 — pure 함수, mocking 없음.
 *
 * 고정하는 것:
 *  1) 화면에는 「확인」 공급 이력만 나간다. 뷰가 이미 거르지만 매퍼가 한 번 더 거른다 —
 *     뷰 정의가 바뀌어 「추정」이 새도 화면에는 안 보이게(설계 결정 7).
 *  2) supply_history 가 null·객체·깨진 원소여도 예외 없이 빈 배열·부분 배열로 렌더된다.
 *     기존 회사 수백 곳은 이 칸이 null 이다.
 *  3) 근거 링크는 http(s) 만 — javascript: 같은 값이 <a href> 로 나가지 않게.
 *  4) motor_types 는 DB CHECK 와 같은 4값만 통과시키고, robot_roles 는 비운다.
 */
import { describe, expect, it } from 'vitest';
import { mapMotorStockRow, parseSupplyHistory } from '@/lib/types';

type ViewRowLike = Parameters<typeof mapMotorStockRow>[0];

function row(overrides: Partial<Record<string, unknown>> = {}): ViewRowLike {
  return {
    id: 'm1',
    ticker: '012200',
    name: 'Keyang Electric',
    name_kr: '계양전기',
    market: 'KOSPI',
    country: 'KR',
    currency: 'KRW',
    status: 'active',
    company_type: '부품사',
    group_name: null,
    products: [],
    customers: [],
    motor_types: ['auto_motor'],
    supply_history: [],
    valuation_usd: null,
    funding_total_usd: null,
    valuation_asof: null,
    last_price: null,
    last_change_pct: null,
    last_updated_at: null,
    market_cap: null,
    homepage_url: null,
    fx_to_krw: 1,
    fx_fin_to_krw: 1,
    financials_by_year: null,
    latest_quarter: null,
    latest_revenue_krw: null,
    sales_rank: 1,
    ...overrides,
  } as unknown as ViewRowLike;
}

describe('parseSupplyHistory', () => {
  it('null·객체는 빈 배열', () => {
    expect(parseSupplyHistory(null)).toEqual([]);
    expect(parseSupplyHistory({})).toEqual([]);
  });

  it('「추정」은 버리고 「확인」만 남긴다', () => {
    const out = parseSupplyHistory([
      { customer: 'A', field: 'robot', grade: '확인', source_url: 'https://x.kr/a' },
      { customer: 'B', field: 'robot', grade: '추정' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].customer).toBe('A');
  });

  it('customer 가 없거나 field 가 목록 밖인 원소만 버린다', () => {
    const out = parseSupplyHistory([
      { field: 'robot', grade: '확인', source_url: 'https://x.kr/1' },
      { customer: 'C', field: 'car', grade: '확인', source_url: 'https://x.kr/2' },
      {
        customer: 'D',
        field: 'auto',
        grade: '확인',
        source_url: 'https://x.kr/3',
        product: 'BLDC',
      },
      'garbage',
    ]);
    expect(out.map((r) => r.customer)).toEqual(['D']);
    expect(out[0]).toEqual({
      customer: 'D',
      product: 'BLDC',
      field: 'auto',
      source_url: 'https://x.kr/3',
      as_of: null,
    });
  });

  it('source_url 이 http(s) 가 아니면 null', () => {
    const out = parseSupplyHistory([
      { customer: 'E', field: 'industrial', grade: '확인', source_url: 'javascript:alert(1)' },
    ]);
    expect(out[0].source_url).toBeNull();
  });
});

describe('mapMotorStockRow', () => {
  it('목록 밖 motor_types 는 버리고 robot_roles 는 빈 배열', () => {
    const r = mapMotorStockRow(row({ motor_types: ['auto_motor', 'inverter', 'control'] }));
    expect(r.motor_types).toEqual(['auto_motor', 'control']);
    expect(r.robot_roles).toEqual([]);
  });

  it('supply_history 가 null 이어도 빈 배열', () => {
    expect(mapMotorStockRow(row({ supply_history: null })).supply_history).toEqual([]);
  });
});
