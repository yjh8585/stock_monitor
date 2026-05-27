-- Stellantis North America 분기 판매 — PR5 (FCA US LLC, prnewswire 보도자료).
--
-- 출처: https://www.prnewswire.com/news/fca-us-llc (publisher index)
--   분기당 1개 보도자료 (release_id 9자리 cision ID).
--   2020Q4~2026Q1 22분기 전수 가용 (audit 검증 완료).
--
-- 본문: HTML <table> 1개에 brand × model 매트릭스
--   컬럼: Model | Q current | Q prior | Q YoY% | CYTD current | CYTD prior | CYTD YoY%
--   brand 6: Jeep / Ram / Chrysler / Dodge / Fiat / Alfa Romeo (Maserati 별도 PR)
--   모델 30~35개/분기 + brand 합계 + 회사 합계
--
-- 5년 backfill 700~800행 예상. 현대/기아 대비 압도적으로 단순.
--
-- 단위: 대(Units) — 보도자료 원본 단위.
-- 결산월: 12월 (Stellantis 본사 NL/IT, NA는 12월).

CREATE TABLE IF NOT EXISTS stellantis_na_sales (
  period_type      text NOT NULL DEFAULT 'quarter'
                        CHECK (period_type IN ('quarter', 'year')),
  year_period      text NOT NULL DEFAULT '',          -- 'YYYY-QN' | 'YYYY'
  brand            text NOT NULL DEFAULT ''           -- 'Jeep'|'Ram'|'Chrysler'|'Dodge'|'Fiat'|'Alfa Romeo'|'Total'
                        CHECK (brand IN ('', 'Jeep', 'Ram', 'Chrysler', 'Dodge', 'Fiat', 'Alfa Romeo', 'Maserati', 'Total')),
  vehicle_model    text NOT NULL DEFAULT '',          -- 모델명 | 'Total' (brand 합계 row)
  region           text NOT NULL DEFAULT 'US'         -- 향후 'CA' 확장 여지
                        CHECK (region IN ('US', 'CA')),
  sales_units      integer NOT NULL DEFAULT 0,
  sales_units_prev integer NULL,                      -- Q prior 또는 CYTD prior
  yoy_pct          numeric(8, 2) NULL,                -- PR 표의 % Change 그대로
  release_id       text NULL,                         -- prnewswire 9자리 cision ID
  publish_date     date NULL,                         -- PR 게시일
  source_url       text NULL,                         -- PR URL
  collected_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (period_type, year_period, brand, vehicle_model, region)
);

CREATE INDEX IF NOT EXISTS idx_stellantis_na_period
  ON stellantis_na_sales(period_type, year_period);
CREATE INDEX IF NOT EXISTS idx_stellantis_na_brand
  ON stellantis_na_sales(brand, year_period) WHERE brand != '';
CREATE INDEX IF NOT EXISTS idx_stellantis_na_model
  ON stellantis_na_sales(vehicle_model, year_period) WHERE vehicle_model != 'Total';
CREATE INDEX IF NOT EXISTS idx_stellantis_na_release
  ON stellantis_na_sales(release_id) WHERE release_id IS NOT NULL;

ALTER TABLE stellantis_na_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_read_stellantis_na_sales
  ON stellantis_na_sales FOR SELECT TO anon USING (true);

CREATE POLICY service_write_stellantis_na_sales
  ON stellantis_na_sales FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE stellantis_na_sales IS
  'Stellantis North America (FCA US LLC) 분기 판매. 출처: prnewswire FCA US LLC publisher 분기당 1개 PR HTML table. brand 6 × model 30~35 + 합계 row. period_type=quarter는 단일 분기, year는 CYTD(연 누계, 보통 Q4 PR에 동시 포함). region 기본 US, 향후 CA 확장 여지. 단위=대.';
COMMENT ON COLUMN stellantis_na_sales.brand IS
  'Jeep / Ram / Chrysler / Dodge / Fiat / Alfa Romeo. Maserati는 별도 PR. Total=회사 합계 row.';
COMMENT ON COLUMN stellantis_na_sales.vehicle_model IS
  '모델명 (Compass, Wrangler 등) | ''Total''=brand 합계 row.';
COMMENT ON COLUMN stellantis_na_sales.release_id IS
  'prnewswire 9자리 cision ID (URL hash key). PR 갱신 추적용.';
