/**
 * 로봇 카테고리 SSOT.
 *
 * 로봇 글은 **휴머노이드 페이지에서만** 보여 준다(사용자 지시 2026-09-11
 * "이제 로봇 관련된 것은 다 휴머노이드로 옮길 거야"). 그래서
 *  - `/reports` 목록·카테고리 드롭다운은 이 카테고리를 제외하고
 *  - `/humanoid/reports` 는 이 카테고리만 좁혀 본다.
 *
 * 🔴 카테고리 문자열을 페이지마다 다시 박지 말 것 — 한쪽만 고치면 글이 두 곳에서
 *    동시에 사라지거나 동시에 나타난다.
 */
export const ROBOT_CATEGORY = '로봇';

/**
 * 제목 강제 판정용 한국어 낱말.
 *
 * 부분 일치로 본다 — 한국어는 조사가 붙어 `\b`(단어 경계)가 무동작이기 때문이다
 * (전역 규칙 `warn-regex-wordboundary-korean`).
 */
const ROBOT_WORDS_KO = ['로봇', '로보틱스', '휴머노이드', '휴먼노이드', '피지컬 AI', '피지컬AI'];

/**
 * 영문 낱말은 반대로 **경계가 꼭 필요하다** — 경계 없이 `robot` 을 부분 일치시키면
 * 문제가 없지만 `ai` 류를 함께 넣는 순간 `said`·`Taiwan` 에 걸린다. 같은 규칙을 적용해 둔다.
 */
const ROBOT_WORDS_EN = /\b(robots?|robotics|humanoids?|physical\s+ai)\b/i;

/**
 * 제목만 보고 로봇 글인지 판정한다.
 *
 * 카테고리를 LLM 이 제목 한 줄로 고르는데(`classifyCategory`), 그 분류기는
 * "없으면 적합한 한 단어"를 허용해 실제로 `글로벌 자동차`·`해외사업` 같은 목록 밖 값을
 * 만들어 왔다. 로봇 글이 그렇게 새면 휴머노이드 페이지에 **영영 안 나온다** —
 * 조용한 실패라 알아채기 어려워 결정적인 규칙으로 못 박는다(계획서 결정 4).
 */
export function isRobotTitle(title: string): boolean {
  if (!title) return false;
  const lower = title.toLowerCase();
  if (ROBOT_WORDS_KO.some((w) => lower.includes(w.toLowerCase()))) return true;
  return ROBOT_WORDS_EN.test(title);
}
