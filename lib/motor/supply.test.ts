/**
 * 공급 이력 셀 접기(summarizeSupply) — 셀 폭이 좁아 앞 N건만 칩으로 그리고 나머지는 「+N」.
 * 순서를 바꾸면 명단 정본에 적은 중요도 순서가 화면에서 흐트러지므로 입력 순서를 고정한다.
 */
import { describe, expect, it } from 'vitest';
import type { SupplyRecord } from '@/lib/types';
import { summarizeSupply } from './supply';

function rec(customer: string): SupplyRecord {
  return { customer, product: null, field: 'robot', source_url: null, as_of: null };
}

describe('summarizeSupply', () => {
  it('max 를 넘으면 앞 max 건과 남은 수', () => {
    const out = summarizeSupply(['A', 'B', 'C', 'D', 'E'].map(rec), 3);
    expect(out.visible.map((r) => r.customer)).toEqual(['A', 'B', 'C']);
    expect(out.hidden).toBe(2);
  });

  it('0건이면 빈 배열·0', () => {
    expect(summarizeSupply([], 3)).toEqual({ visible: [], hidden: 0 });
  });

  it('max 이하면 전부 보이고 숨김 0', () => {
    const out = summarizeSupply(['A', 'B'].map(rec), 3);
    expect(out.visible.map((r) => r.customer)).toEqual(['A', 'B']);
    expect(out.hidden).toBe(0);
  });
});
