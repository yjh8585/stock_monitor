interface ReportVideoProps {
  postId: number;
  /** 접근성 라벨에 쓸 게시글 제목. */
  title: string;
}

/**
 * 첨부 동영상 재생 블록.
 *
 * src 는 인증 프록시 `/api/reports/[id]/video` — 비공개 버킷이라 공개 URL 이 없고,
 * 상대경로라 same-site 요청이 되어 세션 쿠키(sm_session, SameSite=Lax)가 정상 동행한다.
 * 프록시는 권한 확인 후 Storage 단기 서명 URL 로 307 하며, 구간 탐색(Range)은 브라우저가
 * 리다이렉트를 따라가 Storage 가 직접 처리한다.
 *
 * 🔴 `preload="metadata"` — `auto` 로 두면 페이지를 열기만 해도 100MB 를 통째로 받아
 * Storage 무료 대역폭을 태운다. 길이·탐색 바를 그리는 데는 메타데이터면 충분하다.
 *
 * 🔴 `autoPlay` 를 걸지 않는다. 사외비 영상이 공유 화면에서 소리와 함께 저절로 재생되는
 * 사고를 막는다(브라우저도 음소거 아니면 대개 막는다).
 *
 * 상태가 없어 클라이언트 컴포넌트로 만들지 않는다('use client' 불필요).
 */
export function ReportVideo({ postId, title }: ReportVideoProps) {
  const src = `/api/reports/${postId}/video`;

  return (
    <section className="overflow-hidden rounded-lg border">
      <header className="bg-muted/40 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-4 py-3">
        <span className="font-semibold">동영상</span>
        <a
          className="text-primary text-sm hover:underline"
          href={src}
          target="_blank"
          rel="noopener noreferrer"
        >
          ↗ 새 탭에서 크게 보기
        </a>
      </header>

      {/* 16:9 고정 — 컨트롤 포함 전체가 검은 배경 위에 letterbox 로 맞춰진다. */}
      <video
        src={src}
        controls
        preload="metadata"
        playsInline
        controlsList="nodownload"
        aria-label={`${title} 동영상`}
        className="block aspect-video w-full bg-black"
      >
        브라우저가 동영상 재생을 지원하지 않습니다.
      </video>
    </section>
  );
}
