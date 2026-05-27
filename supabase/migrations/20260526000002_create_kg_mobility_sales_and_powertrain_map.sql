-- KG모빌리티 차종별 판매 (PR2, MVP 1사) + 4사 공통 차종↔powertrain 매핑 테이블.
--
-- 배경:
--  - OEM 페이지에 회사별 탭(전체/Stellantis NA/KG/현대/기아) 추가. PR2는 KG end-to-end.
--  - audit 리포트(data/_oem_audit_report.md) 핵심 발견:
--      1) 4사 IR 자료에 powertrain 컬럼 없음 → 차종→PT 매핑을 별도 테이블로 운영
--      2) granularity: KG=월, 현대/기아=월+연간, Stellantis=분기 → period_type 컬럼 필수
--      3) KG 사이트 정적 엑셀 링크 없음 → Playwright expect_download() 수집
--
-- 본 마이그레이션:
--  (1) kg_mobility_sales — 회사별 테이블 4개 중 1번째
--  (2) vehicle_powertrain_map — 4사 공통 (PR3~5 시드 확장)
--
-- 컨벤션:
--  - 기존 oem_sales_* 패턴 따름: PK = dimension 조합 (멱등 upsert).
--  - RLS: anon SELECT + service_role ALL (oem_sales_group_* 마이그레이션 20260510000002와 동일).
--  - powertrain은 NULL 허용 (Phase 1 best-effort. Phase 2에서 시드 후 NULL 감소).

-- ============================================================
-- 1) kg_mobility_sales — KG모빌리티 차종별 판매
-- ============================================================
CREATE TABLE IF NOT EXISTS kg_mobility_sales (
  period_type   text    NOT NULL DEFAULT 'month'
                        CHECK (period_type IN ('month', 'quarter', 'annual')),
  year_period   text    NOT NULL DEFAULT '',   -- 'YYYY-MM' | 'YYYY-Q1' | 'YYYY'
  region        text    NOT NULL DEFAULT '',   -- '내수' | '수출' | 'CKD' | '기타'
  vehicle_model text    NOT NULL DEFAULT '',   -- 토레스 | 토레스 EVX | 렉스턴 | 코란도 등
  vehicle_type  text    NOT NULL DEFAULT '',   -- SUV | 픽업 | 세단 (audit 후 finalize)
  powertrain    text    NULL,                  -- vehicle_powertrain_map 조인용. NULL = 미매핑
  sales_units   integer NOT NULL,
  source_url    text    NULL,                  -- 출처 엑셀 URL 추적
  collected_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (period_type, year_period, region, vehicle_model)
);

CREATE INDEX IF NOT EXISTS idx_kg_mobility_sales_period
  ON kg_mobility_sales(year_period);
CREATE INDEX IF NOT EXISTS idx_kg_mobility_sales_model
  ON kg_mobility_sales(vehicle_model, year_period);
CREATE INDEX IF NOT EXISTS idx_kg_mobility_sales_region
  ON kg_mobility_sales(region, year_period);

ALTER TABLE kg_mobility_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_read_kg_mobility_sales
  ON kg_mobility_sales FOR SELECT TO anon USING (true);

CREATE POLICY service_write_kg_mobility_sales
  ON kg_mobility_sales FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE kg_mobility_sales IS
  'KG모빌리티 차종별 판매 (PR2). 출처: kg-mobility.com IR 엑셀, 수집: collect_kg_mobility_sales.py. region=내수/수출. powertrain은 vehicle_powertrain_map과 조인(LEFT JOIN, NULL 허용).';

-- ============================================================
-- 2) vehicle_powertrain_map — 4사 공통 차종↔powertrain 매핑
-- ============================================================
CREATE TABLE IF NOT EXISTS vehicle_powertrain_map (
  company_slug  text NOT NULL
                CHECK (company_slug IN ('kg-mobility', 'hyundai', 'kia', 'stellantis-na')),
  vehicle_model text NOT NULL,
  powertrain    text NOT NULL
                CHECK (powertrain IN ('ICE', 'HV', 'PHEV', 'EV', 'FCEV', 'Multi')),
  -- Multi = 같은 모델명이 ICE/EV 다중 파워트레인을 동시에 갖는 경우(예: 토레스 ICE + 토레스 EVX 별도 모델)
  -- 가능하면 모델명을 세분화해(예: '토레스', '토레스 EVX') 단일 PT로 매핑.
  valid_from    date NOT NULL DEFAULT '2021-01-01',
  valid_to      date NULL,                 -- NULL = 현재 유효
  source_note   text NULL,                 -- 매핑 근거(예: '회사 보도자료 2024-03', 'IR 연간보고서')
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_slug, vehicle_model, valid_from)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_powertrain_map_lookup
  ON vehicle_powertrain_map(company_slug, vehicle_model);

ALTER TABLE vehicle_powertrain_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_read_vehicle_powertrain_map
  ON vehicle_powertrain_map FOR SELECT TO anon USING (true);

CREATE POLICY service_write_vehicle_powertrain_map
  ON vehicle_powertrain_map FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE vehicle_powertrain_map IS
  '4사 OEM(KG/현대/기아/Stellantis NA) 공통 차종→powertrain 매핑. PR2(KG) 도입, PR3~5에서 회사별 차종 시드 확장. valid_from/valid_to로 모델 변경 이력 관리(예: 토레스 ICE-only → 토레스 EVX 추가).';
