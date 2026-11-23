import 'server-only';
import logger from '@/lib/logger';

/** PostgREST 기본 max-rows. 한 번에 이보다 많이 달라고 해도 여기서 잘린다. */
export const SUPABASE_PAGE_SIZE = 1000;

/**
 * `.range()` 페이지 반복 — 1,000행을 넘는 표를 끝까지 읽는다.
 *
 * 🔴 호출부가 **PK 전체**로 `.order()` 를 건다(AGENTS.md: 조건은 「있다」가 아니라 「유일하다」).
 * 정렬이 유일하지 않으면 페이지 경계에서 행이 누락·중복된다.
 *
 * 단건 조회(`.select()` 한 번)는 1,000행에서 **오류 없이 조용히 잘린다** — 사외비 조회 4곳이
 * 그 상태였다(2026-11-20 코드 리뷰 6번).
 */
export async function fetchAllPages<T>(
  label: string,
  page: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const { data, error } = await page(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) {
      logger.error({ err: error }, `${label} 조회 실패`);
      throw new Error(`${label} 조회 실패: ${error.message}`);
    }
    out.push(...(data ?? []));
    if (!data || data.length < SUPABASE_PAGE_SIZE) break;
  }
  return out;
}
