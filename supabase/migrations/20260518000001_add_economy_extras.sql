-- 경제 페이지 확장: 미국 국채 30년, 비트코인/이더리움(USD)
-- UST30Y: yfinance ^TYX (10Y의 ^TNX와 동일 소스/패턴)
-- BTC/ETH: yfinance BTC-USD / ETH-USD
INSERT INTO market_series (series_code, label, unit, source, yf_symbol, category, sort_order) VALUES
  ('UST30Y', '미국 국채 30년',       '%',   'Yahoo Finance', '^TYX',    'economy', 12),
  ('BTC',    '비트코인 (BTC/USD)',   'USD', 'Yahoo Finance', 'BTC-USD', 'economy', 80),
  ('ETH',    '이더리움 (ETH/USD)',   'USD', 'Yahoo Finance', 'ETH-USD', 'economy', 90)
ON CONFLICT (series_code) DO UPDATE SET
  label      = EXCLUDED.label,
  unit       = EXCLUDED.unit,
  source     = EXCLUDED.source,
  yf_symbol  = EXCLUDED.yf_symbol,
  category   = EXCLUDED.category,
  sort_order = EXCLUDED.sort_order;
