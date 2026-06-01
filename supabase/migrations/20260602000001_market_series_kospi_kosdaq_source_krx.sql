-- 코스피/코스닥 지수는 yfinance(^KS11/^KQ11)가 당일 종가를 하루 이상 늦게 제공한다.
-- KRX(pykrx get_index_ohlcv)에서 직접 수집하도록 전환하면서 화면 출처 표기를 정정한다.
-- 값 체계는 yfinance와 동일해 과거 데이터와 연속된다(backfill 불필요).
UPDATE market_series
SET source = 'KRX'
WHERE series_code IN ('KOSPI', 'KOSDAQ');
