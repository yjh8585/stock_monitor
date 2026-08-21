interface ReportEmbedProps {
  postId: number;
  /** iframe title(스크린리더)에 쓸 게시글 제목. */
  title: string;
}

/**
 * 원본 HTML 보고서를 디자인 그대로 보여주는 임베드 블록.
 *
 * src 는 인증 프록시 `/api/reports/[id]/html` — 비공개 버킷이라 공개 URL 이 없고,
 * 상대경로라 same-site 요청이 되어 세션 쿠키(sm_session, SameSite=Lax)가 정상 동행한다.
 *
 * 🔴 `sandbox` 를 걸지 않는다. 걸면 보고서 자체 스크립트(영상 재생기 등)가 죽어
 * "원본 그대로" 요구가 깨진다. 게다가 `allow-scripts`+`allow-same-origin` 조합은
 * 프레임이 스스로 샌드박스를 벗을 수 있어 사실상 무샌드박스와 같다.
 *
 * 🔴 `allow-same-origin` **없는** 샌드박스(응답 헤더의 CSP `sandbox` 지시자)는 실제로
 * 격리가 되지만 채택하지 않았다 — 샌드박스 플래그는 중첩 프레임에 그대로 상속되므로
 * 보고서 안의 유튜브 플레이어가 불투명 origin 에 갇혀 자기 저장소를 못 쓴다.
 * **영상 재생이 이 보고서의 요구사항**이라 기능이 먼저다. 대신 운영 규칙으로 막는다:
 * `reports-html` 버킷에는 **관리자가 내용을 직접 확인한 자립형 HTML 만** 올린다
 * (업로드 UI 가 없고 스크립트/대시보드 경로뿐이라 실제 투입 주체도 관리자뿐이다).
 * 신뢰할 수 없는 HTML 을 올릴 일이 생기면 그때 CSP `sandbox` 를 켜고 영상을 포기한다.
 *
 * 🔴 `allow` 와 `allowFullScreen` 을 반드시 함께 준다. 권한은 위에서 아래로만 흐르므로
 * 바깥 iframe 에 없는 권한은 보고서 안의 유튜브 iframe(손자 프레임)이 받지 못한다.
 * 특히 전체화면은 same-origin 이어도 이 속성 없이는 동작하지 않는다.
 * allowlist 를 `*` 로 적은 이유: feature 이름만 쓰면 기본값이 `'src'` 라 중첩 위임
 * 판정에 해석 여지가 남는다. 나열한 8종에 카메라·마이크·위치 같은 민감 권한은 없다.
 * 목록은 유튜브 공식 embed 코드가 요구하는 것과 같게 맞췄다 — `gyroscope`(360°·VR 영상이
 * 기기 방향에 반응) 와 `web-share`(플레이어 공유 단추) 가 빠지면 콘솔 경고만 남기고
 * **조용히 무반응**이 되어 육안 확인에서도 놓치기 쉽다.
 *
 * 상태가 없어 클라이언트 컴포넌트로 만들지 않는다('use client' 불필요).
 */
export function ReportEmbed({ postId, title }: ReportEmbedProps) {
  const src = `/api/reports/${postId}/html`;

  return (
    <section className="overflow-hidden rounded-lg border">
      <header className="bg-muted/40 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-4 py-3">
        <span className="font-semibold">원본 보고서</span>
        <a
          className="text-primary text-sm hover:underline"
          href={src}
          target="_blank"
          rel="noopener noreferrer"
        >
          ↗ 새 탭에서 크게 보기
        </a>
      </header>

      {/* 세로로 긴 문서라 youtube-block 의 aspect-video 를 쓰지 않는다. 뷰포트 기준 높이 + 내부 스크롤. */}
      <iframe
        src={src}
        title={`${title} 원본 보고서`}
        className="block h-[85vh] min-h-[560px] w-full border-0"
        loading="lazy"
        allow="accelerometer *; autoplay *; clipboard-write *; encrypted-media *; gyroscope *; picture-in-picture *; web-share *; fullscreen *"
        allowFullScreen
      />
    </section>
  );
}
