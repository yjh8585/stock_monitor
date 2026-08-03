-- 중복·미사용 인덱스 제거 (2026-08-03)
--
-- 배경: Supabase Free 플랜 용량 초과(디스크 1.59GB / 한도 1.1GB) 대응.
--   실측 결과 테이블 총량 461MB 중 인덱스가 251MB로 절반 이상을 차지했다.
--
-- 제거 대상과 근거:
--   1) idx_stock_prices_company_date (23MB)
--      PK stock_prices_pkey(company_id, trade_date)와 컬럼 구성이 동일하고 정렬 방향만 DESC다.
--      btree 인덱스는 역방향 스캔이 가능하므로 PK가 그대로 대체한다.
--   2) idx_quotes_5min_company_ts (8.5MB)
--      PK stock_quotes_5min_pkey(company_id, ts)와 동일. 위와 같은 이유.
--   3) idx_oem_prod_mcm_model (5.9MB)
--      pg_stat_user_indexes 기준 생성 이래 idx_scan = 0 (사용 이력 없음).
--
-- 되돌리기: 파일 하단 주석의 CREATE INDEX 문을 실행하면 원복된다.

drop index if exists public.idx_stock_prices_company_date;
drop index if exists public.idx_quotes_5min_company_ts;
drop index if exists public.idx_oem_prod_mcm_model;

-- 원복용 (필요 시 실행):
-- create index idx_stock_prices_company_date
--   on public.stock_prices using btree (company_id, trade_date desc);
-- create index idx_quotes_5min_company_ts
--   on public.stock_quotes_5min using btree (company_id, ts desc);
-- create index idx_oem_prod_mcm_model
--   on public.oem_production_model_country_month using btree (model, year_month);
