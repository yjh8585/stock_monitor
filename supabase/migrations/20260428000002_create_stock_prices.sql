-- 일별 주가 (5년 히스토리)
CREATE TABLE IF NOT EXISTS stock_prices (
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  trade_date  date NOT NULL,
  open        numeric,
  high        numeric,
  low         numeric,
  close       numeric NOT NULL,
  adj_close   numeric,
  volume      bigint,
  PRIMARY KEY (company_id, trade_date)
);

CREATE INDEX IF NOT EXISTS idx_stock_prices_company_date
  ON stock_prices (company_id, trade_date DESC);

ALTER TABLE stock_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_stock_prices" ON stock_prices FOR SELECT TO anon USING (true);
CREATE POLICY "service_write_stock_prices" ON stock_prices FOR ALL TO service_role USING (true);
