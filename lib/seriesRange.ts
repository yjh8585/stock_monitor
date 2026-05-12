/**
 * 시계열 기간 토글(1d/1m/3m/ytd/1y/5y) 슬라이스 헬퍼.
 * 서버는 5년치를 한 번에 보내고, 클라이언트는 토글에 따라 메모리에서 잘라낸다.
 */
import type { SeriesPoint } from '@/lib/series';

export type RangeKey = '1d' | '1m' | '3m' | 'ytd' | '1y' | '5y';

/** 마지막 점 시간을 기준으로 RangeKey 구간만 잘라낸다. 비어있거나 5y면 그대로. */
export function sliceByRange(points: SeriesPoint[], range: RangeKey): SeriesPoint[] {
  if (points.length === 0 || range === '5y') return points;

  const last = new Date(points[points.length - 1].time);
  let from: Date;
  switch (range) {
    case '1d':
      // 영업일 안전 마진: 마지막 거래일 포함, 직전 5일 내 데이터까지 표시
      from = new Date(last);
      from.setDate(from.getDate() - 5);
      break;
    case '1m':
      from = new Date(last);
      from.setMonth(from.getMonth() - 1);
      break;
    case '3m':
      from = new Date(last);
      from.setMonth(from.getMonth() - 3);
      break;
    case 'ytd':
      from = new Date(last.getFullYear(), 0, 1);
      break;
    case '1y':
      from = new Date(last);
      from.setFullYear(from.getFullYear() - 1);
      break;
  }
  const fromKey = from.toISOString().slice(0, 10);
  return points.filter((p) => p.time >= fromKey);
}
