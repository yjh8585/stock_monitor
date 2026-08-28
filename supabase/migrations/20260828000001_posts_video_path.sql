-- 보고서(posts)에 동영상 첨부 경로(video_path) 추가 + 비공개 버킷 reports-video 생성.
--
-- 배경: 우즈벡 투란법인 건설·준비현황처럼 **영상 자체가 본체**인 사내 자료를 게시판에서
-- 페이지를 떠나지 않고 재생해 달라는 요구(2026-08-28). 지금 경로는 유튜브 임베드
-- (```youtube 블록)뿐이라 외부에 올릴 수 없는 사내 영상은 실을 방법이 없었다.
--
-- 설계: html_path 와 같은 패턴 — 컬럼에는 비공개 버킷 객체 키만 담고, 재생은 인증 프록시
-- /api/reports/[id]/video 가 역할 게이트(canAccessConfidentialReports)를 건 뒤
-- **단기 서명 URL 로 302 리다이렉트**한다. 컬럼은 nullable — 기존 행은 전부 NULL.
--
-- 왜 프록시가 바이트를 직접 흘리지 않는가(html_path 와 다른 점): HTML 은 수 MB 라
-- download() 로 통째 스트리밍해도 되지만 영상은 100MB 안팎이고 브라우저가 탐색할 때마다
-- Range 요청을 새로 던진다. 서버리스 함수로 그걸 다 중계하면 실행시간·대역폭이 터지고
-- 구간 탐색도 안 된다. 서명 URL 은 Storage 가 Range 를 직접 처리한다.
--
-- 왜 새 버킷인가: reports 버킷은 public=true 라 URL 만 알면 로그인 없이 열리고,
-- allowed_mime_types 가 pdf/png 로 제한돼 있어 영상 업로드 자체가 거부된다.
--
-- ⚠️ allowed_mime_types 는 지정하지 않는다(NULL = 전체 허용) — reports 버킷이 재사용
--    불가가 된 그 실수를 반복하지 않는다. 대신 file_size_limit 로 상한만 둔다.

ALTER TABLE posts ADD COLUMN video_path TEXT;

COMMENT ON COLUMN posts.video_path IS
  '첨부 동영상의 reports-video(비공개) 버킷 객체 키. NULL 이면 첨부 없음. '
  '재생은 인증 프록시 /api/reports/[id]/video 로만 — anon 직접 접근 불가. '
  '업로드본은 웹 재생용으로 재인코딩한 H.264/AAC MP4 여야 하고 반드시 '
  '-movflags +faststart 로 moov atom 을 앞으로 보낸다(없으면 파일을 다 받기 전까지 '
  '재생이 시작되지 않는다). 원본 촬영본(수백 MB)을 그대로 올리지 말 것. 2026-08-28 신설.';

-- 비공개 Storage 버킷 (public=false). 정책 없음 → anon 차단, service_role 전용.
-- 512MB 상한: 재인코딩본 100MB 안팎 + 여유. 무료 플랜 Storage 총량 1GB 를 한 파일이
-- 삼키지 않게 막는 안전장치다.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('reports-video', 'reports-video', false, 536870912)
ON CONFLICT (id) DO NOTHING;
