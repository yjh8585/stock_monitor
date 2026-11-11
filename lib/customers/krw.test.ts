import { describe, expect, it } from 'vitest';
import { krwText, quarterAvgRate, quarterRange, revenueKrw } from './krw';

const rates = [
  { rate_date: '2026-06-30', rate: 9999 }, // 앞 분기 — 빠져야 한다
  { rate_date: '2026-07-01', rate: 1600 },
  { rate_date: '2026-08-15', rate: 1650 },
  { rate_date: '2026-09-30', rate: 1700 },
  { rate_date: '2026-10-01', rate: 1 }, // 뒤 분기 — 빠져야 한다
];

describe('quarterRange', () => {
  it('3분기는 7/1~9/31(문자열 상한)', () => {
    expect(quarterRange(2026, 3)).toEqual({ start: '2026-07-01', end: '2026-09-31' });
  });
  it('4분기는 10/1~12/31', () => {
    expect(quarterRange(2025, 4)).toEqual({ start: '2025-10-01', end: '2025-12-31' });
  });
});

describe('quarterAvgRate', () => {
  it('그 분기 행만 평균한다(경계일 포함 · 앞뒤 분기 제외)', () => {
    expect(quarterAvgRate(rates, 2026, 3)).toBeCloseTo(1650);
  });
  it('그 분기 행이 없으면 null', () => {
    expect(quarterAvgRate(rates, 2025, 1)).toBeNull();
  });
});

describe('revenueKrw', () => {
  it('외화 십억 × 분기 평균 환율', () => {
    expect(revenueKrw(37.611, 'EUR', rates, 2026, 3)).toBeCloseTo(37.611e9 * 1650);
  });
  it('KRW 는 환율 없이 그대로', () => {
    expect(revenueKrw(28_000, 'KRW', [], 2026, 3)).toBe(28_000e9);
  });
  it('환율이 없으면 null(환산 생략)', () => {
    expect(revenueKrw(10, 'VND', rates, 2024, 1)).toBeNull();
  });
  it('매출·통화가 없으면 null', () => {
    expect(revenueKrw(null, 'EUR', rates, 2026, 3)).toBeNull();
    expect(revenueKrw(10, null, rates, 2026, 3)).toBeNull();
  });
});

describe('krwText', () => {
  it('1조 이상은 조원 소수 1자리', () => {
    expect(krwText(62.06e12)).toBe('62.1조원');
  });
  it('1조 미만은 억원 반올림 · 천 단위 쉼표', () => {
    expect(krwText(4_567e8)).toBe('4,567억원');
  });
  it('없으면 —', () => {
    expect(krwText(null)).toBe('—');
  });
});
