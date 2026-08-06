/**
 * trimFinancialYears 단위 테스트 — pure 함수, mocking 없음.
 *
 * 이 함수는 ISR write(8KB 단위 크기 기준 과금)를 줄이려고 캐시 payload 에서
 * 화면이 안 읽는 재무 필드·연도를 잘라낸다. 잘못 자르면 표가 조용히 '—' 로
 * 비므로, "무엇을 남겨야 하는가"를 여기에 고정한다.
 * 배경 → docs/isr-write-optimization.md
 */
import { describe, expect, it } from 'vitest';
import { trimFinancialYears } from '@/lib/types';

/** 뷰가 실제로 주는 형태(11필드) — 타입에서 지운 3필드도 런타임엔 들어온다. */
function rawYear(revenue: number | null, extra: Record<string, number> = {}) {
  return {
    revenue,
    operating_income: 10,
    operating_margin: 5,
    debt_ratio: 80,
    inventory: 4,
    per: 12,
    pbr: 1.1,
    ev_ebitda: 7,
    eps: 500,
    total_liabilities: 1000,
    total_equity: 1200,
    ...extra,
  };
}

/** 타입 밖 필드까지 확인해야 하므로 unknown 경유로 캐스팅한다. */
function trim(input: Record<string, ReturnType<typeof rawYear>>) {
  return trimFinancialYears(input as unknown as Parameters<typeof trimFinancialYears>[0]);
}

describe('trimFinancialYears', () => {
  it('null 은 그대로 null', () => {
    expect(trimFinancialYears(null)).toBeNull();
  });

  it('화면이 안 읽는 eps·total_liabilities·total_equity 를 제거한다', () => {
    const out = trim({ '2025': rawYear(100) });
    expect(Object.keys(out!['2025']).sort()).toEqual([
      'debt_ratio',
      'ev_ebitda',
      'inventory',
      'operating_income',
      'operating_margin',
      'pbr',
      'per',
      'revenue',
    ]);
  });

  it('표가 쓰는 값은 그대로 보존한다', () => {
    const out = trim({ '2025': rawYear(100) });
    expect(out!['2025']).toMatchObject({
      revenue: 100,
      operating_income: 10,
      operating_margin: 5,
      debt_ratio: 80,
      inventory: 4,
      per: 12,
      pbr: 1.1,
      ev_ebitda: 7,
    });
  });

  it('최신 4개년(최신·-1·-2·-3)만 남긴다', () => {
    const out = trim({
      '2020': rawYear(1),
      '2021': rawYear(2),
      '2022': rawYear(3),
      '2023': rawYear(4),
      '2024': rawYear(5),
      '2025': rawYear(6),
    });
    expect(Object.keys(out!).sort()).toEqual(['2022', '2023', '2024', '2025']);
  });

  it('4개년 폭 밖이어도 매출이 있는 최신 연도는 보존한다 (stockSort 정렬 fallback)', () => {
    // 2025까지 행은 있으나 매출은 2020이 마지막 — getFinancialSortValue 가 이 연도를 찾는다.
    const out = trim({
      '2020': rawYear(999),
      '2021': rawYear(null),
      '2022': rawYear(null),
      '2023': rawYear(null),
      '2024': rawYear(null),
      '2025': rawYear(null),
    });
    expect(Object.keys(out!).sort()).toEqual(['2020', '2022', '2023', '2024', '2025']);
    expect(out!['2020'].revenue).toBe(999);
  });

  it('매출이 전 연도 null 이면 4개년 규칙만 적용한다', () => {
    const out = trim({
      '2021': rawYear(null),
      '2022': rawYear(null),
      '2023': rawYear(null),
      '2024': rawYear(null),
      '2025': rawYear(null),
    });
    expect(Object.keys(out!).sort()).toEqual(['2022', '2023', '2024', '2025']);
  });

  it('빠진 필드는 null 로 채운다', () => {
    const out = trimFinancialYears({
      '2025': { revenue: 100 } as unknown as Record<string, never> as never,
    });
    expect(out!['2025'].per).toBeNull();
    expect(out!['2025'].revenue).toBe(100);
  });

  it('연도 형식이 아닌 키만 있으면 원본을 그대로 돌려준다', () => {
    const input = { ttm: rawYear(100) };
    expect(trim(input)).toBe(input);
  });
});
