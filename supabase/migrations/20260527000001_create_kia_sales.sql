-- 기아 월별 차종/공장 판매 — Phase 1 (PR4, 현대차 hyundai_sales 패턴 재사용).
--
-- 출처: worldwide.kia.com/{ko,en}/company/investor-relations/library/performance-and-plans/
--   JSON API: /api/investors/business-sales-results?language=ko&year={Y}&page={P}
--   type='sales' 항목의 files[].path → /files/{path} GET
--
-- 엑셀 2종 통합 (collect_kia_sales.py에서 한 테이블에 적재):
--  (1) "YYYY 차종별판매실적.xlsx" (model.xlsx) — section: Domestic / Export(excl CKD) / Total(excl. CKD) / (CKD)
--      region='내수' (Domestic) | '수출' (Export) | 'CKD'
--      factory='' (한국 출하)
--      vehicle_model: Morning/Ray/K3/K5/K8/EV3/EV4/EV5/EV6/EV9/Seltos/Niro/Sportage/Sorento/Carnival/Bongo/Bus/Tasman/PV5/...
--  (2) "YYYY 해외공장판매실적.xlsx" (factory.xlsx) — 5 plant
--      plant: 'U.S. Plant' | 'China Plants' | 'Slovakia Plant' | 'Mexico Plant' | 'India Plant'
--      각 plant 끝에 합계 row 있음 — 합계는 적재 안 함 (model별만)
--
-- region/factory 의미:
--  region='내수' AND factory='' → 한국 공장 → 내수 출하 (sales-by-model Domestic)
--  region='수출' AND factory='' → 한국 공장 → 수출 출하 (sales-by-model Export)
--  region='CKD'  AND factory='' → 한국 공장 → CKD 부분 (sales-by-model (CKD), 분리 적재해서 double counting 방지)
--  region=''   AND factory='U.S. Plant' 등 → 해외 공장 (factory 엑셀)
--
-- export 엑셀의 region(U.S./Canada/Mexico/EU+EFTA/...)별 breakdown은
-- 별도 테이블 kia_export_regions에 (마이그레이션 20260527000002).
--
-- 단위: 대(Units) — 엑셀 원본 단위 그대로. (Hyundai는 천대 단위가 아님, 동일)
-- 결산월: 12월 (한국식 보정 불필요).

CREATE TABLE IF NOT EXISTS kia_sales (
  period_type    text NOT NULL DEFAULT 'month'
                      CHECK (period_type IN ('month', 'annual')),
  year_period    text NOT NULL DEFAULT '',          -- 'YYYY-MM' (월) | 'YYYY' (연간)
  region         text NOT NULL DEFAULT ''           -- '내수' | '수출' | 'CKD' | '' (해외 공장 row)
                      CHECK (region IN ('', '내수', '수출', 'CKD')),
  factory        text NOT NULL DEFAULT '',          -- '' (한국 출하) | 'U.S. Plant' | 'China Plants' | 'Slovakia Plant' | 'Mexico Plant' | 'India Plant'
  vehicle_model  text NOT NULL DEFAULT '',          -- 모델명 (NFC normalize 필수: 2026년 API NFD 반환)
  vehicle_type   text NULL,                         -- 'Ordinary Vehicle' | 'Special Vehicle' | NULL
  sales_units    integer NOT NULL DEFAULT 0,
  source_url     text NULL,
  collected_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (period_type, year_period, region, factory, vehicle_model)
);

CREATE INDEX IF NOT EXISTS idx_kia_sales_period
  ON kia_sales(year_period);
CREATE INDEX IF NOT EXISTS idx_kia_sales_region
  ON kia_sales(region, year_period);
CREATE INDEX IF NOT EXISTS idx_kia_sales_factory
  ON kia_sales(factory, year_period) WHERE factory != '';
CREATE INDEX IF NOT EXISTS idx_kia_sales_model
  ON kia_sales(vehicle_model, year_period);

ALTER TABLE kia_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_read_kia_sales
  ON kia_sales FOR SELECT TO anon USING (true);

CREATE POLICY service_write_kia_sales
  ON kia_sales FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE kia_sales IS
  '기아 월별 차종/공장 판매. 출처: worldwide.kia.com IR ''차종별판매실적''(model) + ''해외공장판매실적''(factory) 엑셀. region(내수/수출/CKD)+factory(공장)로 dimension 격리 — sales-by-model Total과 plant 합산이 double counting되지 않도록 isCountable() 필터링. region별 세부 breakdown은 kia_export_regions(source=export-by-region) 별도. 단위=대.';
COMMENT ON COLUMN kia_sales.region IS
  '한국 공장 출하: 내수/수출/CKD. 해외 공장 row는 region='''' factory=''<plant>''로 구분.';
COMMENT ON COLUMN kia_sales.factory IS
  '''''=한국 공장 출하, ''U.S. Plant''=조지아, ''China Plants''=중국 종합, ''Slovakia Plant''=질리나, ''Mexico Plant''=누에보 레온(Tucson 위탁 포함), ''India Plant''=아난타푸르.';
COMMENT ON COLUMN kia_sales.vehicle_model IS
  '모델명. NFC normalize 필수 (2026년 API 응답에서 NFD 자모 분해 발견). Domestic vs Export 표기 차이(Morning vs Picanto) → 한국/글로벌 양식 둘 다 보존, normalize는 표시 단계에서.';
