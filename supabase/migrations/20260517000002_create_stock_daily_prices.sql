-- 일별 OHLCV 시계열 (한세 대시보드 5년 일봉 차트용).
-- 수급(stock_supply_demand)과는 별도로 장기 가격 시계열 보관.

CREATE TABLE IF NOT EXISTS stock_daily_prices (
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  trade_date  date NOT NULL,
  open_price  numeric,
  high_price  numeric,
  low_price   numeric,
  close_price numeric,
  volume      bigint,
  change_pct  numeric,
  PRIMARY KEY (company_id, trade_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_prices_company_date
  ON stock_daily_prices (company_id, trade_date DESC);
ALTER TABLE stock_daily_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_daily_prices"
  ON stock_daily_prices FOR SELECT TO anon USING (true);
CREATE POLICY "service_write_daily_prices"
  ON stock_daily_prices FOR ALL TO service_role USING (true);
