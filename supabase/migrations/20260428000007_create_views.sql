-- companies + 최신 주가 조인 뷰
CREATE OR REPLACE VIEW companies_with_latest AS
SELECT
  c.*,
  sp.close AS latest_close,
  sp.trade_date AS latest_trade_date
FROM companies c
LEFT JOIN LATERAL (
  SELECT close, trade_date
  FROM stock_prices
  WHERE company_id = c.id
  ORDER BY trade_date DESC
  LIMIT 1
) sp ON true;

-- 초기 환율 6종 행 삽입 (rate는 추후 수집 스크립트가 갱신)
INSERT INTO exchange_rates_live (base, quote, rate, updated_at)
VALUES
  ('USD', 'KRW', 1350.0, now()),
  ('EUR', 'KRW', 1480.0, now()),
  ('GBP', 'KRW', 1720.0, now()),
  ('JPY', 'KRW', 9.0,    now()),
  ('HKD', 'KRW', 173.0,  now()),
  ('CNY', 'KRW', 186.0,  now())
ON CONFLICT (base, quote) DO NOTHING;
