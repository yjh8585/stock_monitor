import { describe, expect, it } from 'vitest';
import {
  activeSeries,
  basisKey,
  buildLongtermPoints,
  fxNote,
  listBases,
  type LongtermRow,
} from '../longterm';

const FX = 'Booked 기준 (FX 1,300원/USD, 1,400원/EUR)';

/** 픽스처 — 실제 데이터 아님(가짜 숫자). 2026.1Q의 '고객 EDI 100%'는 전부 null(엑셀 N/A 재현). */
function row(
  quarter: number,
  series: LongtermRow['series'],
  year: number,
  value: number | null
): LongtermRow {
  return {
    basis_year: 2026,
    basis_quarter: quarter,
    series,
    period_year: year,
    value_mwon: value,
    fx_note: FX,
  };
}

const ROWS: LongtermRow[] = [
  // 2026.2Q — 3계열 모두 값 있음
  row(2, '수주 Volume', 2027, 100),
  row(2, '수주 Volume', 2028, 110),
  row(2, '고객 EDI 100%', 2027, 90),
  row(2, '고객 EDI 100%', 2028, 95),
  row(2, '한세 전망', 2027, 80),
  row(2, '한세 전망', 2028, 85),
  // 2026.1Q — 고객 EDI 100%는 전부 null
  row(1, '수주 Volume', 2027, 70),
  row(1, '고객 EDI 100%', 2027, null),
  row(1, '한세 전망', 2027, 60),
];

describe('basisKey', () => {
  it('연도.분기Q 형식으로 만든다', () => {
    expect(basisKey(2026, 1)).toBe('2026.1Q');
    expect(basisKey(2026, 2)).toBe('2026.2Q');
  });
});

describe('listBases', () => {
  it('중복 없이 최신 기준 우선으로 정렬한다', () => {
    expect(listBases(ROWS)).toEqual([
      { key: '2026.2Q', year: 2026, quarter: 2 },
      { key: '2026.1Q', year: 2026, quarter: 1 },
    ]);
  });

  it('빈 입력이면 빈 배열', () => {
    expect(listBases([])).toEqual([]);
  });
});

describe('activeSeries', () => {
  it('값이 있는 계열만 고정 순서로 반환한다', () => {
    expect(activeSeries(ROWS, '2026.2Q')).toEqual(['수주 Volume', '고객 EDI 100%', '한세 전망']);
  });

  it('전부 null인 계열은 제외한다 (2026.1Q 고객 EDI 100%)', () => {
    expect(activeSeries(ROWS, '2026.1Q')).toEqual(['수주 Volume', '한세 전망']);
  });

  it('없는 기준이면 빈 배열', () => {
    expect(activeSeries(ROWS, '2099.9Q')).toEqual([]);
  });
});

describe('buildLongtermPoints', () => {
  it('연도 오름차순으로 계열 값을 모은다', () => {
    expect(buildLongtermPoints(ROWS, '2026.2Q')).toEqual([
      { year: 2027, '수주 Volume': 100, '고객 EDI 100%': 90, '한세 전망': 80 },
      { year: 2028, '수주 Volume': 110, '고객 EDI 100%': 95, '한세 전망': 85 },
    ]);
  });

  it('null 값은 null로 유지한다', () => {
    expect(buildLongtermPoints(ROWS, '2026.1Q')).toEqual([
      { year: 2027, '수주 Volume': 70, '고객 EDI 100%': null, '한세 전망': 60 },
    ]);
  });

  it('없는 기준이면 빈 배열', () => {
    expect(buildLongtermPoints(ROWS, '2099.9Q')).toEqual([]);
  });
});

describe('fxNote', () => {
  it('선택 기준의 환율 문구를 반환한다', () => {
    expect(fxNote(ROWS, '2026.2Q')).toBe(FX);
  });

  it('없는 기준이면 null', () => {
    expect(fxNote(ROWS, '2099.9Q')).toBeNull();
  });

  it('fx_note가 비어 있으면 null', () => {
    const rows: LongtermRow[] = [{ ...row(2, '한세 전망', 2027, 10), fx_note: null }];
    expect(fxNote(rows, '2026.2Q')).toBeNull();
  });
});
