/**
 * 차트 시계열의 순수 헬퍼. next/cache를 import하지 않아 Vitest(node)에서 단위 테스트 가능.
 * 'use cache' 데이터 액세스는 lib/series.ts에 둔다.
 */

export type SeriesPoint = { time: string; value: number }; // time: 'YYYY-MM-DD'

/** 일봉 끝점에 합성할 라이브 1점 (환율·지수·개별종목 공용) */
export type LivePoint = { value: number; updated_at: string };

/**
 * 일봉 시리즈 끝에 라이브 가격 점을 합쳐 반환.
 *
 * - live KST 일자 > 일봉 마지막 일자 → 새 점 추가 ("오늘" 끝점)
 * - live KST 일자 == 일봉 마지막 일자 → 마지막 점 값을 live로 덮어쓰기
 * - live가 더 오래되거나 없으면 일봉 그대로
 *
 * 과거 일자는 손대지 않음 — 종가가 그대로 유지된다.
 */
export function appendLivePoint(series: SeriesPoint[], live: LivePoint | null): SeriesPoint[] {
  if (!live) return series;
  // updated_at(UTC) → KST(=+9) 기준 'YYYY-MM-DD' 추출
  const utcMs = new Date(live.updated_at).getTime();
  if (!Number.isFinite(utcMs)) return series;
  const kstDate = new Date(utcMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const last = series.at(-1);
  if (!last) return [{ time: kstDate, value: live.value }];
  if (kstDate < last.time) return series;
  if (kstDate === last.time) {
    return [...series.slice(0, -1), { time: kstDate, value: live.value }];
  }
  return [...series, { time: kstDate, value: live.value }];
}
