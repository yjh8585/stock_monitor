-- KR 상장사인데 status='delisted'로 잘못 마킹된 회사 일괄 정정
-- 기준: ticker가 6자리 숫자(KOSPI/KOSDAQ 정상 형식) AND last_price 존재
-- (가격 데이터가 정상 적재된 회사 = 실제 거래 중 = active)
-- last_price가 NULL인 5개 케이스(대주코레스/대유/삼보오토/세원이앤씨/덴소코리아 등)는
-- 실제 상폐 가능성 검증 후 별도 처리.

UPDATE companies
SET status = 'active'
WHERE country = 'KR'
  AND status = 'delisted'
  AND ticker ~ '^[0-9]{6}$'
  AND last_price IS NOT NULL;
