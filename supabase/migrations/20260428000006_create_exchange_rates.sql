-- 환율 일봉 히스토리
CREATE TABLE IF NOT EXISTS exchange_rates (
  base       text NOT NULL,   -- USD/EUR/GBP/JPY/HKD/CNY
  quote      text NOT NULL DEFAULT 'KRW',
  rate_date  date NOT NULL,
  rate       numeric NOT NULL, -- 1 base = X KRW
  PRIMARY KEY (base, quote, rate_date)
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_base_date
  ON exchange_rates (base, rate_date DESC);

ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_exchange_rates" ON exchange_rates FOR SELECT TO anon USING (true);
CREATE POLICY "service_write_exchange_rates" ON exchange_rates FOR ALL TO service_role USING (true);

-- 환율 현재값 (6행만 유지)
CREATE TABLE IF NOT EXISTS exchange_rates_live (
  base       text NOT NULL,
  quote      text NOT NULL DEFAULT 'KRW',
  rate       numeric NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (base, quote)
);

ALTER TABLE exchange_rates_live ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_exchange_rates_live" ON exchange_rates_live FOR SELECT TO anon USING (true);
CREATE POLICY "service_write_exchange_rates_live" ON exchange_rates_live FOR ALL TO service_role USING (true);
