-- financials_period_semantic_check 에 2월 결산 허용.
-- 배경:
--   2026-08-24 등록한 야스카와전기(6506.T)는 2월 결산이다(yfinance 연간 period_end = 2/28·29).
--   20260520000007 의 허용 월 {3,5,6,8,9,12} 에 2가 없어 annual 행이 CHECK 위반(23514)으로 거부됐고,
--   2026-10-14 분기·연간 실적 수집(GHA)이 그 배치에서 통째로 중단됐다.
--   해당 마이그레이션 주석의 「새 결산월 회사 도입 시 본 제약 보강」 약속을 이행한다.
-- 참고:
--   글로벌(yfinance) 경로는 companies.fiscal_year_end_month 가 아니라 데이터의 첫 결산일로
--   결산월을 판단한다(collect_financials.py). 그래서 이 컬럼은 손대지 않는다 — 글로벌 비-12월
--   결산사 36곳 전부가 12 로 남아 있는 것이 현행 운영이다.
-- 사전 검증: 허용 월을 넓히기만 하므로 기존 행은 전부 통과한다.

ALTER TABLE financials DROP CONSTRAINT financials_period_semantic_check;

ALTER TABLE financials
  ADD CONSTRAINT financials_period_semantic_check
  CHECK (
    (period_type = 'annual'
     AND fiscal_quarter IS NULL
     AND EXTRACT(MONTH FROM period_end_date) IN (2, 3, 5, 6, 8, 9, 12))
    OR
    (period_type = 'quarterly'
     AND fiscal_quarter BETWEEN 1 AND 4)
  );

COMMENT ON CONSTRAINT financials_period_semantic_check ON financials IS
  'annual: fiscal_quarter NULL + period_end_date 월 IN (2,3,5,6,8,9,12). quarterly: fiscal_quarter 1~4.';
