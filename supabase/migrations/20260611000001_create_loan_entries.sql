-- 이인텔리전스(자회사) 대여금 계획·실적 (사외비). 단위: 억원.
-- 소스: 자료정리_월별손익*.xlsx '이인텔리전스' 시트 (연도|월|계획/실적|대여금(억원)).
-- RLS enable + 정책 없음(default deny) → anon 직접 접근 불가, 서버는 confidentialDb(service_role) 전용.
create table public.loan_entries (
  period_year   integer not null,
  period_month  integer not null check (period_month between 1 and 12),
  kind          text    not null check (kind in ('계획', '실적')),
  loan_eok      numeric,
  primary key (period_year, period_month, kind)
);

alter table public.loan_entries enable row level security;

comment on table public.loan_entries is
  '이인텔리전스 자회사 대여금 계획·실적(억원). 사외비 — RLS default deny, confidentialDb 전용.';
