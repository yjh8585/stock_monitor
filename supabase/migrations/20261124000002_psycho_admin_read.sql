-- 나를 찾아서 관리자 조회 권한 — stock_monitor 프로젝트(tvexumxeobciihlqncal)에 적용 (2026-11-24)
-- psycho_admins 에 오른 로그인 계정만 psycho_submissions 를 읽는다.
-- 관리자 계정: stock_monitor .env.local 의 ADMIN_ID/ADMIN_PW 로 Supabase Auth 계정을 만들었다
--   (이메일 = <ADMIN_ID 소문자>@psycho-admin.local · 실제 메일은 보내지 않는다 · email_confirm=true).
--   명단 추가: insert into public.psycho_admins (user_id) values ('<auth.users.id>');

create table if not exists public.psycho_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
comment on table public.psycho_admins is '나를 찾아서 관리자 명단 — 여기 있는 계정만 psycho_submissions 를 읽는다. 대시보드/SQL 로만 관리.';
alter table public.psycho_admins enable row level security;
revoke all on public.psycho_admins from anon, authenticated;

-- 명단 테이블은 RLS 로 막혀 있으므로, 「내가 관리자인가」만 답하는 함수를 정의자 권한으로 둔다
create or replace function public.psycho_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.psycho_admins a where a.user_id = (select auth.uid()));
$$;
revoke execute on function public.psycho_is_admin() from public, anon;
grant execute on function public.psycho_is_admin() to authenticated;

grant select on public.psycho_submissions to authenticated;
create policy "관리자만 조회" on public.psycho_submissions
  for select to authenticated using ((select public.psycho_is_admin()));
