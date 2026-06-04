-- 지수·원자재·코인 라이브(현재가) 끝점용 테이블.
-- market_series_daily(일봉 종가) 차트 끝점을 매시 yfinance fast_info 값으로 갱신.
-- RLS: exchange_rates_live / market_series_daily와 동일 — anon read, service write.
CREATE TABLE market_series_live (
  series_code text PRIMARY KEY REFERENCES market_series(series_code) ON DELETE CASCADE,
  price       numeric NOT NULL,
  updated_at  timestamptz NOT NULL
);

ALTER TABLE market_series_live ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_read_market_series_live
  ON market_series_live FOR SELECT USING (true);

CREATE POLICY service_write_market_series_live
  ON market_series_live FOR ALL USING (true);
