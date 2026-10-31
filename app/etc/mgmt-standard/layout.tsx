/**
 * 기타 > 경영표준의 본문 컨테이너.
 *
 * 🔴 `app/reports/layout.tsx`·`app/humanoid/reports/layout.tsx` 와 **같은 폭·같은 여백**을 쓴다 —
 * 상세 화면이 같은 `PostDetail` 이라 폭이 다르면 같은 글이 다르게 보인다(2026-09-11 사용자 지적).
 */
export default function MgmtStandardLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-7xl px-12 py-4 sm:px-20 lg:px-24">{children}</div>;
}
