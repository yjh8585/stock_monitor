-- 2026-08-25 작업에서 남긴 백업 테이블 2개가 RLS 없이 public 스키마에 있어
-- anon 키로 읽히고 있었다(Supabase Security Advisor ERROR `rls_disabled_in_public`).
--   research_reports_dropped_20260825  — 옛 규격 증권사 리포트 정리본 251행
--   humanoid_customers_reverted_20260825 — 결정12 위반으로 되돌린 휴머노이드 고객사
-- 코드는 두 테이블을 읽지 않는다(주석·문서에만 언급) → RLS enable + 정책 없음(default deny).
-- service_role 은 RLS 를 우회하므로 나중에 복구용으로 꺼내 쓰는 데는 지장이 없다.

alter table public.research_reports_dropped_20260825 enable row level security;
alter table public.humanoid_customers_reverted_20260825 enable row level security;

comment on table public.research_reports_dropped_20260825 is
  '2026-08-25 정리에서 삭제한 옛 규격 리포트 백업. RLS default deny — service_role 전용.';
comment on table public.humanoid_customers_reverted_20260825 is
  '2026-08-25 결정12 위반 수집을 되돌리며 남긴 백업. RLS default deny — service_role 전용.';
