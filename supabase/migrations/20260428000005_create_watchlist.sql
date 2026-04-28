-- 단일 사용자 watchlist
CREATE TABLE IF NOT EXISTS watchlist (
  company_id    uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  added_at      timestamptz NOT NULL DEFAULT now(),
  display_order integer NOT NULL DEFAULT 0
);

ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_watchlist" ON watchlist FOR SELECT TO anon USING (true);
CREATE POLICY "service_write_watchlist" ON watchlist FOR ALL TO service_role USING (true);
