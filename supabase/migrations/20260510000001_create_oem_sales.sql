-- OEM 글로벌 판매량 테이블 (MarkLines 데이터, 2020.01~)
-- 1) oem_sales_monthly: 원시 long 테이블 (Country/Group/Maker/Type/Segment/Model/PowerTrain×월)
-- 2) oem_sales_group_month: Group×월 사전 집계 (KPI/시장추이/TOP10 월별)
-- 3) oem_sales_group_pt_month: Group×PowerTrain×월 (EV대전/PowerTrain Mix)
-- 4) oem_sales_group_country_month: Group×Country×월 (Heatmap, Country TOP15)
-- 5) oem_sales_type_seg_month: Type×Segment×월 (시장 차종 구조)
--
-- 적재 스크립트: scripts/import_oem_sales.py (5개 엑셀 → upsert)
-- PK 컬럼은 NOT NULL DEFAULT ''로 멱등 upsert 보장.

-- ============================================================
-- 1) 원시 long 테이블
-- ============================================================
CREATE TABLE IF NOT EXISTS oem_sales_monthly (
  country      text NOT NULL DEFAULT '',
  oem_group    text NOT NULL DEFAULT '',
  maker        text NOT NULL DEFAULT '',
  vehicle_type text NOT NULL DEFAULT '',
  segment      text NOT NULL DEFAULT '',
  model        text NOT NULL DEFAULT '',
  powertrain   text NOT NULL DEFAULT '',  -- 정규화: ICE/HV/PHEV/EV/FCV/Other
  year_month   int  NOT NULL,             -- e.g. 202403
  sales        int  NOT NULL,
  PRIMARY KEY (country, oem_group, maker, vehicle_type, segment, model, powertrain, year_month)
);

CREATE INDEX IF NOT EXISTS idx_oem_sales_monthly_ym ON oem_sales_monthly(year_month);
CREATE INDEX IF NOT EXISTS idx_oem_sales_monthly_group ON oem_sales_monthly(oem_group, year_month);
CREATE INDEX IF NOT EXISTS idx_oem_sales_monthly_country ON oem_sales_monthly(country, year_month);

-- ============================================================
-- 2) Group×월 집계
-- ============================================================
CREATE TABLE IF NOT EXISTS oem_sales_group_month (
  oem_group  text   NOT NULL,
  year_month int    NOT NULL,
  sales      bigint NOT NULL,
  PRIMARY KEY (oem_group, year_month)
);

CREATE INDEX IF NOT EXISTS idx_oem_sales_gm_ym ON oem_sales_group_month(year_month);

-- ============================================================
-- 3) Group×PowerTrain×월 집계
-- ============================================================
CREATE TABLE IF NOT EXISTS oem_sales_group_pt_month (
  oem_group  text   NOT NULL,
  powertrain text   NOT NULL,
  year_month int    NOT NULL,
  sales      bigint NOT NULL,
  PRIMARY KEY (oem_group, powertrain, year_month)
);

CREATE INDEX IF NOT EXISTS idx_oem_sales_gpt_ym ON oem_sales_group_pt_month(year_month);
CREATE INDEX IF NOT EXISTS idx_oem_sales_gpt_pt ON oem_sales_group_pt_month(powertrain, year_month);

-- ============================================================
-- 4) Group×Country×월 집계
-- ============================================================
CREATE TABLE IF NOT EXISTS oem_sales_group_country_month (
  oem_group  text   NOT NULL,
  country    text   NOT NULL,
  year_month int    NOT NULL,
  sales      bigint NOT NULL,
  PRIMARY KEY (oem_group, country, year_month)
);

CREATE INDEX IF NOT EXISTS idx_oem_sales_gc_ym ON oem_sales_group_country_month(year_month);
CREATE INDEX IF NOT EXISTS idx_oem_sales_gc_country ON oem_sales_group_country_month(country, year_month);

-- ============================================================
-- 5) Type×Segment×월 집계
-- ============================================================
CREATE TABLE IF NOT EXISTS oem_sales_type_seg_month (
  vehicle_type text   NOT NULL,
  segment      text   NOT NULL,
  year_month   int    NOT NULL,
  sales        bigint NOT NULL,
  PRIMARY KEY (vehicle_type, segment, year_month)
);

CREATE INDEX IF NOT EXISTS idx_oem_sales_ts_ym ON oem_sales_type_seg_month(year_month);
