-- 영업본부 중장기 매출 전망 (사외비). 단위: 백만원.
-- 소스: '(260624) 영업본부 중장기 매출 계획.xlsx' 시트 '연도별 Booked 매출' 요약표(B2:H11).
-- 기준(basis_year/basis_quarter)별 × 계열(series) 3종 × 전망 연도(period_year) 5개 = 30행 규모.
-- 엑셀 'N/A'(예: 2026.1Q의 '고객 EDI 100%')는 value_mwon = null.
-- fx_note는 시트 B2 원문 1줄 — 시트에 하나뿐이라 전 행 동일값 중복 저장(30행 규모, 조인 회피).
-- RLS enable + 정책 없음(default deny) → anon 직접 접근 불가, 서버는 confidentialDb(service_role) 전용.
create table public.longterm_revenue_plan (
  basis_year    integer not null,
  basis_quarter integer not null check (basis_quarter between 1 and 4),
  series        text    not null check (series in ('수주 Volume', '고객 EDI 100%', '한세 전망')),
  period_year   integer not null,
  value_mwon    numeric,
  fx_note       text,
  primary key (basis_year, basis_quarter, series, period_year)
);

alter table public.longterm_revenue_plan enable row level security;

comment on table public.longterm_revenue_plan is
  '영업본부 중장기 매출 전망(백만원). 사외비 — RLS default deny, confidentialDb 전용.';
