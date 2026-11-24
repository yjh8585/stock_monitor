-- 나를 찾아서 응시 기록 — stock_monitor 프로젝트(tvexumxeobciihlqncal)에 적용 (2026-11-24)
-- 응시자(anon)는 쓰기만 가능, 읽기는 대시보드(관리자)에서만.

create table if not exists public.psycho_submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 30),
  age smallint not null check (age between 1 and 120),
  consent boolean not null check (consent),
  answers boolean[] not null check (cardinality(answers) = 100),
  result jsonb not null check (pg_column_size(result) < 4000)
);

comment on table public.psycho_submissions is '나를 찾아서 심리검사 응시 기록 (이름·나이·100문항 답·채점 결과). 민감정보 포함 — anon 은 insert 만.';

alter table public.psycho_submissions enable row level security;

-- 읽기·수정·삭제 정책은 두지 않는다 → anon/authenticated 는 조회 불가
revoke all on public.psycho_submissions from anon, authenticated;
grant insert on public.psycho_submissions to anon;

create policy "응시자는 제출만 가능" on public.psycho_submissions
  for insert to anon with check (true);
-- SHORTCUT: 제출 횟수 제한 없음(같은 사람이 반복 제출 가능) → 스팸이 생기면 Edge Function + 속도 제한으로 이관
