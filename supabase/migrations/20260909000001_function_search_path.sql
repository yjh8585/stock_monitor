-- Supabase Security Advisor 경고 `function_search_path_mutable` (WARN) 해소.
-- 트리거 함수 3개에 search_path 가 고정돼 있지 않았다. 고정하지 않으면 호출자의
-- search_path 를 그대로 따르므로, 같은 이름의 함수·테이블을 앞선 스키마에 심어
-- 트리거가 그것을 부르게 만드는 공격이 이론상 가능하다(search_path 하이재킹).
--
-- 세 함수 모두 public 테이블과 내장 함수(now·unnest·array_length)만 쓴다.
-- pg_catalog 는 항상 암묵적으로 먼저 검색되므로 public, pg_temp 만 명시하면 된다.
-- 본문 변경은 없다 — ALTER FUNCTION 으로 설정만 붙인다.
--
-- pg_temp 를 마지막에 두는 이유: 임시 스키마가 검색 순서 앞에 오면 같은 공격이
-- 임시 테이블로 재현되므로, 맨 뒤로 밀어 둔다(Supabase 권장 형태).

alter function public.trg_auto_page_mapping() set search_path = public, pg_temp;
alter function public.management_uploads_set_updated_at() set search_path = public, pg_temp;
alter function public.skip_identical_update() set search_path = public, pg_temp;
