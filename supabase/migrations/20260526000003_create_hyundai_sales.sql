-- 현대차 차종별 판매 (PR3) — 회사별 테이블 4개 중 2번째.
--
-- 출처: hyundai.com/worldwide/ko/company/ir/ir-resources/sales-results
-- 엑셀 3종 (button.btn-download):
--  (1) 차종별 매출실적 — region=내수/수출, vehicle_model, sales_units
--  (2) 해외 공장별 판매 — factory(앨라배마/베이징 등), vehicle_model, sales_units
--  (3) 지역별 수출실적 — region(북미/유럽/중국/...), sales_units (vehicle_model 합산)
-- → 단일 hyundai_sales 테이블에 모든 dimension 통합. factory='' = 국내/총합.
--
-- 수집: scripts/collect_hyundai_sales.py (Playwright expect_download + openpyxl)
-- KG(20260526000002) 패턴 따름: PK=dimension 조합, RLS anon SELECT + service_role ALL.

CREATE TABLE IF NOT EXISTS hyundai_sales (
  period_type   text    NOT NULL DEFAULT 'month'
                        CHECK (period_type IN ('month', 'quarter', 'annual')),
  year_period   text    NOT NULL DEFAULT '',   -- 'YYYY-MM' | 'YYYY-Q1' | 'YYYY'
  region        text    NOT NULL DEFAULT '',   -- '내수' | '수출' | '북미' | '유럽' | '중국' | ...
  factory       text    NOT NULL DEFAULT '',   -- 해외 공장명 | '' = 국내/총합
  vehicle_model text    NOT NULL DEFAULT '',   -- 그랜저 | 싼타페 | 아이오닉5 등
  vehicle_type  text    NOT NULL DEFAULT '',   -- SUV | 세단 | 친환경 등
  powertrain    text    NULL,                  -- vehicle_powertrain_map 조인용. NULL = 미매핑
  sales_units   integer NOT NULL,
  source_url    text    NULL,
  collected_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (period_type, year_period, region, factory, vehicle_model)
);

CREATE INDEX IF NOT EXISTS idx_hyundai_sales_period
  ON hyundai_sales(year_period);
CREATE INDEX IF NOT EXISTS idx_hyundai_sales_model
  ON hyundai_sales(vehicle_model, year_period);
CREATE INDEX IF NOT EXISTS idx_hyundai_sales_factory
  ON hyundai_sales(factory, year_period) WHERE factory <> '';
CREATE INDEX IF NOT EXISTS idx_hyundai_sales_region
  ON hyundai_sales(region, year_period);

ALTER TABLE hyundai_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_read_hyundai_sales
  ON hyundai_sales FOR SELECT TO anon USING (true);

CREATE POLICY service_write_hyundai_sales
  ON hyundai_sales FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE hyundai_sales IS
  '현대차 차종별 판매 (PR3). 출처: hyundai.com IR 엑셀 3종(차종별 매출/해외 공장별/지역별 수출) 통합. factory=해외 공장명 또는 ''(국내). powertrain은 vehicle_powertrain_map 조인.';
