-- supabase/migrations/20260813000001_oem_model_segment.sql
-- MarkLines 판매 엑셀의 Type/Segment/PowerTrain 컬럼을 살린 매핑 테이블.
-- 92만 행 oem_sales_model_country_month 를 UPDATE 하지 않기 위해 별도 테이블로 분리한다
-- (전 행 UPDATE 는 WAL 을 폭증시켜 Supabase 용량을 위협한다 — 2026-08-03 사고 이력).

CREATE TABLE IF NOT EXISTS oem_model_segment (
  model        text NOT NULL,
  country      text NOT NULL,
  vehicle_type text NOT NULL,
  segment      text NOT NULL,
  powertrains  text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (model, country)
);

CREATE INDEX IF NOT EXISTS idx_oms_segment ON oem_model_segment(country, segment);

ALTER TABLE oem_model_segment ENABLE ROW LEVEL SECURITY;
CREATE POLICY oem_model_segment_read ON oem_model_segment FOR SELECT TO anon, authenticated USING (true);

-- 동일 값 재적재 시 WAL 낭비 방지 (20260803000002 과 같은 트리거 재사용)
CREATE TRIGGER trg_oms_skip_identical
  BEFORE UPDATE ON oem_model_segment
  FOR EACH ROW EXECUTE FUNCTION skip_identical_update();
