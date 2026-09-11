/**
 * 보고서 목록 정렬 — 타입·정규화의 단일 출처.
 *
 * 🔴 **페이지마다 다시 정의하지 말 것.** 원래 `app/reports/page.tsx` 와
 * `components/reports/post-list.tsx` 에 사본이 하나씩 있었고, 세 번째 화면
 * (`/humanoid/reports`)을 만들 때 **정렬 배선 자체를 빠뜨려** 머리글을 눌러도
 * 아무 일도 일어나지 않았다(2026-09-11). URL 은 바뀌는데 목록이 그대로라
 * 「죽은 버튼」이 된다 — lint·타입·테스트 어디에도 안 걸린다.
 */

/** 정렬 기준 컬럼. 게시일(원문 발행일)이 기본이다. */
export type SortKey = 'created_at' | 'source_published_at';

export type SortOrder = 'asc' | 'desc';

export const DEFAULT_SORT: SortKey = 'source_published_at';
export const DEFAULT_ORDER: SortOrder = 'desc';

/** URL 파라미터 → 정렬 기준. 모르는 값은 기본값으로 떨어뜨린다. */
export function normalizeSort(value: string | undefined): SortKey {
  return value === 'created_at' ? 'created_at' : DEFAULT_SORT;
}

/** URL 파라미터 → 정렬 방향. 모르는 값은 내림차순. */
export function normalizeOrder(value: string | undefined): SortOrder {
  return value === 'asc' ? 'asc' : DEFAULT_ORDER;
}
