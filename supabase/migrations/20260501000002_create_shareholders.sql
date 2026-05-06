-- 주주 현황 테이블
-- holder_type: 'major' (대주주 현황), 'category' (주주구분 현황)
-- UNIQUE (company_id, holder_name, holder_type) — 동일 주주 중복 수집 방지

CREATE TABLE IF NOT EXISTS shareholders (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  holder_name   text        NOT NULL,
  holder_type   text        NOT NULL CHECK (holder_type IN ('major', 'category')),
  relation      text,
  common_shares numeric,
  ownership_pct numeric,
  as_of_date    date,
  collected_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, holder_name, holder_type)
);

COMMENT ON TABLE  shareholders              IS 'FnGuide 주주 현황 (대주주/주주구분)';
COMMENT ON COLUMN shareholders.holder_name  IS '주주명 또는 주주구분명';
COMMENT ON COLUMN shareholders.holder_type  IS 'major: 대주주 현황, category: 주주구분 현황';
COMMENT ON COLUMN shareholders.relation     IS '관계 (최대주주, 특수관계인, 외국인 등)';
COMMENT ON COLUMN shareholders.common_shares IS '보통주 수량';
COMMENT ON COLUMN shareholders.ownership_pct IS '지분율 (%)';
COMMENT ON COLUMN shareholders.as_of_date   IS '최종변동일';

CREATE INDEX IF NOT EXISTS idx_shareholders_company_type
  ON shareholders (company_id, holder_type);

ALTER TABLE shareholders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_shareholders"    ON shareholders FOR SELECT TO anon         USING (true);
CREATE POLICY "service_write_shareholders" ON shareholders FOR ALL    TO service_role USING (true);
