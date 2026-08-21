-- 보고서(posts)에 원본 HTML 첨부 경로(html_path) 추가 + 비공개 버킷 reports-html 생성.
--
-- 배경: 전략개발실 덱처럼 자체 디자인을 가진 HTML 보고서를 게시판에서 **원본 그대로**
-- 보여 달라는 요구가 있었다. 지금 상세 화면은 마크다운 본문(content)과 public 버킷
-- reports 의 PDF 링크뿐이라 원본 레이아웃이 남지 않는다.
--
-- 설계: 새 컬럼 html_path 에 비공개 버킷 객체 키만 담고, 열람은 인증 프록시
-- /api/reports/[id]/html 이 역할 게이트(canAccessConfidentialReports)를 건 뒤 스트리밍한다.
-- 컬럼은 nullable — 기존 행은 전부 NULL 이라 화면 동작이 변하지 않는다.
--
-- 왜 새 버킷인가: 기존 reports 버킷은 public=true 라 URL 만 알면 로그인 없이 열린다
-- (상세 페이지가 /storage/v1/object/public/reports 로 PDF 를 직접 링크한다).
-- 사외비 HTML 을 거기 두면 그대로 유출된다 → org-charts·management-excel 과 같은
-- 비공개 버킷 패턴을 따른다.
--
-- 왜 file_path 를 재사용하지 않는가: 그 컬럼은 COMMENT 에 'PDF만' 이라고 의미가 박혀
-- 있고, 상세 페이지의 buildReportDownloadUrl 이 그 값으로 **공개 URL** 을 만든다.
-- 재사용하면 사외비 HTML 이 공개 링크로 새어 나간다.
--
-- ⚠️ 새 버킷에 allowed_mime_types 를 지정하지 않는다(NULL = 전체 허용).
--    reports 버킷이 pdf/png 제한 때문에 재사용 불가가 된 그 실수를 반복하지 않기 위해서다.
--
-- ⚠️ RLS 는 손대지 않는다: posts_select_public 은 행 필터(is_confidential = false)이고
--    컬럼 추가와 무관하다.

ALTER TABLE posts ADD COLUMN html_path TEXT;

COMMENT ON COLUMN posts.html_path IS
  '원본 HTML 보고서의 reports-html(비공개) 버킷 객체 키. NULL 이면 첨부 없음. '
  '열람은 인증 프록시 /api/reports/[id]/html 로만 — anon 직접 접근 불가. '
  'HTML 은 self-contained(인라인 CSS/JS + data URI) 여야 한다: iframe 안의 상대경로는 '
  '/api/reports/<id>/html 기준으로 해석돼 깨진다. 인코딩은 UTF-8(BOM 없음) — 프록시가 '
  'charset=utf-8 을 강제하므로 CP949/EUC-KR 파일은 meta 태그가 있어도 통째로 깨진다. '
  '스크립트가 아닌 사람이 올릴 때는 관리자가 내용을 직접 확인한 파일만 올린다(같은 origin 에서 '
  '스크립트가 실행되므로 신뢰 경계가 PDF 첨부와 다르다). 2026-08-21 이전 행은 전부 NULL.';

-- 비공개 Storage 버킷 (public=false). 정책 없음 → anon 차단, service_role 전용.
INSERT INTO storage.buckets (id, name, public)
VALUES ('reports-html', 'reports-html', false)
ON CONFLICT (id) DO NOTHING;
