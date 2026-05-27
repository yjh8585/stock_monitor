-- 현대차 미국/유럽 현지(retail) 판매 — Phase 2C.
--
-- 출처: hyundai.com/worldwide/ko/company/ir/ir-resources/sales-results
-- 엑셀 2종 (button.btn-download, hyundai_sales와 같은 페이지):
--  (1) "YYYY년 미국 현지 판매" — sheet 'US', Y2024 US Retail Sales
--       region='US', vehicle_type=PC/RV, vehicle_model, retail_units (월별)
--       + Total industry / Market share (HMA가 발표)
--  (2) "YYYY년 유럽 현지 판매" — sheet 'EU', Y2024 Europe Subsidiary Sales
--       region='EU', vehicle_type=PC/RV/LightCV, vehicle_model, retail_units (월별)
--       industry/share 없음.
--
-- hyundai_sales(도매=wholesale)와 dimension이 겹치지만 retail은:
--   - region='US'/'EU'로 고정(도매의 '내수'/'수출'/'북미'와 의미 다름)
--   - market share/industry_total 컬럼이 retail 고유
--   - 도매 vs 소매 cross-check 시 별도 테이블이 명확
-- → 별도 hyundai_retail_sales 테이블.
--
-- 수집: scripts/collect_hyundai_retail.py (Playwright + openpyxl)

CREATE TABLE IF NOT EXISTS hyundai_retail_sales (
  period_type     text    NOT NULL DEFAULT 'month'
                          CHECK (period_type IN ('month', 'annual')),
  year_period     text    NOT NULL DEFAULT '',   -- 'YYYY-MM' | 'YYYY'
  region          text    NOT NULL DEFAULT ''    -- 'US' | 'EU'
                          CHECK (region IN ('US', 'EU')),
  vehicle_type    text    NOT NULL DEFAULT '',   -- 'PC' | 'RV' | 'Light CV' | '' (Total/Industry)
  vehicle_model   text    NOT NULL DEFAULT '',   -- 모델명 | 'Total' | 'Industry' | 'MarketShare'
  retail_units    integer NULL,                  -- 소매 판매 대수 (NULL: MarketShare row)
  market_share    numeric(8, 5) NULL,            -- HMC 점유율 (US 한정, 0~1, 소수 5자리)
  industry_total  integer NULL,                  -- 시장 전체 판매 (US 한정)
  source_type     text    NOT NULL DEFAULT 'hmc-ir',  -- 'hmc-ir' = 현대 IR 엑셀
  source_url      text    NULL,
  collected_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (period_type, year_period, region, vehicle_type, vehicle_model)
);

CREATE INDEX IF NOT EXISTS idx_hyundai_retail_period
  ON hyundai_retail_sales(year_period);
CREATE INDEX IF NOT EXISTS idx_hyundai_retail_region
  ON hyundai_retail_sales(region, year_period);
CREATE INDEX IF NOT EXISTS idx_hyundai_retail_model
  ON hyundai_retail_sales(vehicle_model, year_period) WHERE vehicle_model NOT IN ('Total', 'Industry', 'MarketShare');

ALTER TABLE hyundai_retail_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_read_hyundai_retail_sales
  ON hyundai_retail_sales FOR SELECT TO anon USING (true);

CREATE POLICY service_write_hyundai_retail_sales
  ON hyundai_retail_sales FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE hyundai_retail_sales IS
  '현대차 미국/유럽 현지(소매=retail) 판매. 출처: hyundai.com IR ''미국/유럽 현지 판매'' 엑셀. hyundai_sales(도매)와 dimension 분리. US는 industry_total/market_share 동봉, EU는 retail_units만.';
COMMENT ON COLUMN hyundai_retail_sales.region IS 'US=북미(HMA), EU=유럽 현지법인(HME)';
COMMENT ON COLUMN hyundai_retail_sales.vehicle_model IS '''Total''=전체 합계 row, ''Industry''=US 전체 시장(US only), ''MarketShare''=HMC 점유율 row(US only)';
COMMENT ON COLUMN hyundai_retail_sales.market_share IS '0.0~1.0. MarketShare row에만 채움. 그 외 NULL.';
