/**
 * /reports 트리 공통 컨테이너. 사이드바 메인 영역 안에서 좌우 여백과
 * 최대 폭(읽기 편한 5xl)을 보장한다.
 */
export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-5xl px-2 py-2">{children}</div>;
}
