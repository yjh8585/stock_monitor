import { describe, expect, it } from 'vitest';
import { priceReturns } from './prices';

describe('priceReturns', () => {
  it('1M = 한 달 전 날짜 이전 마지막 거래일 · YTD = 전년 마지막 거래일', () => {
    const r = priceReturns([
      { trade_date: '2025-12-30', close: 100 },
      { trade_date: '2026-10-08', close: 80 },
      { trade_date: '2026-10-10', close: 90 },
      { trade_date: '2026-11-08', close: 120 },
    ]);
    expect(r.lastClose).toBe(120);
    expect(r.lastDate).toBe('2026-11-08');
    expect(r.return1mPct).toBeCloseTo(50);
    expect(r.returnYtdPct).toBeCloseTo(20);
  });

  it('정렬되지 않은 입력도 처리', () => {
    const r = priceReturns([
      { trade_date: '2026-11-08', close: 110 },
      { trade_date: '2025-12-31', close: 100 },
    ]);
    expect(r.returnYtdPct).toBeCloseTo(10);
    expect(r.return1mPct).toBeCloseTo(10);
  });

  it('기준 종가가 없으면 null · 빈 입력', () => {
    expect(priceReturns([{ trade_date: '2026-11-08', close: 1 }]).returnYtdPct).toBeNull();
    expect(priceReturns([])).toEqual({
      lastClose: null,
      lastDate: null,
      return1mPct: null,
      returnYtdPct: null,
    });
  });
});
