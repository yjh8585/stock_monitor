/**
 * 휴머노이드 > 보고서 탭의 본문 컨테이너.
 *
 * 🔴 `app/reports/layout.tsx` 와 **같은 폭·같은 여백**을 쓴다. 이 파일이 없던 동안
 * 목록·상세가 각자 `p-6` 만 두어 좌우 여백이 25px 이었고(게시판은 97px), 표가 화면
 * 가장자리에 붙어 보였다(2026-09-11 사용자 지적 · 실측으로 확인).
 *
 * 같은 글을 게시판(`/reports`)과 이 탭 양쪽에서 볼 수 있으므로 **폭이 달라 보이면 안 된다.**
 */
export default function HumanoidReportsLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-7xl px-12 py-4 sm:px-20 lg:px-24">{children}</div>;
}
