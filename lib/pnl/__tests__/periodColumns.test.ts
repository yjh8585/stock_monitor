import { describe, expect, it } from 'vitest';
import { buildPeriodColumns } from '../periodColumns';

interface Row {
  period_year: number;
  period_kind: string;
  period_month: number;
  kind?: string;
}

const annual = (y: number, kind = 'actual'): Row => ({
  period_year: y,
  period_kind: 'annual',
  period_month: 0,
  kind,
});
const monthly = (y: number, m: number, kind = 'actual'): Row => ({
  period_year: y,
  period_kind: 'monthly',
  period_month: m,
  kind,
});

describe('buildPeriodColumns', () => {
  it('연간 행이 있는 연도를 오름차순 열로 만든다', () => {
    const cols = buildPeriodColumns([annual(2025), annual(2023), annual(2024)]);
    expect(cols.map((c) => c.label)).toEqual(['2023', '2024', '2025']);
    expect(cols.every((c) => c.ytdMonths === null)).toBe(true);
  });

  it('월별만 있는 최신 연도는 YTD 열이 되고 최대 월을 라벨에 쓴다', () => {
    const cols = buildPeriodColumns([annual(2024), monthly(2025, 1), monthly(2025, 3)]);
    expect(cols.map((c) => c.label)).toEqual(['2024', '2025 YTD']);
    expect(cols[1].ytdMonths).toBe(3);
  });

  it('12개월이 다 차면 YTD 표기를 떼고 연도만 쓴다', () => {
    const rows = Array.from({ length: 12 }, (_, i) => monthly(2025, i + 1));
    const cols = buildPeriodColumns(rows);
    expect(cols.map((c) => c.label)).toEqual(['2025']);
    expect(cols[0].ytdMonths).toBe(12);
  });

  it('확정 연간 행이 들어온 연도는 YTD 열을 만들지 않는다', () => {
    const cols = buildPeriodColumns([annual(2025), monthly(2025, 4)]);
    expect(cols.map((c) => c.label)).toEqual(['2025']);
    expect(cols[0].ytdMonths).toBeNull();
    // 연간 열의 match 는 연간 행만 받는다
    expect(cols[0].match(annual(2025))).toBe(true);
    expect(cols[0].match(monthly(2025, 4))).toBe(false);
  });

  it('YTD 열의 match 는 1~최대월만 받는다', () => {
    const cols = buildPeriodColumns([monthly(2025, 2), monthly(2025, 5)]);
    const ytd = cols[0];
    expect(ytd.match(monthly(2025, 5))).toBe(true);
    expect(ytd.match(monthly(2025, 6))).toBe(false);
    expect(ytd.match(monthly(2024, 3))).toBe(false);
  });

  it('extraFilter 로 걸러진 행은 열 목록에도 안 잡힌다', () => {
    const rows = [annual(2024), annual(2025, 'plan'), monthly(2026, 2, 'plan')];
    const cols = buildPeriodColumns(rows, (r) => r.kind === 'actual');
    expect(cols.map((c) => c.label)).toEqual(['2024']);
  });

  it('빈 입력은 빈 배열', () => {
    expect(buildPeriodColumns([])).toEqual([]);
  });
});
