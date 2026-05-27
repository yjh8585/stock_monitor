-- 기아 현지판매실적 (retail by region) — Phase 1.
--
-- 출처: worldwide.kia.com/ko/company/investor-relations/library/performance-and-plans/
--   JSON API: /api/investors/business-sales-results?language=ko&year={Y}
--   type='sales' 항목의 files[].title='YYYY 현지판매실적.xlsx'.
--
-- 엑셀 구조: 13 sheets (Total + Jan~Dec).
--   각 sheet 컬럼: Model/Plant + Total + Korea + U.S.A + Canada + Mexico + Europe(*)
--                + Eastern Europe + Latin America + Middle East + Africa
--                + Asia Pacific + India + China  (총 13 region)
--   행: 모델 row (D열 vehicle_model + 12개 region) +
--       Plant section header (B열 'Korea Plants'/'U.S. Plant'/'Europe Plant'/'India Plant'/...).
--
-- 한 row = (period, plant, vehicle_model, region) 단위 retail.
-- region='Total'은 적재 안 함 (12 region 합으로 도출 가능 + cross-check 용도로만).
--
-- 단위: 대(Units).
-- *Europe = West Europe (영국·독일·프랑스 등). Eastern Europe = 동유럽(러시아 포함 시기 차이).
--
-- vs kia_sales 관계:
--   kia_sales = 도매(wholesale) 출하 — 공장이 출하한 시점 기준.
--   kia_retail_sales = 소매(retail) — 현지에서 소비자에게 인도된 시점.
--   차이 = 재고 변동. 같은 plant·model이라도 retail != wholesale.

CREATE TABLE IF NOT EXISTS kia_retail_sales (
  period_type    text NOT NULL DEFAULT 'month'
                      CHECK (period_type IN ('month', 'annual')),
  year_period    text NOT NULL DEFAULT '',          -- 'YYYY-MM' (월) | 'YYYY' (연간 Total sheet)
  plant          text NOT NULL DEFAULT '',          -- 'Korea Plants' | 'U.S. Plant' | 'Europe Plant' | 'India Plant' | 'Mexico Plant' | 'China Plants' | 'Slovakia Plant' | ...
  vehicle_model  text NOT NULL DEFAULT '',          -- 모델명 (NFC normalize). 'Morning / Picanto' 같이 한국/글로벌 표기 같이 들어가는 케이스 보존.
  region         text NOT NULL DEFAULT ''           -- 12 region 중 하나
                      CHECK (region IN ('Korea', 'U.S.A', 'Canada', 'Mexico', 'Europe', 'Eastern Europe', 'Latin America', 'Middle East', 'Africa', 'Asia Pacific', 'India', 'China')),
  retail_units   integer NOT NULL DEFAULT 0,
  source_url     text NULL,
  collected_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (period_type, year_period, plant, vehicle_model, region)
);

CREATE INDEX IF NOT EXISTS idx_kia_retail_period
  ON kia_retail_sales(year_period);
CREATE INDEX IF NOT EXISTS idx_kia_retail_plant
  ON kia_retail_sales(plant, year_period);
CREATE INDEX IF NOT EXISTS idx_kia_retail_model
  ON kia_retail_sales(vehicle_model, year_period);
CREATE INDEX IF NOT EXISTS idx_kia_retail_region
  ON kia_retail_sales(region, year_period);

ALTER TABLE kia_retail_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_read_kia_retail_sales
  ON kia_retail_sales FOR SELECT TO anon USING (true);

CREATE POLICY service_write_kia_retail_sales
  ON kia_retail_sales FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE kia_retail_sales IS
  '기아 현지판매실적 (retail by region) — 12 region × plant × vehicle_model × month/annual. 출처: worldwide.kia.com IR ''현지판매실적.xlsx'' (13 sheets: Total + Jan~Dec). region=''Total''은 적재 안 함 (12 region 합 도출 + cross-check 용도). 단위=대. vs kia_sales(도매) — retail은 소비자 인도 시점 기준이라 재고 변동만큼 차이.';
COMMENT ON COLUMN kia_retail_sales.plant IS
  '엑셀의 plant section header. Korea Plants(한국 공장 종합) / U.S. Plant(조지아) / Europe Plant(슬로바키아) / India Plant(아난타푸르) / Mexico Plant / China Plants / etc. 연도별로 출현하는 plant 다를 수 있음.';
COMMENT ON COLUMN kia_retail_sales.vehicle_model IS
  '모델명 NFC normalize. ''Morning / Picanto'' / ''Pride / Rio'' 같이 한국·글로벌 양식 같이 표기되는 경우 그대로 보존.';
COMMENT ON COLUMN kia_retail_sales.region IS
  '12 region. *Europe = West Europe (영국·독일·프랑스 등). Eastern Europe = 러시아 시기 차이.';
