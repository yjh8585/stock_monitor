/**
 * 서울 기준 **달력 연도**.
 *
 * 화면 라벨·「진행 중 연도(YTD)」 판정·연도 상한을 전부 여기서 파생시킨다.
 * 연도를 코드에 박으면 해가 바뀌는 순간 화면이 조용히 지난해에 멈춘다(2026 하드코딩 사고).
 *
 * 🔴 `new Date().getFullYear()` 를 쓰지 말 것 — 서버 로컬시간이라 Vercel(UTC)에서는
 * 매년 1월 1일 00:00~09:00(KST) 동안 전년을 돌려준다.
 *
 * 🔴 회사별 **회계연도**(`companies.fiscal_year_end_month` 로 −1 보정하는 그것)와는
 * 다른 개념이다. 재무 fiscal_year 판정에 이 함수를 쓰지 말 것.
 */
export function currentYear(): number {
  const seoulDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  return parseInt(seoulDate.slice(0, 4), 10);
}
