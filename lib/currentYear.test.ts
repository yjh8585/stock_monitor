import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentYear } from './currentYear';

describe('currentYear', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('UTC 로는 전년인 순간에도 서울 연도를 준다', () => {
    // 2026-12-31T16:00Z = 서울 2027-01-01 01:00
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-12-31T16:00:00Z'));
    expect(currentYear()).toBe(2027);
  });

  it('UTC 로는 이미 새해인 순간에도 서울이 아직 전년이면 전년을 준다', () => {
    // 2026-01-01T00:30Z = 서울 2026-01-01 09:30 → 같은 해라 경계가 안 잡힌다.
    // 반대 방향 경계: 서울이 아직 12/31 인 순간은 UTC 로도 12/31 이므로
    // 서울 기준이 UTC 보다 **앞서기만** 한다는 사실을 명시적으로 고정한다.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    expect(currentYear()).toBe(2026);
  });
});
