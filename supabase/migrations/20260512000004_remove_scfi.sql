-- SCFI 제거: 공개 5년 백필 소스 부재 + 사용자 결정.
-- 향후 다시 추가하려면 INSERT INTO market_series ... 로 메타만 복원하면 됨.
DELETE FROM market_series_daily WHERE series_code = 'SCFI';
DELETE FROM market_series WHERE series_code = 'SCFI';
