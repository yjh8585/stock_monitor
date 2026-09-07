-- 한 시점(날짜)에 조직도를 여러 장 둘 수 있게 한다.
-- 기존: chart_date 가 기본키 → 2026-07-01 에 '인원 포함' 판과 일반 판을 함께 둘 수 없었다.
-- 변경: 대리키 id 를 기본키로 두고, (chart_date, variant) 를 유일 제약으로 삼는다.
--   variant = 같은 날짜 안에서 장을 구분하는 짧은 슬러그. 기본판은 '' (빈 문자열).
--   image_path 규칙도 이에 맞춘다 — '' 면 '<날짜>.png', 아니면 '<날짜>-<variant>.png'.

alter table public.org_charts
  add column if not exists variant text not null default '';

alter table public.org_charts drop constraint org_charts_pkey;

alter table public.org_charts
  add column id bigint generated always as identity;

alter table public.org_charts
  add constraint org_charts_pkey primary key (id);

alter table public.org_charts
  add constraint org_charts_date_variant_key unique (chart_date, variant);

comment on column public.org_charts.variant is
  '같은 chart_date 안에서 장을 구분하는 슬러그. 기본판은 빈 문자열.';

-- 이미 올라가 있던 2026-07-01 조직도는 인원수가 함께 표기된 판이다(사용자 확인 2026-09-07).
-- 제목에 (인원 포함)을 붙이고 variant·image_path 를 새 규칙으로 옮긴다.
-- Storage 객체는 같은 날 '2026-07-01.png' → '2026-07-01-headcount.png' 로 이동해 두었다.
update public.org_charts
set variant = 'headcount',
    title = '한세모빌리티 조직도 (인원 포함)',
    image_path = '2026-07-01-headcount.png'
where chart_date = '2026-07-01'
  and variant = ''
  and image_path = '2026-07-01.png';
