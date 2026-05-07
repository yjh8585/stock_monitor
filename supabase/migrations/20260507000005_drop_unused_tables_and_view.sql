-- 미사용 테이블/뷰 제거
-- 배경:
--   - companies_with_latest 뷰: frontend/scripts에서 어디서도 참조 없음
--   - watchlist 테이블: 정의만 있고 INSERT 코드 없음
--   - shareholders, credit_ratings 테이블: 수집 스크립트는 있으나 frontend 미사용
-- related_stocks_view는 companies/financials/exchange_rates_live만 참조하므로 영향 없음.

DROP VIEW IF EXISTS companies_with_latest;
DROP TABLE IF EXISTS watchlist;
DROP TABLE IF EXISTS shareholders;
DROP TABLE IF EXISTS credit_ratings;
