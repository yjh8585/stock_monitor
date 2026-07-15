-- 스텔란티스 북미 출하 + Cox 브랜드별 딜러 재고 — /management/stellantis 매출 전망 탭 소스.
--
-- 배경: 주거래처 Stellantis NA향 자사 매출을 예측하려면 3축이 필요하다.
--   ① 출하(도매)  → 이 마이그레이션의 stellantis_shipments   (신규)
--   ② 소매 판매    → 기존 stellantis_na_sales(미국·분기, prnewswire 정본)
--                    + oem_sales_model_country_month(MarkLines 월별, 캐나다·멕시코 포함)
--   ③ 딜러 재고    → 이 마이그레이션의 cox_brand_inventory     (신규)
-- '출하 − 소매 = 딜러 재고 증감' 항등식으로 재고 축적/소진을 진단하고, Cox 실측으로 교차검증한다.
--
-- 두 테이블 모두 **공개 데이터**(IR 공시 / 무료 리서치 발표) → RLS anon read 허용.
-- 자사 매출만 사외비이며 그것은 pnl_entries(default deny) 그대로 사용한다.

-- ---------------------------------------------------------------------------
-- 1) stellantis_shipments — Stellantis IR consolidated shipments (도매)
-- ---------------------------------------------------------------------------
-- 출처: SEC EDGAR 6-K exhibit (stellantisnvq{N}{YYYY}pressrel.htm / ...fy{YYYY}...).
--   data.sec.gov/submissions/CIK0001605484.json 로 발견. UA 헤더 필수(없으면 403).
--   stellantis.com 직접 경로는 Akamai가 curl/requests를 403 차단 → 쓰지 않는다.
--
-- 지표 정의(원문): "The term 'shipments' describes the volume of vehicles delivered to
--   dealers, distributors, or directly from the Company to retail and fleet customers,
--   which drive revenue recognition."
--   → stellantis_na_sales(소매+플릿 최종고객 인도)와 **다른 지표**다. 혼동 금지.
--
-- 단위 주의: IR이 'Shipments (000s)' 천대 반올림 → 원자료 오차 ±500대.
--   여기엔 대(units)로 환산해 저장한다(×1000).
--
-- is_derived: 지역별 절대값 표가 실린 실적 PR은 **Q1 / H1 / Q3 / FY 4회만** 나온다(반기 보고 체제).
--   따라서 Q2 = H1 − Q1, Q4 = FY − H1 − Q3로 차분 도출하며 오차가 ±1,000대로 누적된다 → true 표시.
--   **2026 이후에도 이 체계는 그대로다.** (2026-02부터 추가된 분기 'Estimated Consolidated
--   Shipments' 릴리스는 산문 증감뿐이고 지역별 절대값 표가 없다 — 2026-07-15 SEC 원문 확인.
--   2026Q1에 절대값이 있는 건 원래부터 있던 Q1 실적 PR 때문이지 분기 표 신설 때문이 아니다.)
--   → 최신 분기 출하는 해당 H1/FY PR이 나올 때까지 비어 있는 게 정상이다.
--
-- 도출식 검증(2026-07-15): FY PR이 별도로 싣는 H2 표(스크립트가 읽지 않는 독립 소스)와 대조 →
--   Q3 + 도출Q4 == H2 가 2021~2025 **5개 연도 전부 오차 0**. Q3 PR의 YTD 열 == H1 + Q3 도 3/3 일치.
--
-- region: IR 세그먼트명 원문. 'North America'는 미국+캐나다+멕시코이며 **마세라티 제외**
--   (마세라티는 별도 세그먼트). 소매와 대비할 때 스코프를 맞출 것.
create table if not exists public.stellantis_shipments (
  region          text        not null,
  period_type     text        not null default 'quarter' check (period_type in ('quarter')),
  year_period     text        not null,
  shipments_units integer     not null check (shipments_units >= 0),
  is_derived      boolean     not null default false,
  source_url      text,
  filing_date     date,
  collected_at    timestamptz not null default now(),
  primary key (region, period_type, year_period)
);

create index if not exists idx_stellantis_shipments_period
  on public.stellantis_shipments (period_type, year_period);

alter table public.stellantis_shipments enable row level security;

create policy anon_read_stellantis_shipments
  on public.stellantis_shipments for select to anon using (true);

create policy service_write_stellantis_shipments
  on public.stellantis_shipments for all to service_role
  using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 2) cox_brand_inventory — Cox Automotive 브랜드별 신차 재고일수 (days' supply)
-- ---------------------------------------------------------------------------
-- 출처: coxautoinc.com/insights/{month}-{YYYY}-new-vehicle-inventory/ (무료·무로그인).
--
-- gotcha (실측 확인):
--   - CSV/XLSX 첨부에는 **산업 전체 수치만** 있고 브랜드 분해가 없다. 브랜드별 재고일수는
--     기사 본문의 **차트 JPEG 안에만** 존재 → 이미지 vision 판독으로 추출한다.
--   - 이미지 파일명이 매월 제각각(May-New-Inventory-Brand.jpeg / April-2026-Inventory.jpg ...)
--     → URL 조립 불가. 기사 페이지를 스크래핑해 이미지 링크를 찾아야 한다.
--   - **과거 수치가 소급 수정된다** (2025-05 재고: Dec-2025 발표 2,503,529 → May-2026 발표
--     2,560,104). 따라서 최근 2~3개월은 매번 재적재(upsert)한다.
--   - Fiat·Alfa Romeo는 물량 미달로 차트에 없다(스텔란티스 4개 브랜드만: Jeep/Ram/Dodge/Chrysler).
--   - 정의: in-transit/pipeline 포함 재고 기준.
--
-- brand: 차트 라벨 원문 그대로. 업계 평균 행은 'NATION'.
--   스텔란티스 4개 브랜드 외 타 브랜드도 함께 적재한다(같은 이미지에서 공짜로 나오고,
--   업계 대비 위치를 봐야 재고일수의 의미가 산다).
create table if not exists public.cox_brand_inventory (
  brand        text        not null,
  year_month   integer     not null check (year_month between 200001 and 299912),
  days_supply  integer     not null check (days_supply >= 0),
  source_url   text,
  image_url    text,
  collected_at timestamptz not null default now(),
  primary key (brand, year_month)
);

create index if not exists idx_cox_brand_inventory_ym
  on public.cox_brand_inventory (year_month);

alter table public.cox_brand_inventory enable row level security;

create policy anon_read_cox_brand_inventory
  on public.cox_brand_inventory for select to anon using (true);

create policy service_write_cox_brand_inventory
  on public.cox_brand_inventory for all to service_role
  using (true) with check (true);
