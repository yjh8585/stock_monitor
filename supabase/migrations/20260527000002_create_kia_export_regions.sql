-- 기아 지역별 수출 (region × vehicle_type) — Phase 1.
--
-- 출처: "YYYY 지역별수출실적.xlsx" (export.xlsx)
--   region 10: U.S. / Canada / Mexico / EU+EFTA / E.Europe·CIS / Latin America / Middle East·Africa / Asia·Pacific / India / China
--   vehicle_type 6: Passenger Car / Recreational Vehicle / Commercial Vehicle / Special Vehicle / CKD(excl Special) / CKD(Special)
--
-- kia_sales의 region='수출' Total과 본 테이블 region 합이 일치해야 함 (Total 행으로 cross-check).
-- 즉 export 엑셀은 sales-by-model '수출' Total을 region+type 차원으로 펼친 것 — sales 본 테이블 region='수출'과 더하면 안 됨(double counting).
--
-- source 컬럼은 향후 확장 대비 (분기 PDF region별 도매가 있으면 'ir-quarterly' 추가).
-- 현대차의 ir-summary(hover API)는 Kia에 없음 (model 엑셀 자체에 포함).
--
-- 단위: 대(Units) — 엑셀 원본 단위 그대로.

CREATE TABLE IF NOT EXISTS kia_export_regions (
  period_type   text NOT NULL DEFAULT 'month'
                     CHECK (period_type IN ('month', 'annual', 'quarter')),
  year_period   text NOT NULL DEFAULT '',           -- 'YYYY-MM' | 'YYYY' | 'YYYY-QN'
  source        text NOT NULL DEFAULT 'export-by-region'
                     CHECK (source IN ('export-by-region', 'ir-quarterly')),
  region_name   text NOT NULL DEFAULT '',           -- 'U.S.'/'Canada'/'Mexico'/'EU+EFTA'/'E.Europe/CIS'/'Latin America'/'Middle East/Africa'/'Asia/Pacific'/'India'/'China'
  vehicle_type  text NOT NULL DEFAULT '',           -- 'Passenger Car'/'Recreational Vehicle'/'Commercial Vehicle'/'Special Vehicle'/'CKD(excl Special)'/'CKD(Special)' | '' (분기 PDF region 합)
  sales_units   integer NOT NULL DEFAULT 0,
  source_url    text NULL,
  collected_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (period_type, year_period, source, region_name, vehicle_type)
);

CREATE INDEX IF NOT EXISTS idx_kia_export_regions_period
  ON kia_export_regions(year_period, source);
CREATE INDEX IF NOT EXISTS idx_kia_export_regions_region
  ON kia_export_regions(region_name, year_period);

ALTER TABLE kia_export_regions ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_read_kia_export_regions
  ON kia_export_regions FOR SELECT TO anon USING (true);

CREATE POLICY service_write_kia_export_regions
  ON kia_export_regions FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE kia_export_regions IS
  '기아 지역별 수출 (region × vehicle_type 분해). 출처: worldwide.kia.com IR ''지역별수출실적'' 엑셀. region 10개 × vehicle_type 6개. kia_sales의 region=''수출'' Total을 펼친 것이므로 동시 적재 시 sales와 더하면 double counting. source=''ir-quarterly''는 향후 분기 IR PDF region 도매 표 추가용(현대차 패턴). 단위=대.';
COMMENT ON COLUMN kia_export_regions.region_name IS
  '엑셀 영문 region 그대로. 사용자 차트에서는 한글 라벨(미국/캐나다/멕시코/유럽/...)로 매핑.';
COMMENT ON COLUMN kia_export_regions.vehicle_type IS
  'Passenger Car/Recreational Vehicle/Commercial Vehicle/Special Vehicle/CKD(excl Special)/CKD(Special). CKD 2종은 별개 region 합계와 중복되지 않도록 별도 type으로 격리.';
