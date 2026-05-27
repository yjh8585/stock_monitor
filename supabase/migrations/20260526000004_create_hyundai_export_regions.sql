-- 현대차 지역별 수출/IR summary 데이터 (Phase 2A) — 별도 테이블.
--
-- 배경: 기존 hyundai_sales의 factory='' 행에 'export-by-region'(U.S.A./Canada/Europe Subs/...)
-- 데이터가 들어가 있었으나 sales-by-model의 '수출' Total과 동일 데이터 → double counting.
-- 별도 테이블로 분리해 hyundai_sales는 sales-by-model + global-plant-sales 만 유지.
--
-- source:
--   'export-by-region' — hmc-export-by-region 엑셀 (한국 출하 → 세부 region별, 모델 합산)
--   'ir-summary'       — IR 사이트 hover 데이터 (도매 기준 9개 region 연 합계, 추가 검증/cross-check용)

CREATE TABLE IF NOT EXISTS hyundai_export_regions (
  period_type   text    NOT NULL DEFAULT 'month'
                        CHECK (period_type IN ('month', 'quarter', 'annual')),
  year_period   text    NOT NULL DEFAULT '',  -- 'YYYY-MM' (export-by-region) | 'YYYY' (ir-summary)
  source        text    NOT NULL
                        CHECK (source IN ('export-by-region', 'ir-summary')),
  region_name   text    NOT NULL DEFAULT '',  -- 'U.S.A.'/'Canada'/'북미'/'국내' 등
  sales_units   integer NOT NULL,
  source_url    text    NULL,
  collected_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (period_type, year_period, source, region_name)
);

CREATE INDEX IF NOT EXISTS idx_hyundai_export_regions_year
  ON hyundai_export_regions(year_period, source);
CREATE INDEX IF NOT EXISTS idx_hyundai_export_regions_region
  ON hyundai_export_regions(region_name, year_period);

ALTER TABLE hyundai_export_regions ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_read_hyundai_export_regions
  ON hyundai_export_regions FOR SELECT TO anon USING (true);

CREATE POLICY service_write_hyundai_export_regions
  ON hyundai_export_regions FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE hyundai_export_regions IS
  '현대차 지역별 수출 (Phase 2A) — source=export-by-region(한국 출하 세부 region 월별, hmc-export-by-region.xlsx) + ir-summary(IR 사이트 9개 region 연 합계, salesPerformanceSummary API). hyundai_sales와 별개로 hyundai_sales=sales-by-model+global-plant-sales만 유지하고 export region은 본 테이블 단독.';

-- hyundai_sales에서 export region 행 제거 (이미 적재된 데이터 cleanup)
DELETE FROM hyundai_sales WHERE factory = '' AND region NOT IN ('내수', '수출');
