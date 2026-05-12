-- market_series에 FRED 심볼 컬럼 추가 + UST2Y를 ^IRX(13주물)에서 FRED DGS2(정확한 2년물)로 교체.
ALTER TABLE market_series ADD COLUMN IF NOT EXISTS fred_symbol text;

UPDATE market_series
SET label = '미국 국채 2년',
    source = 'FRED',
    yf_symbol = NULL,
    fred_symbol = 'DGS2'
WHERE series_code = 'UST2Y';
