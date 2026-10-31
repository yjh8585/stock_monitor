/**
 * 경영표준 카테고리 SSOT.
 *
 * 그룹웨어 경영표준(매뉴얼·규칙·기준서)을 정리한 보고서는 **기타 > 경영표준에서만** 보여 준다
 * (사용자 지시 2026-10-30 — 계획 `docs/plans/2026-10-30-mgmt-standard.md`). 그래서
 *  - `/reports` 목록·카테고리 드롭다운은 이 카테고리를 제외하고
 *  - `/etc/mgmt-standard` 는 이 카테고리만 장 순서로 보여 준다.
 *
 * 🔴 카테고리 문자열을 페이지마다 다시 박지 말 것 — 로봇(`robot.ts`)과 같은 이유다.
 * 글은 `scripts/` 의 게시 스크립트가 카테고리를 직접 넣는다(자동 분류기를 거치지 않는다).
 */
export const MGMT_STANDARD_CATEGORY = '경영표준';

/**
 * 장 순서 정렬 — 제목 앞의 장 번호(`00.` ~ `11.`)가 먼저, 그 뒤에 부록(`부록 A.` …).
 *
 * 게시판 정렬은 게시일·원문 발행일뿐이라 장 순서를 세울 수 없다(계획서 결정 7).
 * 한국어 비교라 `localeCompare` 를 쓰면 숫자로 시작하는 제목이 한글보다 앞에 온다.
 */
export function compareChapterTitle(a: string, b: string): number {
  return a.localeCompare(b, 'ko', { numeric: true });
}
