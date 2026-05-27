-- 우즈베키스탄 자동차 시장 통합 테이블 — PR6.
--
-- 2개 소스 단일 테이블 (kind 컬럼으로 분리):
--   src1: uzavtosanoat.uz (우즈벡 자동차산업청) — 회사별 sales 매월 14~18일 발표
--   src2: stat.uz (우즈벡 통계청) — 브랜드/모델별 production 분기당 1건
--
-- 회사 5개 (Khorezm Auto / ADM Jizzakh / BYD Uzbekistan Factory / SamAuto / Asaka Motors)는
-- companies 테이블 미등록 — sales row의 company text 컬럼만 사용 (단순화).
-- UzAuto Motors는 이미 등록(UZMT, country=UZ, data_source=uzauto-pdf).
--
-- 둘 다 YTD 누계 발표 형식 → 수집 단계에서 차분(MoM/QoQ) 계산해 period_type='month'/'quarter' 별도 row 적재.
-- 단위: 대(Units).
--
-- 데이터 상충 시 ON CONFLICT DO UPDATE — collected_at/publish_date 더 최근 값으로 자동 덮어쓰기.
-- (PostgREST upsert 자연 처리, publish_date 비교 불필요 — 매번 fetch가 최신이므로)
--
-- stat.uz 정규화 규칙 (수집 스크립트에서 적용):
--   "Specialized passenger car" + "Damas" → "Damas/Labo" 단일 vehicle_model 합산
--   (3개 분류가 같은 라인의 변형이라는 안내, 차트 footnote 명시)

CREATE TABLE IF NOT EXISTS uzbekistan_auto_stats (
  kind           text NOT NULL DEFAULT 'sales'
                      CHECK (kind IN ('sales', 'production')),
  period_type    text NOT NULL DEFAULT 'month'
                      CHECK (period_type IN ('month', 'quarter', 'year')),
  year_period    text NOT NULL DEFAULT '',          -- 'YYYY-MM' | 'YYYY-QN' | 'YYYY'
  company        text NOT NULL DEFAULT ''           -- 'UzAuto Motors'/'Khorezm Auto'/'ADM Jizzakh'/'BYD Uzbekistan Factory'/'SamAuto'/'Asaka Motors' | '' (production 데이터는 회사 정보 없음)
                      CHECK (company IN ('', 'UzAuto Motors', 'Khorezm Auto', 'ADM Jizzakh', 'BYD Uzbekistan Factory', 'SamAuto', 'Asaka Motors')),
  brand          text NOT NULL DEFAULT '',          -- 'Chevrolet'/'Kia'/'Hyundai'/'HAVAL'/'CHERY'/'BYD' | ''
  vehicle_model  text NOT NULL DEFAULT '',          -- 모델명 | 'Damas/Labo' (Damas+Specialized 통합) | '' (회사 합계 row)
  units          integer NOT NULL DEFAULT 0,
  source_type    text NOT NULL                      -- 'uzavtosanoat' | 'stat-uz'
                      CHECK (source_type IN ('uzavtosanoat', 'stat-uz')),
  source_url     text NULL,
  publish_date   date NULL,                         -- 보도자료 발표일
  collected_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, period_type, year_period, company, brand, vehicle_model, source_type)
);

CREATE INDEX IF NOT EXISTS idx_uz_auto_period
  ON uzbekistan_auto_stats(period_type, year_period);
CREATE INDEX IF NOT EXISTS idx_uz_auto_company
  ON uzbekistan_auto_stats(company, year_period) WHERE company != '';
CREATE INDEX IF NOT EXISTS idx_uz_auto_brand
  ON uzbekistan_auto_stats(brand, year_period) WHERE brand != '';
CREATE INDEX IF NOT EXISTS idx_uz_auto_model
  ON uzbekistan_auto_stats(vehicle_model, year_period) WHERE vehicle_model != '';
CREATE INDEX IF NOT EXISTS idx_uz_auto_source
  ON uzbekistan_auto_stats(source_type, year_period);

ALTER TABLE uzbekistan_auto_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_read_uzbekistan_auto_stats
  ON uzbekistan_auto_stats FOR SELECT TO anon USING (true);

CREATE POLICY service_write_uzbekistan_auto_stats
  ON uzbekistan_auto_stats FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE uzbekistan_auto_stats IS
  '우즈벡 자동차 시장 통합 테이블. kind=sales(uzavtosanoat 회사별 매월) + kind=production(stat.uz 브랜드/모델별 분기). YTD 누계는 수집 단계에서 차분 후 month/quarter row 적재. ON CONFLICT DO UPDATE로 최신 우선 upsert.';
COMMENT ON COLUMN uzbekistan_auto_stats.kind IS
  'sales=판매(uzavtosanoat), production=생산(stat.uz). cross-check용 차트에서 비교.';
COMMENT ON COLUMN uzbekistan_auto_stats.company IS
  '6개 회사 enum. production 데이터(stat.uz)는 회사 정보 없으므로 '''' .';
COMMENT ON COLUMN uzbekistan_auto_stats.vehicle_model IS
  '모델명. Damas+Specialized passenger cars(stat.uz)는 ''Damas/Labo'' 통합 적재 (차트 footnote 주석).';
