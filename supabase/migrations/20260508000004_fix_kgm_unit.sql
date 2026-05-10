-- 한국지엠 재무 단위 보정
-- collect_dart_audit.py가 한국지엠 감사보고서 단위(천원)를 원으로 잘못 인식 →
-- 실제값의 1/1000 로 저장됨 (예: 매출 12,612백만원 ≈ 126억, 실제 12.6조원).
-- 모든 화폐 컬럼 ×1000 보정. NULL 값은 NULL로 유지.
-- 르노코리아는 단위 인식 정상.

UPDATE financials AS f
SET revenue           = revenue           * 1000,
    operating_income  = operating_income  * 1000,
    net_income        = net_income        * 1000,
    total_assets      = total_assets      * 1000,
    total_liabilities = total_liabilities * 1000,
    total_equity      = total_equity      * 1000,
    inventory         = inventory         * 1000
FROM companies c
WHERE c.id = f.company_id
  AND c.ticker = '한국지엠'
  AND f.period_type = 'annual';
