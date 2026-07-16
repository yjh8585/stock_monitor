-- MarkLines OEM 글로벌 생산량 (모델 × 생산국 × 월) — /management/stellantis 차트 1 소스.
--
-- 배경: 매출 전망 탭이 '재고 증감'을 두 경로로 본다.
--   ① 생산 − 소매  (월별, MarkLines 단일 소스)      → 이 테이블 (신규)
--   ② 출하 − 소매  (분기별, Stellantis IR 공식 출하) → stellantis_shipments (기존)
-- ②가 딜러 재고의 정확한 항등식이지만 분기·지역 단위뿐이라 최신 분기가 늘 비어 있다.
-- ①은 월별로 즉시 갱신되고 같은 소스(MarkLines)라 스코프가 자동으로 맞는 대신,
-- '생산국 ≠ 판매국'이라 북미 밖 수출입이 갭에 섞인다(아래 country 주석 참고).
--
-- 소스: marklines.com/en/vehicle_production/search — 판매 export와 **같은 계약·같은 레이아웃**.
--   판매: Country/Group/Maker/Type/Segment/Model/**PowerTrain** + 월 컬럼 (메타 7열)
--   생산: Country/Group/Maker/Type/Segment/Model               + 월 컬럼 (메타 6열, PT 없음)
--   → import_oem_production.py가 6열을 전제로 파싱한다. PowerTrain mix는 생산엔 없다.
--
-- ⚠️ country = **생산(공장) 국가**이지 판매 시장이 아니다. 판매 테이블
--   (oem_sales_model_country_month)의 country는 **판매 시장**이라 의미가 정반대다.
--   같은 'USA'라도 한쪽은 "미국 공장에서 만든 대수", 다른 쪽은 "미국에서 팔린 대수"다.
--   두 테이블을 조인·차감할 때 이 비대칭을 반드시 의식할 것 — 북미 생산분의 유럽 수출과
--   북미 판매분의 유럽 수입이 갭에 섞이며, 실측상 그 순합은 북미 판매의 약 +3%다.
--
-- 그룹명 이력: 2020년은 'FCA', 2021년부터 'Stellantis'(PSA 합병 2021-01 완료).
--   북미 한정으로는 PSA의 생산·판매가 사실상 없어 스코프가 연속이지만, 글로벌 집계에서는
--   2020↔2021 사이에 단절이 있다. 조회 시 .in('oem_group', ['Stellantis','FCA']) 필요.
--
-- 행 수: 전 그룹 2020.01~2026.06 기준 약 133K행 (판매 952K행의 1/7 — 한 차종이 팔리는 나라는
--   많아도 만드는 나라는 1~2곳뿐이라 조합이 훨씬 적다). 사전 집계 뷰 없이 직접 조회해도 무방.
--
-- 공개 데이터(구독 리서치이나 개별 수치는 IR·정부 통계 공개분) → 기존 판매 테이블과 동일하게
--   anon read 허용. 사외비 아님.
create table if not exists public.oem_production_model_country_month (
  oem_group  text   not null default '',
  country    text   not null default '',
  model      text   not null default '',
  year_month int    not null,
  production bigint not null,
  primary key (oem_group, country, model, year_month)
);

create index if not exists idx_oem_prod_mcm_model
  on public.oem_production_model_country_month (model, year_month);
create index if not exists idx_oem_prod_mcm_country
  on public.oem_production_model_country_month (country, year_month);
-- 스텔란티스 탭이 (group, country) 필터 + year_month 정렬로 조회한다.
create index if not exists idx_oem_prod_mcm_group_country
  on public.oem_production_model_country_month (oem_group, country, year_month);

alter table public.oem_production_model_country_month enable row level security;

create policy anon_read_oem_production_model_country_month
  on public.oem_production_model_country_month for select to anon using (true);

create policy service_write_oem_production_model_country_month
  on public.oem_production_model_country_month for all to service_role
  using (true) with check (true);
