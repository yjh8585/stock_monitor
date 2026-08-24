/**
 * mapHumanoidStockRow 단위 테스트 — pure 함수, mocking 없음.
 *
 * 두 가지를 고정한다:
 *  1) 로봇 제품이 제품 셀 **앞쪽**에 온다. 겸업사(현대차·인피니온)는 자동차 제품이
 *     이미 여럿이고 로봇 제품은 뒤에 덧붙으므로, 정렬하지 않으면 휴머노이드 페이지에서
 *     정작 봐야 할 로봇 제품이 잘려 보이지 않는다. 눈으로만 알 수 있는 종류의 결함이라
 *     여기서 막는다.
 *  2) robot_roles 는 허용 값 두 개만 통과시킨다(DB CHECK 와 같은 집합).
 */
import { describe, expect, it } from 'vitest';
import { mapHumanoidStockRow } from '@/lib/types';

type ViewRowLike = Parameters<typeof mapHumanoidStockRow>[0];

/** 뷰가 실제로 주는 모양의 최소 행 */
function row(overrides: Partial<Record<string, unknown>> = {}): ViewRowLike {
  return {
    id: 'c1',
    ticker: '005380',
    name: 'Hyundai',
    name_kr: '현대차',
    market: 'KOSPI',
    country: 'KR',
    currency: 'KRW',
    status: 'active',
    company_type: 'OEM',
    group_name: '한국',
    products: [],
    customers: [],
    robot_roles: ['humanoid'],
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

describe('mapHumanoidStockRow — 로봇 제품 우선 정렬', () => {
  it('뒤에 덧붙은 로봇 제품을 앞으로 끌어온다', () => {
    const r = mapHumanoidStockRow(
      row({
        products: [
          { name: '그랜저', category: '기타' },
          { name: '넥쏘', category: '기타' },
          { name: '로봇 액추에이터', category: '액추에이터' },
        ],
      })
    );
    expect(r.products.map((p) => p.name)).toEqual(['로봇 액추에이터', '그랜저', '넥쏘']);
  });

  it('항목을 버리지 않는다 — 개수가 보존된다', () => {
    const products = [
      { name: 'A/S부품', category: '차체' },
      { name: 'ADAS 센서', category: '전장' },
      { name: '로봇 바디 액추에이터', category: '액추에이터' },
      { name: '볼스크류', category: '볼스크류/리니어' },
    ];
    const r = mapHumanoidStockRow(row({ products }));
    expect(r.products).toHaveLength(4);
    expect(new Set(r.products.map((p) => p.name))).toEqual(new Set(products.map((p) => p.name)));
  });

  it('로봇 제품끼리·자동차 제품끼리는 원래 순서를 지킨다', () => {
    const r = mapHumanoidStockRow(
      row({
        products: [
          { name: '자동차1', category: '전장' },
          { name: '로봇1', category: '감속기' },
          { name: '자동차2', category: '차체' },
          { name: '로봇2', category: '모터' },
        ],
      })
    );
    expect(r.products.map((p) => p.name)).toEqual(['로봇1', '로봇2', '자동차1', '자동차2']);
  });

  it("'기타'는 로봇 카테고리로 보지 않는다 — 자동차·로봇 공용이라 앞으로 끌면 오히려 섞인다", () => {
    const r = mapHumanoidStockRow(
      row({
        products: [
          { name: '휴머노이드 로봇', category: '기타' },
          { name: '감속기', category: '감속기' },
        ],
      })
    );
    expect(r.products[0]?.name).toBe('감속기');
  });

  it('카테고리가 없는 항목도 잃지 않는다', () => {
    const r = mapHumanoidStockRow(
      row({ products: [{ name: '미분류' }, { name: '모터', category: '모터' }] })
    );
    expect(r.products.map((p) => p.name)).toEqual(['모터', '미분류']);
  });
});

describe('mapHumanoidStockRow — robot_roles', () => {
  it('허용 값 두 개만 통과시킨다', () => {
    const r = mapHumanoidStockRow(row({ robot_roles: ['humanoid', 'parts', 'industrial'] }));
    expect(r.robot_roles).toEqual(['humanoid', 'parts']);
  });

  it('null 이면 빈 배열', () => {
    expect(mapHumanoidStockRow(row({ robot_roles: null })).robot_roles).toEqual([]);
  });
});

describe('mapHumanoidStockRow — 비상장 지표', () => {
  it('기업가치·조달액·기준일을 그대로 싣는다', () => {
    const r = mapHumanoidStockRow(
      row({
        valuation_usd: 39_000_000_000,
        funding_total_usd: 1_900_000_000,
        valuation_asof: '2025-09-16',
      })
    );
    expect(r.valuation_usd).toBe(39_000_000_000);
    expect(r.funding_total_usd).toBe(1_900_000_000);
    expect(r.valuation_asof).toBe('2025-09-16');
  });
});
