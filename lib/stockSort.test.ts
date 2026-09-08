/**
 * lib/stockSort.ts 회귀 테스트 — 미래 시각에도 지원 연도 창이 따라 올라가는지.
 *
 * `SUPPORTED_YEARS`가 모듈 최상단 상수였을 때는 모듈 평가 시점에 굳어, 해가
 * 바뀐 뒤에도 옛 창을 반환했다(2026-09-08 코드리뷰 지적). 함수 안에서 다시
 * 계산하도록 고친 뒤 이 테스트로 고정한다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveLatestYear } from './stockSort';

describe('resolveLatestYear', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('해가 바뀌어도 지원 연도 창이 따라 올라간다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-05T00:00:00+09:00'));
    const rows = [{ financials_by_year: { '2029': { revenue: 1 } } } as never];
    expect(resolveLatestYear(rows)).toBe('2029');
  });
});
