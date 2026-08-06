-- 보고서(posts)에 사외비 구분 도입.
--
-- 배경: posts 는 지금까지 전 행이 anon 키로 읽혔다(posts_select_all → USING(true)).
-- anon 키는 클라이언트 번들에 노출되므로 로그인 없이도 REST 로 전량 덤프가 가능하다.
-- 사외비 문서(전략개발실 보고 등)를 이 게시판에 올리려면 행 단위 차단이 필요하다.
--
-- 설계: is_confidential = true 인 행은 RLS 에서 anon/authenticated 모두 제외 →
-- service_role(서버 전용 키) 경로로만 읽힌다. 역할 게이트는 앱(permissions.ts)에서 건다.
-- 기존 행은 전부 default false 라 화면 동작은 변하지 않는다.

ALTER TABLE posts ADD COLUMN is_confidential BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN posts.is_confidential IS
  '사외비 여부. true 면 RLS 가 anon/authenticated 읽기를 차단하고 service_role 로만 조회된다(열람 역할은 lib/auth/permissions.ts).';

-- 기존 "전부 허용" 정책을 "사외비 아닌 행만 허용"으로 교체.
-- 이름도 실제 의미에 맞게 바꾼다(posts_select_all 은 더 이상 사실이 아니다).
DROP POLICY IF EXISTS "posts_select_all" ON posts;

CREATE POLICY "posts_select_public" ON posts
  FOR SELECT
  TO anon, authenticated
  USING (is_confidential = false);
