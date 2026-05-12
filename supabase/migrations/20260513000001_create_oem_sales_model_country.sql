-- 모델별 × 국가별 × 월별 판매량 사전집계 테이블
-- 북미 핵심 차종(Grand Cherokee, Ram P/U, Pacifica, R1T, R1S, VW Atlas 등) 추이 차트용.
-- 기존 oem_sales_monthly(500K+ 행) 미적재 상태에서 모델 단위 가벼운 집계만 따로 보유.

CREATE TABLE IF NOT EXISTS oem_sales_model_country_month (
  oem_group  text   NOT NULL DEFAULT '',
  country    text   NOT NULL DEFAULT '',
  model      text   NOT NULL DEFAULT '',
  year_month int    NOT NULL,
  sales      bigint NOT NULL,
  PRIMARY KEY (oem_group, country, model, year_month)
);

CREATE INDEX IF NOT EXISTS idx_oem_sales_mcm_model ON oem_sales_model_country_month(model, year_month);
CREATE INDEX IF NOT EXISTS idx_oem_sales_mcm_country ON oem_sales_model_country_month(country, year_month);
