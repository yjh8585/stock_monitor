-- 뉴스
CREATE TABLE IF NOT EXISTS news (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title        text NOT NULL,
  url          text NOT NULL UNIQUE,
  source       text,
  summary      text,
  published_at timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_news_company_published
  ON news (company_id, published_at DESC);

ALTER TABLE news ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_news" ON news FOR SELECT TO anon USING (true);
CREATE POLICY "service_write_news" ON news FOR ALL TO service_role USING (true);
