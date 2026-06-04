import { describe, it, expect } from 'vitest';
import { appendLivePoint, type SeriesPoint } from './seriesLive';

describe('appendLivePoint', () => {
  const base: SeriesPoint[] = [
    { time: '2026-06-01', value: 100 },
    { time: '2026-06-02', value: 110 },
  ];

  it('live가 null이면 원본 그대로', () => {
    expect(appendLivePoint(base, null)).toEqual(base);
  });

  it('live 일자(KST)가 마지막보다 미래면 새 점 추가', () => {
    const r = appendLivePoint(base, { value: 120, updated_at: '2026-06-03T01:00:00Z' });
    expect(r).toHaveLength(3);
    expect(r.at(-1)).toEqual({ time: '2026-06-03', value: 120 });
  });

  it('live 일자가 마지막과 같으면 끝점 덮어쓰기', () => {
    const r = appendLivePoint(base, { value: 999, updated_at: '2026-06-02T05:00:00Z' });
    expect(r).toHaveLength(2);
    expect(r.at(-1)).toEqual({ time: '2026-06-02', value: 999 });
  });

  it('live 일자가 과거면 원본 그대로', () => {
    expect(appendLivePoint(base, { value: 50, updated_at: '2026-05-30T05:00:00Z' })).toEqual(base);
  });

  it('빈 시리즈면 live 점 1개', () => {
    const r = appendLivePoint([], { value: 77, updated_at: '2026-06-03T01:00:00Z' });
    expect(r).toEqual([{ time: '2026-06-03', value: 77 }]);
  });

  it('updated_at 파싱 불가면 원본 그대로', () => {
    expect(appendLivePoint(base, { value: 1, updated_at: 'invalid' })).toEqual(base);
  });

  it('UTC 20:00Z는 +9h 적용되어 다음날 KST 일자로 추가', () => {
    const r = appendLivePoint(base, { value: 130, updated_at: '2026-06-02T20:00:00Z' });
    expect(r.at(-1)).toEqual({ time: '2026-06-03', value: 130 });
  });
});
