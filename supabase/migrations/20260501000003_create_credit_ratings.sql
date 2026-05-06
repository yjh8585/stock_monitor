-- 신용등급 테이블
-- rating_type: 'CP' (기업어음), 'Bond' (회사채)
-- agency: 'KIS' (한국신용평가), 'KR' (한국기업평가), 'NICE' (나이스신용평가)
-- UNIQUE (company_id, rating_type, agency) — 기관별 최신 등급 1건 유지

CREATE TABLE IF NOT EXISTS credit_ratings (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  rating_type  text        NOT NULL CHECK (rating_type IN ('CP', 'Bond')),
  agency       text        NOT NULL CHECK (agency IN ('KIS', 'KR', 'NICE')),
  rating       text,
  rating_date  date,
  collected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, rating_type, agency)
);

COMMENT ON TABLE  credit_ratings             IS 'FnGuide 신용등급 (CP/회사채)';
COMMENT ON COLUMN credit_ratings.rating_type IS 'CP: 기업어음, Bond: 회사채';
COMMENT ON COLUMN credit_ratings.agency      IS 'KIS: 한국신용평가, KR: 한국기업평가, NICE: 나이스신용평가';
COMMENT ON COLUMN credit_ratings.rating      IS '등급 (A1, AAA 등)';
COMMENT ON COLUMN credit_ratings.rating_date IS '평가일';

CREATE INDEX IF NOT EXISTS idx_credit_ratings_company
  ON credit_ratings (company_id);

ALTER TABLE credit_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_credit_ratings"     ON credit_ratings FOR SELECT TO anon         USING (true);
CREATE POLICY "service_write_credit_ratings"  ON credit_ratings FOR ALL    TO service_role USING (true);
